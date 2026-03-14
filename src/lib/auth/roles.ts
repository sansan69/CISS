import type { User } from "firebase/auth";
import { doc, getDoc, getDocs, query, where, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isLegacyAdminEmail } from "@/lib/auth/admin";
import type { AppRole, ResolvedAppUser } from "@/types/app";

function claimsToRole(claims: Record<string, unknown> | undefined): AppRole | null {
  if (claims?.admin === true || claims?.role === "admin") {
    return "admin";
  }

  if (claims?.role === "fieldOfficer") {
    return "fieldOfficer";
  }

  if (claims?.role === "client") {
    return "client";
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

  if (claimedRole === "admin" || isLegacyAdminEmail(user.email ?? tokenEmail)) {
    return { role: "admin", assignedDistricts: [] };
  }

  const officersRef = collection(db, "fieldOfficers");
  const officerSnapshot = await getDocs(query(officersRef, where("uid", "==", user.uid)));
  if (!officerSnapshot.empty) {
    const officerData = officerSnapshot.docs[0].data() as { assignedDistricts?: string[] };
    const refreshedRole = claimedRole === "fieldOfficer" ? claimedRole : await refreshClaimedRole(user);
    return {
      role: refreshedRole === "fieldOfficer" ? "fieldOfficer" : "user",
      assignedDistricts: officerData.assignedDistricts || [],
    };
  }

  const clientMapping = await getDoc(doc(db, "clientUsersByUid", user.uid));
  if (clientMapping.exists()) {
    const data = clientMapping.data() as { clientId?: string; clientName?: string };
    const refreshedRole = claimedRole === "client" ? claimedRole : await refreshClaimedRole(user);
    return {
      role: refreshedRole === "client" ? "client" : "user",
      assignedDistricts: [],
      clientId: data.clientId,
      clientName: data.clientName,
    };
  }

  return {
    role: claimedRole ?? "user",
    assignedDistricts: [],
  };
}
