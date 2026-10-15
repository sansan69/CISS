import { db } from '@/lib/firebaseAdmin';
import { hasAdminAccess, verifyRequestAuth } from '@/lib/server/auth';
import { requireGuard } from '@/lib/server/guard-auth';
import { requireActiveFieldOfficerProfile, isActiveLinkedProfile } from '@/lib/server/linked-profiles';
import { canonicalizeDistrictList, canonicalizeDistrictName, districtMatches } from '@/lib/districts';
import { resolveEmployeeDistrict } from '@/lib/employees/visibility';
import { parseTcsCategory } from '@/lib/tcs-category';
import { isOperationalWorkOrderClientName } from '@/lib/work-orders';
import { documentId, DutyError, invalid, iso } from './requests';
export const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export type Supervisor = {
  uid: string;
  isAdmin: boolean;
  assignedDistricts: string[];
  profileDocId?: string;
};
export async function resolveDutySupervisor(request: Request): Promise<Supervisor> {
  const decoded = await verifyRequestAuth(request, true);
  if (hasAdminAccess(decoded))
    return {
      uid: decoded.uid,
      isAdmin: true,
      assignedDistricts: []
    };
  if (decoded.role !== 'fieldOfficer')
    throw new DutyError(403, 'wrong_role', 'Supervisor access required.');
  let profile;
  try {
    profile = await requireActiveFieldOfficerProfile(db, decoded);
  }
  catch (e) {
    if ((e as Error).message === 'Field officer profile is not authorized.')
      throw new DutyError(403, 'wrong_scope', 'An active linked field officer profile is required.');
    throw e;
  }
  return {
    uid: decoded.uid,
    isAdmin: false,
    assignedDistricts: profile.assignedDistricts,
    profileDocId: profile.profileDocId
  };
}
export async function recheckSupervisor(tx: FirebaseFirestore.Transaction, s: Supervisor): Promise<Supervisor> {
  if (s.isAdmin)
    return s;
  const snap = await tx.get(db.collection('fieldOfficers').where('uid', '==', s.uid).limit(2));
  if (snap.docs.length !== 1 || !isActiveLinkedProfile(snap.docs[0].data()))
    throw new DutyError(403, 'wrong_scope', 'An active linked field officer profile is required.');
  return {
    ...s,
    assignedDistricts: canonicalizeDistrictList(Array.isArray(snap.docs[0].data().assignedDistricts) ? snap.docs[0].data().assignedDistricts.filter((value: unknown): value is string => typeof value === 'string') : [])
  };
}
export function assertDistrict(supervisor: Supervisor, district: string) {
  if (!district || (!supervisor.isAdmin && !supervisor.assignedDistricts.some(d => districtMatches(d, district))))
    throw new DutyError(403, 'wrong_scope', 'Duty is outside your current district scope.');
}
export async function resolveDutyGuard(request: Request) {
  try {
    return await requireGuard(request);
  }
  catch (e) {
    if (['Guard access required.', 'Guard employee record not found.'].includes((e as Error).message))
      throw new DutyError(403, 'wrong_role', 'An active linked guard profile is required.');
    throw e;
  }
}
export function assertEmployee(data: Record<string, unknown>, uid?: string) {
  if (!isActiveLinkedProfile(data) || text(data.status || 'active').toLowerCase() !== 'active' || (uid && text(data.guardAuthUid) !== uid))
    throw new DutyError(403, 'inactive_guard', 'An active guard record is required.');
}
export function employeeDistrict(data: Record<string, unknown>) {
  return canonicalizeDistrictName(resolveEmployeeDistrict(data)) || resolveEmployeeDistrict(data);
}
export function isWillingnessEligible(employee: Record<string, unknown>, district: string) {
  return isActiveLinkedProfile(employee) && text(employee.status || 'active').toLowerCase() === 'active' && parseTcsCategory(employee.clientName, employee.tcsCategory) === 'adhoc' && !!district && districtMatches(employeeDistrict(employee), district);
}
export type DutySite = {
  id: string;
  siteName: string;
  clientName: string;
  district: string;
  data: Record<string, any>;
};
export function siteFromSnapshot(snap: FirebaseFirestore.DocumentSnapshot): DutySite {
  if (!snap.exists)
    throw new DutyError(404, 'site_not_found', 'Site not found.');
  const data = snap.data()!;
  if (!isActiveLinkedProfile(data) || !['active', ''].includes(text(data.status).toLowerCase()))
    throw new DutyError(409, 'inactive_site', 'Site is not active.');
  const district = canonicalizeDistrictName(text(data.district || data.districtName));
  if (!district)
    throw new DutyError(403, 'wrong_scope', 'Site district is not configured.');
  return {
    id: snap.id,
    siteName: text(data.siteName || data.name) || 'Site',
    clientName: text(data.clientName),
    district,
    data
  };
}
export async function resolveDutySite(database: FirebaseFirestore.Firestore, id: string) {
  return siteFromSnapshot(await database.collection('sites').doc(documentId(id)).get());
}
export async function transactionSite(tx: FirebaseFirestore.Transaction, id: string) {
  return siteFromSnapshot(await tx.get(db.collection('sites').doc(documentId(id))));
}
export function canonicalDutyDate(value: unknown) {
  let date: string;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    date = value;
  else {
    const serialized = iso(value);
    const timestamp = serialized ? Date.parse(serialized) : NaN;
    if (!Number.isFinite(timestamp))
      invalid('Invalid duty date.');
    date = new Date(timestamp + 19800000).toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    invalid('Invalid duty date.');
  return date;
}
export function inputDutyDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalid("Use YYYY-MM-DD for the duty date.");
  return canonicalDutyDate(value);
}
export function respondBy(date: string) {
  return new Date(`${canonicalDutyDate(date)}T00:00:00+05:30`).toISOString();
}
export function istToday(now = new Date()) {
  return new Date(now.getTime() + 19800000).toISOString().slice(0, 10);
}
export function addDays(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
export function dateWindow(from?: string | null, to?: string | null) {
  const start = inputDutyDate(from || istToday());
  const end = inputDutyDate(to || addDays(start, 90));
  const span = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (span < 0 || span > 90)
    invalid('Date window must be at most 90 days.');
  return {
    from: start,
    to: end
  };
}
export function assertOpenExam(order: Record<string, unknown>, site: DutySite, now = new Date()) {
  if (!isOperationalWorkOrderClientName(text(order.clientName)) || !isOperationalWorkOrderClientName(site.clientName))
    throw new DutyError(404, 'duty_not_found', 'Exam duty not found.');
  if (text(order.recordStatus || 'active').toLowerCase() !== 'active')
    throw new DutyError(409, 'duty_cancelled', 'Exam duty is no longer active.');
  if (now.getTime() >= Date.parse(respondBy(canonicalDutyDate(order.date))))
    throw new DutyError(409, 'duty_closed', 'Responses close when the duty day starts.');
}
export async function pagedQuery(query: FirebaseFirestore.Query) {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (;;) {
    const page = await query.limit(400).get();
    docs.push(...page.docs);
    if (page.docs.length < 400)
      break;
    query = query.startAfter(page.docs[page.docs.length - 1]);
  }
  return docs;
}
