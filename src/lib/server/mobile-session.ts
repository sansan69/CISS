import type { AppDecodedToken } from "@/lib/server/auth";
import {
  resolveActiveFieldOfficerProfile,
  resolveActiveGuardProfile,
} from "@/lib/server/linked-profiles";

export type MobileSessionPayload = {
  role: "guard" | "fieldOfficer";
  displayName: string;
  primaryId: string;
  uid: string;
  email: string | null;
  employeeDocId?: string | null;
  assignedDistricts?: string[];
  clientId?: string | null;
  clientName?: string | null;
  district?: string | null;
  stateCode?: string | null;
  claimsRepaired: boolean;
};

async function readFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  const profile = await resolveActiveFieldOfficerProfile(adminDb, decoded);
  if (!profile) return null;

  return {
    displayName: profile.name,
    primaryId: decoded.uid,
    uid: decoded.uid,
    email: typeof decoded.email === "string" && decoded.email ? decoded.email : null,
    assignedDistricts: profile.assignedDistricts,
    stateCode: profile.stateCode,
  };
}

async function readGuardProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  const profile = await resolveActiveGuardProfile(adminDb, decoded);
  if (!profile) return null;
  const data = profile.data;

  const clientId = typeof data.clientId === "string" ? data.clientId.trim() : "";
  const clientName = typeof data.clientName === "string" ? data.clientName.trim() : "";
  const district = typeof data.district === "string" ? data.district.trim() : "";
  const stateCode = typeof data.stateCode === "string" ? data.stateCode.trim() : "";

  return {
    displayName: typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Guard",
    primaryId: profile.employeeId,
    uid: decoded.uid,
    email: typeof decoded.email === "string" && decoded.email ? decoded.email : null,
    employeeDocId: profile.employeeDocId,
    clientId: clientId || null,
    clientName: clientName || null,
    district: district || null,
    stateCode: stateCode || null,
  };
}

export async function resolveMobileSession(
  decoded: AppDecodedToken,
): Promise<MobileSessionPayload | null> {
  const { db: adminDb } = await import("@/lib/firebaseAdmin");

  const fieldOfficer = await readFieldOfficerProfile(adminDb, decoded);
  if (fieldOfficer) {
    return {
      role: "fieldOfficer",
      claimsRepaired: false,
      ...fieldOfficer,
    };
  }

  const guard = await readGuardProfile(adminDb, decoded);
  if (guard) {
    return {
      role: "guard",
      assignedDistricts: [],
      claimsRepaired: false,
      ...guard,
    };
  }

  return null;
}
