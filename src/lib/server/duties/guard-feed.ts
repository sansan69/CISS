import { db } from '@/lib/firebaseAdmin';
import { districtMatches, canonicalizeDistrictName } from '@/lib/districts';
import { isOperationalWorkOrderClientName } from '@/lib/work-orders';
import { parseTcsCategory } from '@/lib/tcs-category';
import type { GuardDutyDto } from '@/types/duties';
import { resolveDutyGuard, assertEmployee, employeeDistrict, dateWindow, addDays, pagedQuery, canonicalDutyDate, respondBy, resolveDutySite, text } from './scope';
import { DutyError, iso } from './requests';
export async function getGuardDuties(request: Request): Promise<GuardDutyDto[]> {
  const identity = await resolveDutyGuard(request);
  const employee = (await db.collection('employees').doc(identity.employeeDocId).get()).data();
  if (!employee)
    throw new DutyError(403, 'inactive_guard', 'Linked employee not found.');
  assertEmployee(employee, identity.uid);
  const category = parseTcsCategory(employee.clientName, employee.tcsCategory);
  const district = employeeDistrict(employee);
  const range = dateWindow();
  const [orders, assignments, responses] = await Promise.all([pagedQuery(db.collection('workOrders').where('date', '>=', new Date(`${range.from}T00:00:00+05:30`)).where('date', '<', new Date(`${addDays(range.to, 1)}T00:00:00+05:30`)).orderBy('date').orderBy('__name__')), pagedQuery(db.collection('guardAssignments').where('guardId', '==', identity.employeeDocId).where('date', '>=', range.from).where('date', '<=', range.to).orderBy('date').orderBy('__name__')), pagedQuery(db.collection('dutyWillingness').where('guardId', '==', identity.employeeDocId).where('dutyDate', '>=', range.from).where('dutyDate', '<=', range.to).orderBy('dutyDate').orderBy('__name__'))]);
  const byOrder = new Map(responses.map(d => [d.data().workOrderId, d.data()]));
  const result: GuardDutyDto[] = [];
  for (const doc of orders) {
    const order = doc.data();
    const recordStatus = text(order.recordStatus || 'active').toLowerCase();
    if (!['active', 'cancelled'].includes(recordStatus))
      continue;
    const assigned = recordStatus === 'active' && Array.isArray(order.assignedGuards) && order.assignedGuards.some(g => g?.uid === identity.employeeDocId);
    // Own cancellation history survives a manual roster removal on an otherwise active
    // work order, and a live assignment always overrides that history.
    const cancelledOwn = !assigned && Array.isArray(order.cancelledAssignedGuards) && order.cancelledAssignedGuards.some(g => g?.uid === identity.employeeDocId);
    if (!isOperationalWorkOrderClientName(text(order.clientName)) || (!assigned && !cancelledOwn && text(order.recordStatus || 'active') !== 'active'))
      continue;
    let site;
    try {
      site = await resolveDutySite(db, text(order.siteId));
    }
    catch (e) {
      if (!(e instanceof DutyError))
        throw e;
      if (!assigned && !cancelledOwn)
        continue;
      // An own exam roster remains informational when a centre is removed or
      // disabled. Saved metadata preserves a visible cancellation/assignment.
      site = {
        id: text(order.siteId),
        siteName: text(order.siteName) || 'Site',
        clientName: text(order.clientName),
        district: canonicalizeDistrictName(text(order.district)),
        data: order
      };
    }
    // An open candidate must satisfy the same authoritative eligibility the willingness
    // write enforces (current site client, guard client and current site district).
    if (!assigned && !cancelledOwn && (!isOperationalWorkOrderClientName(text(site.clientName)) || !isOperationalWorkOrderClientName(text(employee.clientName)) || !districtMatches(district, site.district)))
      continue;
    const date = canonicalDutyDate(order.date);
    const cutoff = respondBy(date);
    const own = assigned || cancelledOwn;
    const response = byOrder.get(doc.id);
    const reason = own ? 'already_assigned' : category !== 'adhoc' ? 'ineligible_category' : Date.now() >= Date.parse(cutoff) ? 'duty_closed' : null;
    const start = iso(order.startsAt), end = iso(order.endsAt);
    const known = !!start && !!end && Date.parse(end) > Date.parse(start);
    result.push({
      id: own ? `exam:${doc.id}` : doc.id,
      kind: own ? 'assigned' : 'exam',
      date,
      siteId: site.id,
      siteName: site.siteName,
      clientName: site.clientName,
      district: site.district,
      shiftLabel: known ? text(order.shiftLabel) || null : null,
      startsAt: known ? start : null,
      endsAt: known ? end : null,
      relieving: false,
      status: cancelledOwn ? 'cancelled' : assigned ? 'assigned' : 'open',
      workOrderId: doc.id,
      examName: text(order.examName) || null,
      examCode: text(order.examCode) || null,
      maleGuardsRequired: Number(order.maleGuardsRequired ?? 0),
      femaleGuardsRequired: Number(order.femaleGuardsRequired ?? 0),
      willingness: response?.response ?? null,
      willingnessVersion: Number(response?.version ?? 0),
      canRespond: reason === null,
      respondBy: cutoff,
      ineligibilityReason: reason
    });
  }
  for (const d of assignments) {
    const a = d.data();
    result.push({
      id: d.id,
      kind: 'assigned',
      date: a.date,
      siteId: text(a.siteId),
      siteName: text(a.siteName),
      clientName: text(a.clientName),
      district: text(a.district),
      shiftLabel: text(a.shiftLabel) || null,
      startsAt: iso(a.startsAt),
      endsAt: iso(a.endsAt),
      relieving: a.type === 'relieving',
      status: a.status === 'cancelled' ? 'cancelled' : 'assigned',
      workOrderId: null,
      examName: null,
      examCode: null,
      maleGuardsRequired: null,
      femaleGuardsRequired: null,
      willingness: null,
      willingnessVersion: 0,
      canRespond: false,
      respondBy: null,
      ineligibilityReason: null
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
