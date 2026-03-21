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

    let q = adminDb.collection("foTrainingReports").orderBy("createdAt", "desc") as FirebaseFirestore.Query;

    if (!hasAdminAccess(decoded)) {
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
      trainingDate?: string;
      durationMinutes?: number;
      topic?: string;
      description?: string;
      attendeeIds?: string[];
      attendeeCount?: number;
      status?: string;
    };

    if (!body.clientId || !body.trainingDate || !body.topic) {
      return NextResponse.json({ error: "clientId, trainingDate, and topic are required." }, { status: 400 });
    }

    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return NextResponse.json({ error: "Field officer or admin access required." }, { status: 403 });
    }

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

    const docRef = await adminDb.collection("foTrainingReports").add({
      fieldOfficerId: decoded.uid,
      fieldOfficerName,
      stateCode,
      district,
      clientId: body.clientId,
      clientName: body.clientName ?? "",
      siteId: body.siteId ?? "",
      trainingDate: new Date(body.trainingDate),
      durationMinutes: body.durationMinutes ?? 60,
      topic: body.topic,
      description: body.description ?? "",
      attendeeIds: body.attendeeIds ?? [],
      attendeeCount: body.attendeeCount ?? 0,
      photoUrls: [],
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
