import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";

export const runtime = "nodejs";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return normalizeText(value);
}

async function getAssignedDistricts(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  const snapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();
  if (!snapshot.empty) {
    const districts = snapshot.docs[0].data().assignedDistricts;
    if (Array.isArray(districts)) {
      return canonicalizeDistrictList(
        districts.filter((district): district is string => typeof district === "string"),
      );
    }
  }
  return canonicalizeDistrictList(
    Array.isArray(decoded.assignedDistricts)
      ? decoded.assignedDistricts.filter((district): district is string => typeof district === "string")
      : [],
  );
}

function canAccessDistrict(
  isAdmin: boolean,
  assignedDistricts: string[],
  district: string,
) {
  return (
    isAdmin ||
    (assignedDistricts.length > 0 &&
      assignedDistricts.some((assigned) => districtMatches(assigned, district)))
  );
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const isAdmin = hasAdminAccess(decoded);
    const assignedDistricts = isAdmin ? [] : await getAssignedDistricts(adminDb, decoded);
    if (!isAdmin && assignedDistricts.length === 0) {
      return NextResponse.json({ events: [] });
    }

    const snapshot = await adminDb
      .collection("workOrderRevisionEvents")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    const events = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          workOrderId: normalizeText(data.workOrderId),
          importId: normalizeText(data.importId),
          revisionNumber: Number(data.revisionNumber ?? 1),
          changeType: normalizeText(data.changeType),
          siteName: normalizeText(data.siteName),
          district: normalizeText(data.district),
          date: toIso(data.date),
          previousMaleGuardsRequired: Number(data.previousMaleGuardsRequired ?? 0),
          previousFemaleGuardsRequired: Number(data.previousFemaleGuardsRequired ?? 0),
          maleGuardsRequired: Number(data.maleGuardsRequired ?? 0),
          femaleGuardsRequired: Number(data.femaleGuardsRequired ?? 0),
          affectedGuardCount: Number(data.affectedGuardCount ?? 0),
          assignmentReviewRequired: data.assignmentReviewRequired === true,
          acknowledged:
            Array.isArray(data.acknowledgedBy) && data.acknowledgedBy.includes(decoded.uid),
          createdAt: toIso(data.createdAt),
        };
      })
      .filter((event) => canAccessDistrict(isAdmin, assignedDistricts, event.district));

    return NextResponse.json({ events });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load revision changes.";
    return unauthorizedResponse(message, message.includes("access required") ? 403 : 401);
  }
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }
    const body = await request.json();
    const eventId = normalizeText(body.eventId);
    if (!eventId) {
      return NextResponse.json({ error: "eventId is required." }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const isAdmin = hasAdminAccess(decoded);
    const assignedDistricts = isAdmin ? [] : await getAssignedDistricts(adminDb, decoded);
    const eventRef = adminDb.collection("workOrderRevisionEvents").doc(eventId);
    const eventSnapshot = await eventRef.get();
    if (!eventSnapshot.exists) {
      return NextResponse.json({ error: "Revision event not found." }, { status: 404 });
    }
    const district = normalizeText(eventSnapshot.data()?.district);
    if (!canAccessDistrict(isAdmin, assignedDistricts, district)) {
      return unauthorizedResponse("This revision is outside your assigned districts.", 403);
    }

    await eventRef.update({
      acknowledgedBy: FieldValue.arrayUnion(decoded.uid),
      acknowledgedAtByUser: {
        [decoded.uid]: new Date(),
      },
    });
    return NextResponse.json({ eventId, acknowledged: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not acknowledge revision.";
    return unauthorizedResponse(message, message.includes("access required") ? 403 : 401);
  }
}
