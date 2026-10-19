/** Server-only audit; no submitted name, contact data, token or document value. */
export async function recordEmployeeAccess(db: FirebaseFirestore.Firestore, actorUid: string, employeeDocId: string) {
 const at = new Date();
 await db.collection('employeeAccessAudit').add({ action:'employee_opened', actorUid, employeeDocId, at, expiresAt:new Date(at.getTime() + 366 * 86400000) });
}
