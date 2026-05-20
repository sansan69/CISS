import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);
    const body = (await request.json()) as { assignmentId?: string };
    const assignmentId = normalizeText(body.assignmentId);
    if (!assignmentId) {
      return NextResponse.json({ error: "assignmentId is required." }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const assignmentRef = adminDb.collection("trainingAssignments").doc(assignmentId);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }

    const assignment = assignmentSnap.data() as Record<string, unknown>;
    const belongs =
      assignment.employeeId === guard.employeeDocId ||
      assignment.employeeId === guard.employeeId ||
      assignment.employeeDocId === guard.employeeDocId;
    if (!belongs) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const currentStatus = normalizeText(assignment.status || "assigned").toLowerCase();
    if (currentStatus !== "completed" && currentStatus !== "failed") {
      await assignmentRef.set(
        {
          status: "viewed",
          acknowledgedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not acknowledge training.";
    if (message.includes("Missing bearer token") || message.includes("Guard access required")) {
      return unauthorizedResponse(message);
    }
    return NextResponse.json({ error: "Could not acknowledge training." }, { status: 500 });
  }
}
