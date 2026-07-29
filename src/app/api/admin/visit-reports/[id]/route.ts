import { NextResponse } from "next/server";
import type FirebaseFirestore from "@google-cloud/firestore";

import {
  hasAdminAccess,
  hasClientAccess,
  hasFieldOfficerAccess,
  verifyRequestAuth,
} from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";
import {
  firstZodError,
  isClientVisibleReport,
  reportClientUpdateSchema,
  reportReviewUpdateSchema,
  visitDraftUpdateSchema,
  visitReportInputSchema,
} from "@/lib/reports/report-schema";
import {
  ReportApiError,
  reportMatchesAdminScope,
  serializeReport,
  serializeReportDate,
} from "@/lib/reports/report-server";
import {
  addSignedAttachmentUrls,
  validateReportAttachments,
} from "@/lib/reports/report-attachments.server";

export const runtime = "nodejs";

async function canRead(
  adminDb: FirebaseFirestore.Firestore,
  decoded: Awaited<ReturnType<typeof verifyRequestAuth>>,
  report: Record<string, unknown>,
) {
  if (hasAdminAccess(decoded)) return reportMatchesAdminScope(report, decoded);
  if (hasFieldOfficerAccess(decoded)) return report.fieldOfficerId === decoded.uid;
  if (hasClientAccess(decoded)) {
    const scope = await resolveClientScope(adminDb, decoded);
    return Boolean(scope && isClientVisibleReport(report) && matchesClientScope(report, scope));
  }
  return false;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb.collection("foVisitReports").doc(id).get();
    if (!snapshot.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const raw = snapshot.data() ?? {};
    if (!(await canRead(adminDb, decoded, raw))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const eventsSnapshot = await adminDb
      .collection("foReportEvents")
      .where("reportId", "==", id)
      .orderBy("eventAt", "desc")
      .limit(50)
      .get();
    const report = await addSignedAttachmentUrls(serializeReport(snapshot, "visitDate"));
    const readerReport = hasClientAccess(decoded)
      ? { ...report, reviewNotes: undefined, reviewedBy: undefined }
      : report;
    return NextResponse.json({
      report: {
        ...readerReport,
        auditEvents: eventsSnapshot.docs
          .filter((event) =>
            !hasClientAccess(decoded) ||
            ["submitted", "client_acknowledged", "client_disputed"].includes(String(event.data().action)),
          )
          .map((event) => ({
            id: event.id,
            ...event.data(),
            actorId: hasClientAccess(decoded) ? undefined : event.data().actorId,
            note: hasClientAccess(decoded) ? undefined : event.data().note,
            eventAt: serializeReportDate(event.data().eventAt),
          })),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load visit report.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const { id } = await params;
    const rawBody = await request.json().catch(() => null);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const reportRef = adminDb.collection("foVisitReports").doc(id);
    const eventRef = adminDb.collection("foReportEvents").doc();
    const clientScope = hasClientAccess(decoded)
      ? await resolveClientScope(adminDb, decoded)
      : null;
    const now = FieldValue.serverTimestamp();

    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reportRef);
      if (!snapshot.exists) throw new ReportApiError("Not found", 404);
      const current = snapshot.data() ?? {};

      if (hasFieldOfficerAccess(decoded)) {
        if (current.fieldOfficerId !== decoded.uid) {
          throw new ReportApiError("Forbidden", 403);
        }
        if (current.status !== "draft") {
          const retry = visitDraftUpdateSchema.safeParse(rawBody);
          if (
            retry.success &&
            retry.data.status === "submitted" &&
            retry.data.submissionIdempotencyKey &&
            retry.data.submissionIdempotencyKey === current.submissionIdempotencyKey
          ) {
            return;
          }
          throw new ReportApiError(
            "Submitted reports are read-only. Create a revision to make corrections.",
            409,
          );
        }
        const previousRef =
          typeof current.previousRevisionId === "string"
            ? adminDb.collection("foVisitReports").doc(current.previousRevisionId)
            : null;
        const previousSnapshot = previousRef ? await transaction.get(previousRef) : null;
        const parsed = visitDraftUpdateSchema.safeParse(rawBody);
        if (!parsed.success) throw new ReportApiError(firstZodError(parsed.error), 400);
        const update = parsed.data;
        const submitting = update.status === "submitted";
        const merged = {
          clientId: update.clientId ?? current.clientId,
          clientName: update.clientName ?? current.clientName,
          siteId: update.siteId ?? current.siteId,
          siteName: update.siteName ?? current.siteName,
          district: update.district ?? current.district,
          status: submitting ? "submitted" : "draft",
          visitDate: update.visitDate ?? serializeReportDate(current.visitDate) ?? "",
          visitStartedAt:
            update.visitStartedAt ?? serializeReportDate(current.visitStartedAt) ?? undefined,
          visitEndedAt:
            update.visitEndedAt ?? serializeReportDate(current.visitEndedAt) ?? undefined,
          visitPurpose: update.visitPurpose ?? current.visitPurpose,
          visitMode: update.visitMode ?? current.visitMode,
          summary: update.summary ?? current.summary,
          issuesFound: update.issuesFound ?? current.issuesFound,
          actionsRequired: update.actionsRequired ?? current.actionsRequired,
          guardsPresentCount: update.guardsPresentCount ?? current.guardsPresentCount ?? 0,
          guardsAbsentCount: update.guardsAbsentCount ?? current.guardsAbsentCount ?? 0,
          photoUrls: update.photoUrls ?? current.photoUrls ?? [],
          attachmentUrls: update.attachmentUrls ?? current.attachmentUrls ?? [],
          attachments: update.attachments ?? current.attachments ?? [],
          visitLocation:
            update.visitLocation !== undefined ? update.visitLocation : current.visitLocation ?? null,
          submissionIdempotencyKey:
            update.submissionIdempotencyKey ?? current.submissionIdempotencyKey,
        };
        const validated = visitReportInputSchema.safeParse(merged);
        if (!validated.success) {
          throw new ReportApiError(firstZodError(validated.error), 400);
        }
        if (submitting && !merged.siteId) {
          throw new ReportApiError("Select a valid site before submitting.", 400);
        }
        const visitPhotoCount =
          merged.photoUrls.length +
          merged.attachments.filter((item: { category?: string }) => item.category === "visit_photo").length;
        if (submitting && visitPhotoCount < 1) {
          throw new ReportApiError(
            "At least one visit photo is required before submitting.",
            400,
          );
        }
        if (submitting && merged.attachments.length > 0) {
          await validateReportAttachments({
            attachments: merged.attachments,
            reportType: "visit",
            reportId: id,
            uid: decoded.uid,
          });
        }

        const nextData: Record<string, unknown> = {
          ...update,
          updatedAt: now,
        };
        if (update.visitDate) nextData.visitDate = new Date(update.visitDate);
        if (update.visitStartedAt) nextData.visitStartedAt = new Date(update.visitStartedAt);
        if (update.visitEndedAt) nextData.visitEndedAt = new Date(update.visitEndedAt);
        if (submitting) {
          nextData.status = "submitted";
          nextData.visibility = "client_visible";
          nextData.clientStatus = "unseen";
          nextData.reviewStatus = "unreviewed";
          nextData.submittedAt = now;
          if (previousRef && previousSnapshot?.exists) {
            transaction.update(previousRef, {
              status: "superseded",
              supersededByRevisionId: id,
              supersededAt: now,
              updatedAt: now,
            });
          }
        }
        transaction.update(
          reportRef,
          nextData as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
        );
        transaction.create(eventRef, {
          reportId: id,
          reportType: "visit",
          revisionNumber: Number(current.revisionNumber ?? 1),
          action: submitting ? "submitted" : "draft_updated",
          actorId: decoded.uid,
          actorRole: "fieldOfficer",
          clientId: current.clientId,
          stateCode: current.stateCode,
          eventAt: now,
        });
        return;
      }

      if (hasAdminAccess(decoded)) {
        if (!reportMatchesAdminScope(current, decoded)) {
          throw new ReportApiError("Forbidden", 403);
        }
        const parsed = reportReviewUpdateSchema.safeParse(rawBody);
        if (!parsed.success) throw new ReportApiError(firstZodError(parsed.error), 400);
        const reviewStatus =
          parsed.data.reviewStatus ?? (parsed.data.status === "reviewed" ? "reviewed" : undefined);
        if (!reviewStatus) throw new ReportApiError("Review status is required.", 400);
        transaction.update(reportRef, {
          reviewStatus,
          reviewNotes: parsed.data.reviewNotes ?? "",
          reviewedBy: decoded.uid,
          reviewedAt: now,
          updatedAt: now,
        });
        transaction.create(eventRef, {
          reportId: id,
          reportType: "visit",
          revisionNumber: Number(current.revisionNumber ?? 1),
          action: reviewStatus === "revision_requested" ? "revision_requested" : "reviewed",
          actorId: decoded.uid,
          actorRole: decoded.role,
          clientId: current.clientId,
          stateCode: current.stateCode,
          note: parsed.data.reviewNotes ?? "",
          eventAt: now,
        });
        return;
      }

      if (hasClientAccess(decoded)) {
        if (!clientScope || !isClientVisibleReport(current) || !matchesClientScope(current, clientScope)) {
          throw new ReportApiError("Forbidden", 403);
        }
        const parsed = reportClientUpdateSchema.safeParse(rawBody);
        if (!parsed.success) throw new ReportApiError(firstZodError(parsed.error), 400);
        transaction.update(reportRef, {
          clientStatus: parsed.data.clientStatus,
          clientNote: parsed.data.clientNote ?? "",
          clientActionBy: decoded.uid,
          clientActionAt: now,
          updatedAt: now,
        });
        transaction.create(eventRef, {
          reportId: id,
          reportType: "visit",
          revisionNumber: Number(current.revisionNumber ?? 1),
          action:
            parsed.data.clientStatus === "acknowledged"
              ? "client_acknowledged"
              : "client_disputed",
          actorId: decoded.uid,
          actorRole: "client",
          clientId: current.clientId,
          note: parsed.data.clientNote ?? "",
          eventAt: now,
        });
        return;
      }

      throw new ReportApiError("Forbidden", 403);
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const status = error instanceof ReportApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Could not update visit report.";
    return NextResponse.json({ error: message }, { status });
  }
}
