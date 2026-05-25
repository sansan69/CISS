import type FirebaseFirestore from "firebase-admin/firestore";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeEmployeeId(value: unknown) {
  return normalizeText(value).toUpperCase();
}

export function employeeIdRegistryDocId(employeeId: string) {
  return Buffer.from(normalizeEmployeeId(employeeId), "utf8").toString("base64url");
}

export function employeeIdRegistryRef(
  adminDb: FirebaseFirestore.Firestore,
  employeeId: string,
) {
  return adminDb.collection("employeeIds").doc(employeeIdRegistryDocId(employeeId));
}

export function buildEmployeeIdRegistryRecord(args: {
  employeeDocId: string;
  employeeId: string;
  clientName: string;
  status?: string;
  source: string;
  timestamp: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}) {
  return {
    employeeDocId: args.employeeDocId,
    employeeId: args.employeeId,
    normalizedEmployeeId: normalizeEmployeeId(args.employeeId),
    clientName: normalizeText(args.clientName),
    status: normalizeText(args.status || "Active"),
    active: true,
    source: args.source,
    createdAt: args.timestamp,
    updatedAt: args.timestamp,
  };
}

export async function employeeIdExists(
  adminDb: FirebaseFirestore.Firestore,
  employeeId: string,
) {
  const registrySnap = await employeeIdRegistryRef(adminDb, employeeId).get();
  if (registrySnap.exists) return true;

  const employeeSnap = await adminDb
    .collection("employees")
    .where("employeeId", "==", employeeId)
    .limit(1)
    .get();

  return !employeeSnap.empty;
}
