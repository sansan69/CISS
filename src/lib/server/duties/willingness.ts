import { db } from '@/lib/firebaseAdmin';
import { parseTcsCategory } from '@/lib/tcs-category';
import { districtMatches } from '@/lib/districts';
import { resolveDutyGuard, assertEmployee, employeeDistrict, transactionSite, assertOpenExam, canonicalDutyDate, resolveDutySupervisor, recheckSupervisor, assertDistrict, resolveDutySite, isWillingnessEligible, text } from './scope';
import { strictBody, documentId, requestId, version, fingerprint, receiptRef, replayReceipt, assertVersion, DutyError, iso, invalid } from './requests';
import { buildDutyNotificationWrites, dispatchDutyNotifications, willingnessAudience } from './notifications';
function willingnessDto(data: Record<string, any> | undefined) {
  return data ? {
    response: data.response,
    version: Number(data.version ?? 0),
    respondedAt: iso(data.respondedAt)
  } : null;
}
export async function setDutyWillingness(request: Request, id: string, input: unknown) {
  documentId(id);
  const b = strictBody(input, ['response', 'clientRequestId', 'expectedVersion']);
  if (!['willing', 'unavailable'].includes(b.response))
    invalid('response must be willing or unavailable.');
  requestId(b.clientRequestId);
  version(b.expectedVersion);
  const guard = await resolveDutyGuard(request);
  const fp = fingerprint(b);
  const receipt = receiptRef(db, 'willingness', guard.uid, id, b.clientRequestId);
  const outcome = await db.runTransaction(async (tx) => {
    const employeeSnap = await tx.get(db.collection('employees').doc(guard.employeeDocId));
    if (!employeeSnap.exists)
      throw new DutyError(403, 'inactive_guard', 'Linked employee not found.');
    const employee = employeeSnap.data()!;
    assertEmployee(employee, guard.uid);
    if (parseTcsCategory(employee.clientName, employee.tcsCategory) !== 'adhoc')
      throw new DutyError(403, 'ineligible_category', 'Only classified TCS adhoc guards can respond.');
    const orderSnap = await tx.get(db.collection('workOrders').doc(id));
    if (!orderSnap.exists)
      throw new DutyError(404, 'duty_not_found', 'Exam duty not found.');
    const order = orderSnap.data()!;
    const site = await transactionSite(tx, text(order.siteId));
    if (!districtMatches(employeeDistrict(employee), site.district))
      throw new DutyError(403, 'wrong_scope', 'Exam is outside your current district.');
    // Identity and current scope are authoritative; once they pass, an exact
    // prior request must replay even if the duty has since closed or assigned.
    const priorReceipt = replayReceipt(await tx.get(receipt), fp);
    if (priorReceipt)
      return {
        ...priorReceipt.result,
        replayed: true,
        eventIds: priorReceipt.eventIds ?? []
      };
    assertOpenExam(order, site);
    if (Array.isArray(order.assignedGuards) && order.assignedGuards.some(g => g?.uid === guard.employeeDocId))
      throw new DutyError(409, 'already_assigned', 'You are already assigned to this exam duty.');
    const ref = db.collection('dutyWillingness').doc(`${id}_${guard.employeeDocId}`);
    const prior = (await tx.get(ref)).data();
    const current = Number(prior?.version ?? 0);
    assertVersion(b.expectedVersion, current, {
      willingness: willingnessDto(prior)
    });
    const changed = prior?.response !== b.response;
    const now = new Date();
    const next = changed ? {
      workOrderId: id,
      guardId: guard.employeeDocId,
      guardUid: guard.uid,
      employeeId: text(employee.employeeId || employee.employeeCode),
      district: site.district,
      examCode: text(order.examCode),
      examName: text(order.examName),
      dutyDate: canonicalDutyDate(order.date),
      response: b.response,
      version: current + 1,
      respondedAt: now,
      source: 'mobile'
    } : prior!;
    const audience = changed ? await willingnessAudience(tx, site.district) : [];
    const writes = audience.flatMap(uid => buildDutyNotificationWrites({
      operation: 'willingness',
      entityId: `${id}_${guard.employeeDocId}`,
      version: next.version,
      type: 'duty_willingness',
      recipientUid: uid,
      recipientRole: 'fieldOfficer',
      district: site.district,
      title: 'Exam willingness updated',
      body: 'Open the work order to review current responses.',
      data: {
        workOrderId: id,
        routeKind: 'work_order_willingness'
      }
    }));
    const result = {
      success: true as const,
      willingness: willingnessDto(next)!,
      replayed: false
    };
    if (changed)
      tx.set(ref, next);
    for (const write of writes)
      tx.create(write.ref, write.data);
    tx.create(receipt, {
      fingerprint: fp,
      result,
      eventIds: writes.map(w => w.ref.id),
      createdAt: now
    });
    return {
      ...result,
      eventIds: writes.map(w => w.ref.id)
    };
  });
  await dispatchDutyNotifications(outcome.eventIds);
  const { eventIds, ...result } = outcome;
  void eventIds;
  return result;
}
export async function tallyWorkOrderWillingness(id: string, order?: Record<string, any>) {
  documentId(id);
  const data = order ?? (await db.collection('workOrders').doc(id).get()).data();
  if (!data)
    throw new DutyError(404, 'duty_not_found', 'Exam duty not found.');
  const site = await resolveDutySite(db, text(data.siteId));
  const snap = await db.collection('dutyWillingness').where('workOrderId', '==', id).get();
  const responses = [];
  for (const doc of snap.docs) {
    const r = doc.data();
    if (!['willing', 'unavailable'].includes(r.response))
      continue;
    const employeeSnap = await db.collection('employees').doc(documentId(r.guardId)).get();
    const employee = employeeSnap.data();
    if (!employee || text(employee.guardAuthUid) !== r.guardUid || !isWillingnessEligible(employee, site.district) || r.dutyDate !== canonicalDutyDate(data.date))
      continue;
    responses.push({
      employeeDocId: employeeSnap.id,
      employeeId: text(employee.employeeId),
      name: text(employee.fullName || employee.name),
      gender: text(employee.gender),
      tcsCategory: parseTcsCategory(employee.clientName, employee.tcsCategory),
      response: r.response,
      respondedAt: iso(r.respondedAt),
      version: Number(r.version ?? 0)
    });
  }
  responses.sort((a, b) => a.employeeDocId.localeCompare(b.employeeDocId));
  return {
    workOrderId: id,
    willingCount: responses.filter(r => r.response === 'willing').length,
    unavailableCount: responses.filter(r => r.response === 'unavailable').length,
    responses
  };
}
export async function getWorkOrderWillingness(request: Request, id: string) {
  documentId(id);
  const supervisor = await resolveDutySupervisor(request);
  const order = (await db.collection('workOrders').doc(id).get()).data();
  if (!order)
    throw new DutyError(404, 'duty_not_found', 'Exam duty not found.');
  const site = await resolveDutySite(db, text(order.siteId));
  assertDistrict(supervisor, site.district);
  return tallyWorkOrderWillingness(id, order);
}
