import { NextResponse } from "next/server";
import type FirebaseFirestore from "@google-cloud/firestore";

import {
  hasAdminAccess,
  hasClientAccess,
  hasFieldOfficerAccess,
  verifyRequestAuth,
  unauthorizedResponse,
} from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";
import { districtMatches } from "@/lib/districts";
import {
  firstZodError,
  isClientVisibleReport,
  REPORT_SCHEMA_VERSION,
  trainingReportInputSchema,
} from "@/lib/reports/report-schema";
import {
  canFieldOfficerUseReportDistrict,
  getFieldOfficerReportProfile,
  reportCreatedAtMillis,
  reportMatchesAdminScope,
  resolveReportSite,
  serializeReport,
  serializeReportDate,
} from "@/lib/reports/report-server";
import { validateReportAttachments } from "@/lib/reports/report-attachments.server";

export const runtime = "nodejs";

function reportLocationStatus(
  location: { lat: number; lng: number } | null | undefined,
  site: Awaited<ReturnType<typeof resolveReportSite>>,
) {
  if (!location) return "not_captured";
  if (site?.latitude === null || site?.longitude === null || !site) return "captured_off_site";
  return "captured_off_site";
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const isAdmin = hasAdminAccess(decoded);
    const isClient = hasClientAccess(decoded);
    const isFieldOfficer = hasFieldOfficerAccess(decoded);
    if (!isAdmin && !isClient && !isFieldOfficer) {
      return unauthorizedResponse("Report access is not available for this role.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const fieldOfficerId = url.searchParams.get("fieldOfficerId");
    const clientId = url.searchParams.get("clientId");
    const district = url.searchParams.get("district");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const clientScope = isClient ? await resolveClientScope(adminDb, decoded) : null;

    if (isClient && !clientScope) {
      return unauthorizedResponse("Client account is not linked to a valid client profile.", 403);
    }
    if (isClient && status === "draft") {
      return NextResponse.json({ reports: [], nextCursor: null });
    }

    let query = adminDb.collection("foTrainingReports") as FirebaseFirestore.Query;
    if (isClient && clientScope) {
      query = query.where("clientId", "==", clientScope.clientId).orderBy("createdAt", "desc");
    } else if (isFieldOfficer) {
      query = query.where("fieldOfficerId", "==", decoded.uid).orderBy("createdAt", "desc");
    } else if (decoded.role !== "superAdmin") {
      query = query.where("stateCode", "==", decoded.stateCode || "KL").orderBy("createdAt", "desc");
    } else if (fieldOfficerId) {
      query = query.where("fieldOfficerId", "==", fieldOfficerId).orderBy("createdAt", "desc");
    } else {
      query = query.orderBy("createdAt", "desc");
    }

    const snapshot = await query.limit(250).get();
    const reports = snapshot.docs
      .map((doc) => serializeReport(doc, "trainingDate"))
      .filter((report) => !clientScope || matchesClientScope(report, clientScope))
      .filter((report) => !isClient || isClientVisibleReport(report))
      .filter((report) => !isAdmin || reportMatchesAdminScope(report, decoded))
      .filter((report) => !status || report.status === status || report.reviewStatus === status)
      .filter((report) => !clientId || report.clientId === clientId)
      .filter((report) => !district || districtMatches(String(report.district ?? ""), district))
      .filter((report) => {
        if (!startDate && !endDate) return true;
        const date = serializeReportDate(report.trainingDate)?.slice(0, 10);
        if (!date) return false;
        return (!startDate || date >= startDate) && (!endDate || date <= endDate);
      })
      .sort(
        (left, right) =>
          reportCreatedAtMillis(right, "trainingDate") -
          reportCreatedAtMillis(left, "trainingDate"),
      )
      .slice(0, 200);

    const readerReports = isClient
      ? reports.map((report) => ({ ...report, reviewNotes: undefined, reviewedBy: undefined }))
      : reports;
    return NextResponse.json({ reports: readerReports, nextCursor: null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load training reports.";
    return unauthorizedResponse(message);
  }
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer access required.", 403);
    }

    const parsed = trainingReportInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstZodError(parsed.error) }, { status: 400 });
    }
    const body = parsed.data;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const profile = await getFieldOfficerReportProfile(adminDb, decoded);
    const site = await resolveReportSite(adminDb, body.siteId);

    if (body.status === "submitted" && !site) {
      return NextResponse.json({ error: "Select a valid site before submitting." }, { status: 400 });
    }
    if (site?.clientId && site.clientId !== body.clientId) {
      return NextResponse.json(
        { error: "The selected site does not belong to the selected client." },
        { status: 400 },
      );
    }

    const reportDistrict = site?.district || body.district || profile.assignedDistricts[0] || "";
    if (!canFieldOfficerUseReportDistrict(profile, reportDistrict)) {
      return NextResponse.json({ error: "This site is outside your assigned districts." }, { status: 403 });
    }
    const trainingPhotoCount =
      body.photoUrls.length +
      body.attachments.filter((item) => item.category === "training_photo").length;
    if (body.status === "submitted" && trainingPhotoCount < 1) {
      return NextResponse.json(
        { error: "At least one training session photo is required before submitting." },
        { status: 400 },
      );
    }
    const hasSignedReport =
      Boolean(body.clientReportUrl?.trim()) ||
      body.attachments.some((item) => item.category === "signed_report");
    if (body.status === "submitted" && !hasSignedReport) {
      return NextResponse.json(
        { error: "A client-signed training report is required before submitting." },
        { status: 400 },
      );
    }

    const collection = adminDb.collection("foTrainingReports");
    const reportRef = body.reportId ? collection.doc(body.reportId) : collection.doc();
    if (body.attachments.length > 0 && !body.reportId) {
      return NextResponse.json(
        { error: "A report identifier is required for secure attachments." },
        { status: 400 },
      );
    }
    if (body.reportId && body.attachments.length > 0) {
      await validateReportAttachments({
        attachments: body.attachments,
        reportType: "training",
        reportId: body.reportId,
        uid: decoded.uid,
      });
    }
    const eventRef = adminDb.collection("foReportEvents").doc();
    const now = FieldValue.serverTimestamp();
    const submitted = body.status === "submitted";
    const reportData = {
      ...body,
      reportType: "training",
      schemaVersion: REPORT_SCHEMA_VERSION,
      revisionNumber: 1,
      fieldOfficerId: decoded.uid,
      fieldOfficerName: profile.name,
      fieldOfficerSnapshot: {
        uid: decoded.uid,
        name: profile.name,
        stateCode: profile.stateCode,
      },
      stateCode: site?.stateCode || profile.stateCode,
      district: reportDistrict,
      clientId: site?.clientId || body.clientId,
      clientName: site?.clientName || body.clientName || "",
      siteId: site?.id || body.siteId || "",
      siteName: site?.siteName || body.siteName || "",
      siteSnapshot: site,
      trainingDate: new Date(body.trainingDate),
      trainingStartedAt: body.trainingStartedAt ? new Date(body.trainingStartedAt) : null,
      trainingEndedAt: body.trainingEndedAt ? new Date(body.trainingEndedAt) : null,
      locationStatus: reportLocationStatus(body.visitLocation, site),
      reviewStatus: "unreviewed",
      clientStatus: submitted ? "unseen" : null,
      visibility: submitted ? "client_visible" : "private_draft",
      submittedAt: submitted ? now : null,
      createdAt: now,
      updatedAt: now,
    };

    await adminDb.runTransaction(async (transaction) => {
      const existing = await transaction.get(reportRef);
      if (existing.exists) {
        const data = existing.data() ?? {};
        if (
          body.submissionIdempotencyKey &&
          data.submissionIdempotencyKey === body.submissionIdempotencyKey &&
          data.fieldOfficerId === decoded.uid
        ) {
          return;
        }
        throw new Error("A report with this identifier already exists.");
      }
      transaction.create(reportRef, reportData);
      transaction.create(eventRef, {
        reportId: reportRef.id,
        reportType: "training",
        revisionNumber: 1,
        action: submitted ? "submitted" : "draft_created",
        actorId: decoded.uid,
        actorRole: "fieldOfficer",
        stateCode: site?.stateCode || profile.stateCode,
        clientId: site?.clientId || body.clientId,
        eventAt: now,
      });
    });

    return NextResponse.json(
      {
        id: reportRef.id,
        status: body.status,
        visibility: submitted ? "client_visible" : "private_draft",
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not save training report.";
    const status = message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
