import { NextResponse } from "next/server";
import type { UserRecord } from "firebase-admin/auth";

import { unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import { canonicalizeDistrictList } from "@/lib/districts";

type MobileSessionPayload = {
  role: "guard" | "fieldOfficer";
  displayName: string;
  primaryId: string;
  uid: string;
  email: string | null;
  employeeDocId?: string | null;
  assignedDistricts?: string[];
  clientId?: string | null;
  clientName?: string | null;
  stateCode?: string | null;
  claimsRepaired: boolean;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function readFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (foSnapshot.empty) {
    return null;
  }

  const doc = foSnapshot.docs[0];
  const data = doc.data();

  return {
    displayName:
      normalizeText(data.name) ||
      normalizeText(decoded.name) ||
      normalizeText(decoded.email) ||
      "Field Officer",
    primaryId: decoded.uid,
    uid: decoded.uid,
    email: normalizeText(decoded.email) || null,
    assignedDistricts: Array.isArray(data.assignedDistricts)
      ? canonicalizeDistrictList(
          data.assignedDistricts.filter((district): district is string => typeof district === "string"),
        )
      : Array.isArray(decoded.assignedDistricts)
        ? canonicalizeDistrictList(
            decoded.assignedDistricts.filter((district): district is string => typeof district === "string"),
          )
        : [],
    stateCode:
      normalizeText(data.stateCode) || normalizeText(decoded.stateCode) || "KL",
  };
}

async function readGuardProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  let guardSnapshot;

  const employeeDocId = normalizeText(decoded.employeeDocId);
  if (employeeDocId) {
    const employeeDoc = await adminDb.collection("employees").doc(employeeDocId).get();
    if (employeeDoc.exists) {
      guardSnapshot = {
        id: employeeDoc.id,
        data: () => employeeDoc.data() as Record<string, unknown>,
      };
    }
  }

  if (!guardSnapshot) {
    const byUid = await adminDb
      .collection("employees")
      .where("guardAuthUid", "==", decoded.uid)
      .limit(1)
      .get();

    if (byUid.empty) {
      return null;
    }

    guardSnapshot = byUid.docs[0];
  }

  const data = guardSnapshot.data();

  return {
    displayName:
      normalizeText(data.name) ||
      normalizeText(decoded.name) ||
      normalizeText(decoded.email) ||
      "Guard",
    primaryId:
      normalizeText(data.employeeId) || normalizeText(decoded.employeeId) || decoded.uid,
    uid: decoded.uid,
    email: normalizeText(decoded.email) || null,
    employeeDocId: guardSnapshot.id,
    clientId: normalizeText(data.clientId) || null,
    clientName: normalizeText(data.clientName) || null,
    stateCode:
      normalizeText(data.stateCode) || normalizeText(decoded.stateCode) || null,
  };
}

async function repairClaims(
  adminAuth: { getUser(uid: string): Promise<UserRecord>; setCustomUserClaims(uid: string, claims: Record<string, unknown>): Promise<unknown> },
  uid: string,
  patch: Record<string, unknown>,
) {
  const userRecord = await adminAuth.getUser(uid);
  const currentClaims = userRecord.customClaims || {};
  let changed = false;

  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      const currentValue = Array.isArray(currentClaims[key]) ? currentClaims[key] : [];
      if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
        changed = true;
        break;
      }
      continue;
    }

    if (currentClaims[key] !== value) {
      changed = true;
      break;
    }
  }

  if (!changed) {
    return false;
  }

  await adminAuth.setCustomUserClaims(uid, {
    ...currentClaims,
    ...patch,
  });

  return true;
}

async function resolveMobileSession(decoded: AppDecodedToken): Promise<MobileSessionPayload | null> {
  const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");

  const fieldOfficer = await readFieldOfficerProfile(adminDb, decoded);
  if (fieldOfficer) {
    const claimsRepaired = await repairClaims(adminAuth, decoded.uid, {
      role: "fieldOfficer",
      stateCode: fieldOfficer.stateCode,
      assignedDistricts: fieldOfficer.assignedDistricts,
    });

    return {
      role: "fieldOfficer",
      claimsRepaired,
      ...fieldOfficer,
    };
  }

  const guard = await readGuardProfile(adminDb, decoded);
  if (guard) {
    const claimsRepaired = await repairClaims(adminAuth, decoded.uid, {
      role: "guard",
      employeeId: guard.primaryId,
      employeeDocId: guard.employeeDocId,
    });

    return {
      role: "guard",
      assignedDistricts: [],
      claimsRepaired,
      ...guard,
    };
  }

  if (decoded.role === "fieldOfficer") {
    return {
      role: "fieldOfficer",
      displayName: normalizeText(decoded.name) || normalizeText(decoded.email) || "Field Officer",
      primaryId: decoded.uid,
      uid: decoded.uid,
      email: normalizeText(decoded.email) || null,
      assignedDistricts: Array.isArray(decoded.assignedDistricts) ? decoded.assignedDistricts : [],
      stateCode: normalizeText(decoded.stateCode) || null,
      claimsRepaired: false,
    };
  }

  if (decoded.role === "guard") {
    return {
      role: "guard",
      displayName: normalizeText(decoded.name) || normalizeText(decoded.email) || "Guard",
      primaryId: normalizeText(decoded.employeeId) || decoded.uid,
      uid: decoded.uid,
      email: normalizeText(decoded.email) || null,
      employeeDocId: normalizeText(decoded.employeeDocId) || null,
      assignedDistricts: [],
      clientId: normalizeText(decoded.clientId) || null,
      clientName: normalizeText(decoded.clientName) || null,
      stateCode: normalizeText(decoded.stateCode) || null,
      claimsRepaired: false,
    };
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const session = await resolveMobileSession(decoded);

    if (!session) {
      return unauthorizedResponse("This Firebase account is not linked to a mobile guard or field officer profile.", 403);
    }

    return NextResponse.json(session);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not resolve mobile session.";
    return unauthorizedResponse(message, 401);
  }
}
