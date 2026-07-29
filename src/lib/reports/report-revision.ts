import type FirebaseFirestore from "@google-cloud/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { AppDecodedToken } from "@/lib/server/auth";
import { ReportApiError } from "@/lib/reports/report-server";

const RESET_FIELDS = [
  "submittedAt",
  "reviewedAt",
  "reviewedBy",
  "reviewNotes",
  "clientActionAt",
  "clientActionBy",
  "clientNote",
  "supersededAt",
  "supersededByRevisionId",
] as const;

export async function createReportRevision({
  adminDb,
  decoded,
  reportId,
  collectionName,
  reportType,
}: {
  adminDb: FirebaseFirestore.Firestore;
  decoded: AppDecodedToken;
  reportId: string;
  collectionName: "foVisitReports" | "foTrainingReports";
  reportType: "visit" | "training";
}) {
  const sourceRef = adminDb.collection(collectionName).doc(reportId);
  const revisionRef = adminDb.collection(collectionName).doc();
  const eventRef = adminDb.collection("foReportEvents").doc();
  const now = FieldValue.serverTimestamp();

  await adminDb.runTransaction(async (transaction) => {
    const sourceSnapshot = await transaction.get(sourceRef);
    if (!sourceSnapshot.exists) throw new ReportApiError("Not found", 404);
    const source = sourceSnapshot.data() ?? {};
    if (source.fieldOfficerId !== decoded.uid) {
      throw new ReportApiError("Only the submitting field officer can create a revision.", 403);
    }
    if (source.status === "draft") {
      throw new ReportApiError("Edit the existing draft instead of creating a revision.", 409);
    }
    if (source.status === "superseded" || source.status === "archived") {
      throw new ReportApiError("Create a revision from the current submitted version.", 409);
    }

    const revision: Record<string, unknown> = {
      ...source,
      status: "draft",
      visibility: "private_draft",
      reviewStatus: "unreviewed",
      clientStatus: null,
      revisionNumber: Number(source.revisionNumber ?? 1) + 1,
      previousRevisionId: reportId,
      createdAt: now,
      updatedAt: now,
      submissionIdempotencyKey: null,
    };
    for (const field of RESET_FIELDS) delete revision[field];

    transaction.create(revisionRef, revision);
    transaction.create(eventRef, {
      reportId: revisionRef.id,
      reportType,
      revisionNumber: revision.revisionNumber,
      previousRevisionId: reportId,
      action: "revision_draft_created",
      actorId: decoded.uid,
      actorRole: "fieldOfficer",
      clientId: source.clientId,
      stateCode: source.stateCode,
      eventAt: now,
    });
  });

  return {
    id: revisionRef.id,
    previousRevisionId: reportId,
  };
}
