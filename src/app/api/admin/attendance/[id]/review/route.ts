import { NextResponse } from "next/server";
import { z } from "zod";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  verifyRequestAuth,
} from "@/lib/server/auth";
import { districtMatches } from "@/lib/districts";
import { buildServerAuditEvent } from "@/lib/server/audit";

export const runtime = "nodejs";

const reviewSchema = z.object({
  action: z.enum(["approve", "reject", "correct"]),
  note: z.string().trim().min(3).max(1000),
  correctedOutAt: z.string().datetime().optional(),
}).superRefine((value, context) => {
  if (value.action === "correct" && !value.correctedOutAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["correctedOutAt"],
      message: "Corrected OUT time is required.",
    });
  }
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const isAdmin = hasAdminAccess(decoded);
    const isFieldOfficer = hasFieldOfficerAccess(decoded);
    if (!isAdmin && !isFieldOfficer) {
      return NextResponse.json(
        { error: "Admin or field officer access required." },
        { status: 403 },
      );
    }

    const input = reviewSchema.parse(await request.json());
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
    const logRef = adminDb.collection("attendanceLogs").doc(id);

    await adminDb.runTransaction(async (transaction) => {
      const logSnapshot = await transaction.get(logRef);
      if (!logSnapshot.exists) {
        throw new Error("Attendance record not found.");
      }
      const log = logSnapshot.data() as Record<string, unknown>;

      if (isFieldOfficer) {
        const assignedDistricts = Array.isArray(decoded.assignedDistricts)
          ? decoded.assignedDistricts.filter(
              (district): district is string => typeof district === "string",
            )
          : [];
        if (
          assignedDistricts.length === 0 ||
          !assignedDistricts.some((district) =>
            districtMatches(district, String(log.district ?? "")),
          )
        ) {
          throw new Error("Attendance record is outside your assigned districts.");
        }
      }

      const now = Timestamp.now();
      const reviewStatus =
        input.action === "approve"
          ? "approved"
          : input.action === "reject"
            ? "rejected"
            : "corrected";
      const update: Record<string, unknown> = {
        reviewStatus,
        reviewNote: input.note,
        requiresAdminReview: false,
        reviewedAt: now,
        reviewedByUid: decoded.uid,
        reviewedByRole: decoded.role ?? (isAdmin ? "admin" : "fieldOfficer"),
        updatedAt: now,
        auditTrail: FieldValue.arrayUnion(
          buildServerAuditEvent(
            `attendance_${reviewStatus}`,
            { uid: decoded.uid, email: decoded.email },
            { attendanceId: id, note: input.note },
          ),
        ),
      };

      if (input.action === "correct" && input.correctedOutAt) {
        if (log.status !== "Out") {
          throw new Error("Only an OUT record can have its checkout time corrected.");
        }
        update.originalReportedAt = log.originalReportedAt ?? log.reportedAt ?? null;
        update.reportedAt = Timestamp.fromDate(new Date(input.correctedOutAt));
        update.correctedOutAt = Timestamp.fromDate(new Date(input.correctedOutAt));

        if (typeof log.attendanceSessionId === "string" && log.attendanceSessionId) {
          transaction.set(
            adminDb
              .collection("attendanceSessions")
              .doc(log.attendanceSessionId),
            {
              endedAt: Timestamp.fromDate(new Date(input.correctedOutAt)),
              reviewStatus,
              reviewNote: input.note,
              reviewedAt: now,
              updatedAt: now,
            },
            { merge: true },
          );
        }
      }

      transaction.set(logRef, update, { merge: true });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Attendance review failed.";
    const status = error instanceof z.ZodError
      ? 400
      : message.includes("not found")
      ? 404
      : message.includes("assigned districts")
        ? 403
        : message.includes("access required")
          ? 403
          : message.includes("Missing bearer")
            ? 401
        : message.includes("required") || message.includes("Only an OUT")
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
