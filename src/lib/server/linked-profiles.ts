import { canonicalizeDistrictList } from "@/lib/districts";
import type { AppDecodedToken } from "@/lib/server/auth";

export type ActiveGuardProfile = {
  uid: string;
  employeeDocId: string;
  employeeId: string;
  data: Record<string, unknown>;
};

export type ActiveFieldOfficerProfile = {
  uid: string;
  profileDocId: string;
  name: string;
  stateCode: string;
  assignedDistricts: string[];
  data: Record<string, unknown>;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** A linked profile, not a token claim, is the authorization source of truth. */
export function isActiveLinkedProfile(data: Record<string, unknown>) {
  if (data.active === false || data.deprovisioned === true) return false;

  return !["inactive", "deprovisioned", "disabled", "deleted", "terminated"].includes(
    normalizeText(data.status).toLowerCase(),
  );
}

export async function resolveActiveGuardProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: Pick<AppDecodedToken, "uid" | "employeeDocId">,
): Promise<ActiveGuardProfile | null> {
  // A claimed document ID can reduce a lookup, but is never trusted as identity.
  const hintedDocId = normalizeText(decoded.employeeDocId);
  if (hintedDocId) {
    const hinted = await adminDb.collection("employees").doc(hintedDocId).get();
    const data = hinted.data() as Record<string, unknown> | undefined;
    if (
      hinted.exists &&
      data &&
      normalizeText(data.guardAuthUid) === decoded.uid &&
      isActiveLinkedProfile(data)
    ) {
      const employeeId = normalizeText(data.employeeId) || normalizeText(data.employeeCode);
      return employeeId
        ? { uid: decoded.uid, employeeDocId: hinted.id, employeeId, data }
        : null;
    }
  }

  const snapshot = await adminDb
    .collection("employees")
    .where("guardAuthUid", "==", decoded.uid)
    .limit(2)
    .get();

  // Duplicate UID links are unsafe. Setup PIN prevents new ones; existing ones fail closed.
  if (snapshot.docs.length !== 1) return null;

  const doc = snapshot.docs[0];
  const data = doc.data() as Record<string, unknown>;
  if (
    normalizeText(data.guardAuthUid) !== decoded.uid ||
    !isActiveLinkedProfile(data)
  ) {
    return null;
  }

  const employeeId = normalizeText(data.employeeId) || normalizeText(data.employeeCode);
  return employeeId ? { uid: decoded.uid, employeeDocId: doc.id, employeeId, data } : null;
}

export async function resolveActiveFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: Pick<AppDecodedToken, "uid">,
): Promise<ActiveFieldOfficerProfile | null> {
  const snapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(2)
    .get();

  if (snapshot.docs.length !== 1) return null;

  const doc = snapshot.docs[0];
  const data = doc.data() as Record<string, unknown>;
  if (normalizeText(data.uid) !== decoded.uid || !isActiveLinkedProfile(data)) {
    return null;
  }

  return {
    uid: decoded.uid,
    profileDocId: doc.id,
    name: normalizeText(data.name) || "Field Officer",
    stateCode: normalizeText(data.stateCode) || "KL",
    assignedDistricts: Array.isArray(data.assignedDistricts)
      ? canonicalizeDistrictList(
          data.assignedDistricts.filter(
            (district): district is string => typeof district === "string",
          ),
        )
      : [],
    data,
  };
}

export async function requireActiveFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: Pick<AppDecodedToken, "uid">,
) {
  const profile = await resolveActiveFieldOfficerProfile(adminDb, decoded);
  if (!profile) throw new Error("Field officer profile is not authorized.");
  return profile;
}
