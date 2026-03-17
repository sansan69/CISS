import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const cycleDoc = await adminDb.collection("payrollCycles").doc(id).get();
    if (!cycleDoc.exists) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const cycleData = cycleDoc.data()!;
    if (cycleData.status === "finalized" || cycleData.status === "paid") {
      return NextResponse.json({ error: "Cycle already finalized" }, { status: 400 });
    }

    // Finalize cycle
    await adminDb.collection("payrollCycles").doc(id).update({
      status: "finalized",
      finalizedAt: FieldValue.serverTimestamp(),
      finalizedBy: decoded.uid,
    });

    // Finalize all entries in batches
    const entriesSnap = await adminDb
      .collection("payrollEntries")
      .where("cycleId", "==", id)
      .get();

    const BATCH_SIZE = 499;
    let batch = adminDb.batch();
    let count = 0;

    for (const entryDoc of entriesSnap.docs) {
      batch.update(entryDoc.ref, {
        status: "finalized",
        updatedAt: FieldValue.serverTimestamp(),
      });
      count++;
      if (count >= BATCH_SIZE) {
        await batch.commit();
        batch = adminDb.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }

    return NextResponse.json({ success: true, entriesFinalized: entriesSnap.size });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
