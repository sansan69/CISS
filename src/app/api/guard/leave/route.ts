import { NextRequest, NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Fetch employee record for leave balance
    const empDoc = await adminDb
      .collection("employees")
      .doc(guard.employeeDocId)
      .get();
    const empData = empDoc.exists ? empDoc.data()! : {};

    const leaveBalance = {
      entitled: (empData.leaveEntitled as number) ?? 12,
      taken: (empData.leaveTaken as number) ?? 0,
      balance: (empData.leaveBalance as number) ?? 0,
      pending: (empData.leavePending as number) ?? 0,
    };

    // Fetch leave requests for this guard
    const requestsSnap = await adminDb
      .collection("leaveRequests")
      .where("employeeDocId", "==", guard.employeeDocId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const requests = requestsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        type: normalizeText(d.type || d.leaveType),
        startDate: d.startDate?.toDate?.()?.toISOString?.() ?? d.startDate ?? null,
        endDate: d.endDate?.toDate?.()?.toISOString?.() ?? d.endDate ?? null,
        reason: normalizeText(d.reason),
        status: normalizeText(d.status || "pending"),
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? d.createdAt ?? null,
      };
    });

    return NextResponse.json({
      balance: leaveBalance,
      requests,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/leave]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireGuard(request);
    const body = await request.json();
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const docRef = await adminDb.collection("leaveRequests").add({
      employeeDocId: guard.employeeDocId,
      employeeId: guard.employeeId,
      guardAuthUid: guard.uid,
      type: normalizeText(body.type || body.leaveType || "Annual"),
      leaveType: normalizeText(body.type || body.leaveType || "Annual"),
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      reason: normalizeText(body.reason),
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/leave POST]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireGuard(request);
    const body = await request.json();
    const requestId = normalizeText(body.requestId);
    if (!requestId) {
      return NextResponse.json(
        { error: "requestId is required." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");
    const ref = adminDb.collection("leaveRequests").doc(requestId);
    const doc = await ref.get();

    if (!doc.exists) {
      return NextResponse.json(
        { error: "Leave request not found." },
        { status: 404 },
      );
    }

    const data = doc.data()!;
    if (data.employeeDocId !== guard.employeeDocId) {
      return NextResponse.json(
        { error: "You can only cancel your own leave requests." },
        { status: 403 },
      );
    }

    await ref.update({
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/leave PATCH]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
