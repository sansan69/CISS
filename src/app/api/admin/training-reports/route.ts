import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  requireAdminOrFieldOfficer,
  verifyRequestAuth,
  unauthorizedResponse,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { districtMatches } from "@/lib/districts";
import type FirebaseFirestore from "@google-cloud/firestore";

type FieldOfficerProfile = {
  name: string;
  stateCode: string;
  assignedDistricts: string[];
};

type SiteSnapshotData = {
  id: string;
  clientId: string;
  clientName: string;
  siteName: string;
  district: string;
};

function serializeDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  if (typeof (value as { _seconds?: unknown })._seconds === "number") {
    return new Date((value as { _seconds: number })._seconds * 1000).toISOString();
  }
  return null;
}

function createdAtMillis(report: Record<string, unknown>) {
  const iso = serializeDate(report.createdAt) ?? serializeDate(report.trainingDate);
  return iso ? new Date(iso).getTime() : 0;
}

function serializeReport(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): Record<string, unknown> {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    ...data,
    trainingDate: serializeDate(data.trainingDate),
    createdAt: serializeDate(data.createdAt),
    acknowledgedAt: serializeDate(data.acknowledgedAt),
  };
}

async function getFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
): Promise<FieldOfficerProfile> {
  let name = decoded.name ?? decoded.email ?? "";
  let stateCode = decoded.stateCode ?? "KL";
  let assignedDistricts = Array.isArray(decoded.assignedDistricts) ? decoded.assignedDistricts : [];

  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!foSnapshot.empty) {
    const foData = foSnapshot.docs[0].data();
    name = typeof foData.name === "string" ? foData.name : name;
    stateCode = typeof foData.stateCode === "string" ? foData.stateCode : stateCode;
    assignedDistricts = Array.isArray(foData.assignedDistricts)
      ? foData.assignedDistricts.filter((district): district is string => typeof district === "string")
      : assignedDistricts;
  }

  return { name, stateCode, assignedDistricts };
}

async function resolveSite(
  adminDb: FirebaseFirestore.Firestore,
  siteId?: string,
): Promise<SiteSnapshotData | null> {
  if (!siteId) return null;
  const snap = await adminDb.collection("sites").doc(siteId).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    clientId: typeof data.clientId === "string" ? data.clientId : "",
    clientName: typeof data.clientName === "string" ? data.clientName : "",
    siteName: typeof data.siteName === "string" ? data.siteName : "",
    district: typeof data.district === "string" ? data.district : "",
  };
}

function canFieldOfficerUseDistrict(profile: FieldOfficerProfile, district?: string) {
  if (!district) return true;
  if (profile.assignedDistricts.length === 0) return false;
  return profile.assignedDistricts.some((assigned) => districtMatches(assigned, district));
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const fieldOfficerId = url.searchParams.get("fieldOfficerId");
    const clientId = url.searchParams.get("clientId");
    const district = url.searchParams.get("district");
    const isAdmin = hasAdminAccess(decoded);

    let q = adminDb.collection("foTrainingReports") as FirebaseFirestore.Query;

    if (!isAdmin) {
      q = q.where("fieldOfficerId", "==", decoded.uid);
    } else if (fieldOfficerId) {
      q = q.where("fieldOfficerId", "==", fieldOfficerId);
    } else {
      q = q.orderBy("createdAt", "desc");
    }

    const snapshot = await q.limit(isAdmin ? 500 : 300).get();
    const reports = snapshot.docs
      .map((d) => serializeReport(d))
      .filter((report) => !status || report.status === status)
      .filter((report) => !clientId || report.clientId === clientId)
      .filter((report) => !district || districtMatches(String(report.district ?? ""), district))
      .sort((left, right) => createdAtMillis(right) - createdAtMillis(left))
      .slice(0, 200);
    return NextResponse.json({ reports });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}

export async function POST(request: Request) {
  try {
    const decoded = requireAdminOrFieldOfficer(await verifyRequestAuth(request));
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const body = (await request.json()) as {
      clientId?: string;
      clientName?: string;
      siteId?: string;
      siteName?: string;
      district?: string;
      trainingDate?: string;
      durationMinutes?: number;
      topic?: string;
      description?: string;
      attendeeIds?: string[];
      attendeeCount?: number;
      status?: string;
      photoUrls?: string[];
    };

    if (!body.clientId || !body.trainingDate || !body.topic) {
      return NextResponse.json({ error: "clientId, trainingDate, and topic are required." }, { status: 400 });
    }

    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return NextResponse.json({ error: "Field officer or admin access required." }, { status: 403 });
    }

    const profile = await getFieldOfficerProfile(adminDb, decoded);
    const site = await resolveSite(adminDb, body.siteId);
    const reportDistrict = site?.district || body.district || profile.assignedDistricts[0] || "";

    if (!hasAdminAccess(decoded) && !canFieldOfficerUseDistrict(profile, reportDistrict)) {
      return NextResponse.json(
        { error: "This site is outside your assigned districts." },
        { status: 403 },
      );
    }

    const docRef = await adminDb.collection("foTrainingReports").add({
      fieldOfficerId: decoded.uid,
      fieldOfficerName: profile.name,
      stateCode: profile.stateCode,
      district: reportDistrict,
      clientId: site?.clientId || body.clientId,
      clientName: site?.clientName || body.clientName || "",
      siteId: site?.id || body.siteId || "",
      siteName: site?.siteName || body.siteName || "",
      trainingDate: new Date(body.trainingDate),
      durationMinutes: body.durationMinutes ?? 60,
      topic: body.topic,
      description: body.description ?? "",
      attendeeIds: body.attendeeIds ?? [],
      attendeeCount: body.attendeeCount ?? 0,
      photoUrls: Array.isArray(body.photoUrls) ? body.photoUrls : [],
      attachmentUrls: [],
      status: body.status ?? "submitted",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
