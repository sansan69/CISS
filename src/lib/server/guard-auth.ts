import { verifyRequestAuth } from "@/lib/server/auth";
import { resolveActiveGuardProfile } from "@/lib/server/linked-profiles";

type GuardIdentity = {
  uid: string;
  employeeId: string;
  employeeDocId: string;
};

export async function requireGuard(
  request: Request
): Promise<GuardIdentity> {
  const decodedToken = await verifyRequestAuth(request);

  if (decodedToken.role !== "guard") {
    throw new Error("Guard access required.");
  }

  const { db: adminDb } = await import("@/lib/firebaseAdmin");
  const profile = await resolveActiveGuardProfile(adminDb, decodedToken);
  if (!profile) {
    throw new Error("Guard employee record not found.");
  }

  return {
    uid: decodedToken.uid,
    employeeId: profile.employeeId,
    employeeDocId: profile.employeeDocId,
  };
}
