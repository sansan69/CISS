import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  requireAdminOrFieldOfficer,
  verifyRequestAuth,
  unauthorizedResponse,
} from "@/lib/server/auth";
import type FirebaseFirestore from "@google-cloud/firestore";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const fieldOfficerId = url.searchParams.get("fieldOfficerId");
    const clientId = url.searchParams.get("clientId");
    const district = url.searchParams.get("district");

    let q = adminDb.collection("foVisitReports").orderBy("createdAt", "desc") as FirebaseFirestore.Query;

    if (!hasAdminAccess(decoded)) {
      // Field officers only see their own
      q = q.where("fieldOfficerId", "==", decoded.uid);
    } else if (fieldOfficerId) {
      q = q.where("fieldOfficerId", "==", fieldOfficerId);
    }

    if (status) q = q.where("status", "==", status);
    if (clientId) q = q.where("clientId", "==", clientId);
    if (district) q = q.where("district", "==", district);

    const snapshot = await q.limit(200).get();
    const reports = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
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
      visitDate?: string;
      summary?: string;
      issuesFound?: string;
      actionsRequired?: string;
      guardsPresentCount?: number;
      guardsAbsentCount?: number;
      status?: string;
    };

    if (!body.clientId || !body.visitDate || !body.summary) {
      return NextResponse.json({ error: "clientId, visitDate, and summary are required." }, { status: 400 });
    }

    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return NextResponse.json({ error: "Field officer or admin access required." }, { status: 403 });
    }

    // Look up field officer doc for name + stateCode
    let fieldOfficerName = decoded.name ?? decoded.email ?? "";
    let stateCode = "KL";
    let district = "";

    const foSnapshot = await adminDb
      .collection("fieldOfficers")
      .where("uid", "==", decoded.uid)
      .limit(1)
      .get();

    if (!foSnapshot.empty) {
      const foData = foSnapshot.docs[0].data();
      fieldOfficerName = foData.name ?? fieldOfficerName;
      stateCode = foData.stateCode ?? stateCode;
      district = foData.assignedDistricts?.[0] ?? foData.district ?? "";
    }

    const docRef = await adminDb.collection("foVisitReports").add({
      fieldOfficerId: decoded.uid,
      fieldOfficerName,
      stateCode,
      district,
      clientId: body.clientId,
      clientName: body.clientName ?? "",
      siteId: body.siteId ?? "",
      siteName: body.siteName ?? "",
      visitDate: new Date(body.visitDate),
      summary: body.summary,
      issuesFound: body.issuesFound ?? "",
      actionsRequired: body.actionsRequired ?? "",
      guardsPresentCount: body.guardsPresentCount ?? 0,
      guardsAbsentCount: body.guardsAbsentCount ?? 0,
      photoUrls: [],
      status: body.status ?? "draft",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
