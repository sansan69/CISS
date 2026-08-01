import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebaseAdmin";
import { requireGuard } from "@/lib/server/guard-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const guard = await requireGuard(request);
    const body = (await request.json()) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 500) {
      return NextResponse.json(
        { error: "Give a correction reason between 10 and 500 characters." },
        { status: 400 },
      );
    }

    const privateSnap = await db.collection("employeeAadhaarPrivate").doc(guard.employeeDocId).get();
    if (!privateSnap.exists || privateSnap.data()?.status !== "complete") {
      return NextResponse.json({ error: "No Aadhaar record is available for correction." }, { status: 409 });
    }

    const requests = db.collection("employees").doc(guard.employeeDocId).collection("aadhaarCorrectionRequests");
    const pending = await requests.where("status", "==", "pending").limit(1).get();
    if (!pending.empty) {
      return NextResponse.json({ status: "pending" }, { headers: { "Cache-Control": "no-store, private" } });
    }

    const now = Timestamp.now();
    const requestRef = requests.doc();
    const batch = db.batch();
    batch.set(requestRef, {
      employeeDocId: guard.employeeDocId,
      employeeId: guard.employeeId,
      requestedByUid: guard.uid,
      reason,
      status: "pending",
      requestedAt: now,
    });
    batch.set(db.collection("sensitiveDocumentAuditLogs").doc(), {
      action: "aadhaar_correction_requested",
      employeeDocId: guard.employeeDocId,
      category: "aadhaar",
      purpose: "esic_epf_registration",
      actorUid: guard.uid,
      actorType: "guard",
      correctionRequestId: requestRef.id,
      at: now,
    });
    await batch.commit();
    return NextResponse.json(
      { status: "pending" },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Correction request failed.";
    const status = message.includes("Guard access required") ? 403 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
