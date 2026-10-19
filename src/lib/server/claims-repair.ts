import { isActiveLinkedProfile } from "@/lib/server/linked-profiles";

export type ClaimsRepairSource = "fieldOfficers" | "clientUsersByUid";

export type ClaimsRepairPlan = {
  uid: string;
  email?: string;
  expectedRole: "fieldOfficer" | "client";
  currentRole: string | null;
  source: ClaimsRepairSource;
  claimPatch: Record<string, unknown>;
};

/** Index linked profiles without silently selecting one of several records. */
export function indexClaimRepairProfilesByUid(
  profiles: Record<string, unknown>[],
): Map<string, Record<string, unknown> | null> {
  const indexed = new Map<string, Record<string, unknown> | null>();
  for (const profile of profiles) {
    if (typeof profile.uid !== "string") continue;
    indexed.set(profile.uid, indexed.has(profile.uid) ? null : profile);
  }
  return indexed;
}

export function buildClaimRepairPlanFromIndexes({
  uid,
  email,
  fieldOfficersByUid,
  clientUsersByUid,
  claims,
}: {
  uid: string;
  email?: string;
  fieldOfficersByUid: Map<string, Record<string, unknown> | null>;
  clientUsersByUid: Map<string, Record<string, unknown> | null>;
  claims?: Record<string, unknown> | null;
}): ClaimsRepairPlan | null {
  // An ambiguous link in either collection makes the identity unsafe, even if
  // the other collection has a single profile that would otherwise be usable.
  if (
    (fieldOfficersByUid.has(uid) && fieldOfficersByUid.get(uid) === null) ||
    (clientUsersByUid.has(uid) && clientUsersByUid.get(uid) === null)
  ) return null;

  return buildClaimRepairPlanFromProfiles({
    uid,
    email,
    fieldOfficerProfile: fieldOfficersByUid.get(uid) ?? undefined,
    clientProfile: clientUsersByUid.get(uid) ?? undefined,
    claims,
  });
}

export function buildClaimRepairPlanFromProfiles({
  uid,
  email,
  fieldOfficerProfile,
  clientProfile,
  claims,
}: {
  uid: string;
  email?: string;
  fieldOfficerProfile?: Record<string, unknown>;
  clientProfile?: Record<string, unknown>;
  claims?: Record<string, unknown> | null;
}): ClaimsRepairPlan | null {
  // A UID linked to both profile types does not identify one safe role source.
  if (fieldOfficerProfile && clientProfile) return null;
  if (fieldOfficerProfile) {
    return buildClaimRepairPlan({
      uid,
      email,
      source: "fieldOfficers",
      profile: fieldOfficerProfile,
      claims,
    });
  }
  if (clientProfile) {
    return buildClaimRepairPlan({
      uid,
      email,
      source: "clientUsersByUid",
      profile: clientProfile,
      claims,
    });
  }
  return null;
}

export function buildClaimRepairPlan({
  uid,
  email,
  source,
  profile,
  claims,
}: {
  uid: string;
  email?: string;
  source: ClaimsRepairSource;
  profile: Record<string, unknown>;
  claims?: Record<string, unknown> | null;
}): ClaimsRepairPlan | null {
  if (!uid || !isActiveLinkedProfile(profile)) return null;
  if (typeof profile.uid === "string" && profile.uid !== uid) return null;

  const expectedRole = source === "fieldOfficers" ? "fieldOfficer" : "client";
  const claimPatch = source === "fieldOfficers"
    ? {
        stateCode: typeof profile.stateCode === "string" ? profile.stateCode : "KL",
        assignedDistricts: Array.isArray(profile.assignedDistricts)
          ? profile.assignedDistricts
          : [],
      }
    : {
        stateCode: typeof profile.stateCode === "string" ? profile.stateCode : "KL",
        clientId: profile.clientId ?? null,
        clientName: profile.clientName ?? null,
      };

  const currentRole = claims?.admin === true || claims?.role === "admin"
    ? "admin"
    : claims?.role === "superAdmin"
      ? "superAdmin"
      : typeof claims?.role === "string"
        ? claims.role
        : null;

  // Never rewrite a privileged account based on a linked staff/client record.
  if (currentRole === "admin" || currentRole === "superAdmin") return null;

  const roleMatches = claims?.role === expectedRole;
  const scopeMatches = Object.entries(claimPatch).every(([key, value]) =>
    Array.isArray(value)
      ? Array.isArray(claims?.[key]) &&
        value.length === (claims[key] as unknown[]).length &&
        value.every((item, index) => Object.is(item, (claims[key] as unknown[])[index]))
      : Object.is(claims?.[key], value),
  );
  if (roleMatches && scopeMatches) return null;

  return { uid, email, expectedRole, currentRole, source, claimPatch };
}
