import type { User } from "firebase/auth";
import { doc, getDoc, getDocs, query, where, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isLegacyAdminEmail } from "@/lib/auth/admin";
import { canonicalizeDistrictList } from "@/lib/districts";
import type { AppRole, ResolvedAppUser } from "@/types/app";

function claimsToRole(claims: Record<string, unknown> | undefined): AppRole | null {
  if (claims?.role === "superAdmin") {
    return "superAdmin";
  }

  if (claims?.admin === true || claims?.role === "admin") {
    return "admin";
  }

  if (claims?.role === "fieldOfficer") {
    return "fieldOfficer";
  }

  if (claims?.role === "client") {
    return "client";
  }

  if (claims?.role === "guard") {
    return "guard";
  }

  return null;
}

async function refreshClaimedRole(user: User) {
  await user.getIdToken(true);
  const refreshedTokenResult = await user.getIdTokenResult();
  return claimsToRole(refreshedTokenResult.claims);
}

export async function resolveAppUser(user: User): Promise<ResolvedAppUser> {
  const tokenResult = await user.getIdTokenResult();
  const claimedRole = claimsToRole(tokenResult.claims);
  const tokenEmail =
    typeof tokenResult.claims.email === "string" ? tokenResult.claims.email : undefined;

  // Extract stateCode from custom claims
  const stateCode =
    typeof tokenResult.claims.stateCode === "string" ? tokenResult.claims.stateCode : null;

  if (claimedRole === "superAdmin") {
    return {
      role: "superAdmin",
      assignedDistricts: [],
      stateCode,
      isSuperAdmin: true,
    };
  }

  if (claimedRole === "guard") {
    const employeeId =
      typeof tokenResult.claims.employeeId === "string"
        ? tokenResult.claims.employeeId
        : undefined;
    const employeeDocId =
      typeof tokenResult.claims.employeeDocId === "string"
        ? tokenResult.claims.employeeDocId
        : undefined;
    return {
      role: "guard",
      assignedDistricts: [],
      stateCode,
      employeeId,
      employeeDocId,
      isSuperAdmin: false,
    };
  }

  if (claimedRole === "admin" || isLegacyAdminEmail(user.email ?? tokenEmail)) {
    return { role: "admin", assignedDistricts: [], stateCode, isSuperAdmin: false };
  }

  const officersRef = collection(db, "fieldOfficers");
  const [officerSnapshot, clientMapping] = await Promise.all([
    getDocs(query(officersRef, where("uid", "==", user.uid))),
    getDoc(doc(db, "clientUsersByUid", user.uid)),
  ]);

  if (!officerSnapshot.empty) {
    const raw = officerSnapshot.docs[0].data();
    const assignedDistricts = Array.isArray(raw?.assignedDistricts)
      ? canonicalizeDistrictList((raw.assignedDistricts as unknown[]).filter((district): district is string => typeof district === "string"))
      : [];
    const foStateCode = typeof raw?.stateCode === "string" ? raw.stateCode : stateCode;
    const refreshedRole = claimedRole === "fieldOfficer" ? claimedRole : await refreshClaimedRole(user);
    return {
      role: refreshedRole === "fieldOfficer" ? "fieldOfficer" : "user",
      assignedDistricts,
      stateCode: foStateCode,
      isSuperAdmin: false,
    };
  }

  if (clientMapping.exists()) {
    const raw = clientMapping.data();
    const clientId = typeof raw?.clientId === "string" ? raw.clientId : undefined;
    const clientName = typeof raw?.clientName === "string" ? raw.clientName : undefined;
    const refreshedRole = claimedRole === "client" ? claimedRole : await refreshClaimedRole(user);
    return {
      role: refreshedRole === "client" ? "client" : "user",
      assignedDistricts: [],
      clientId,
      clientName,
      stateCode,
      isSuperAdmin: false,
    };
  }

  return {
    role: claimedRole ?? "user",
    assignedDistricts: [],
    stateCode,
    isSuperAdmin: false,
  };
}
