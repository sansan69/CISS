import { verifyRequestAuth } from "@/lib/server/auth";

type GuardIdentity = {
  uid: string;
  employeeId: string;
  employeeDocId: string;
};

function claimAsString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function requireGuard(
  request: Request
): Promise<GuardIdentity> {
  const decodedToken = await verifyRequestAuth(request);

  if (decodedToken.role !== "guard") {
    throw new Error("Guard access required.");
  }

  const employeeId = claimAsString(decodedToken.employeeId);
  const employeeDocId = claimAsString(decodedToken.employeeDocId);

  if (employeeId && employeeDocId) {
    return { uid: decodedToken.uid, employeeId, employeeDocId };
  }

  const { db: adminDb } = await import("@/lib/firebaseAdmin");

  let employeeSnap = await adminDb
    .collection("employees")
    .where("guardAuthUid", "==", decodedToken.uid)
    .limit(1)
    .get();

  if (employeeSnap.empty && employeeId) {
    employeeSnap = await adminDb
      .collection("employees")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();
  }

  if (employeeSnap.empty && employeeId) {
    employeeSnap = await adminDb
      .collection("employees")
      .where("employeeCode", "==", employeeId)
      .limit(1)
      .get();
  }

  const employeeDoc = employeeSnap.docs[0];
  if (!employeeDoc) {
    throw new Error("Guard employee record not found.");
  }

  const employeeData = employeeDoc.data() as Record<string, unknown>;
  const resolvedEmployeeId =
    employeeId ||
    claimAsString(employeeData.employeeId) ||
    claimAsString(employeeData.employeeCode);

  if (!resolvedEmployeeId) {
    throw new Error("Guard employee ID is missing.");
  }

  return {
    uid: decodedToken.uid,
    employeeId: resolvedEmployeeId,
    employeeDocId: employeeDocId || employeeDoc.id,
  };
}
