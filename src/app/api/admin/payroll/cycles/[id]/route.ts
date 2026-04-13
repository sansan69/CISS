import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const cycleDoc = await adminDb.collection("payrollCycles").doc(id).get();
    if (!cycleDoc.exists) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const entriesSnap = await adminDb
      .collection("payrollEntries")
      .where("cycleId", "==", id)
      .get();

    const entries = entriesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String((a as { employeeName?: string }).employeeName || "").localeCompare(String((b as { employeeName?: string }).employeeName || "")));

    return NextResponse.json({
      cycle: { id: cycleDoc.id, ...cycleDoc.data() },
      entries,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const cycleDoc = await adminDb.collection("payrollCycles").doc(id).get();
    if (!cycleDoc.exists) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const cycleData = cycleDoc.data() as { status?: string };
    if (cycleData.status === "finalized" || cycleData.status === "paid") {
      return NextResponse.json(
        { error: "Cannot delete a finalized or paid payroll cycle." },
        { status: 403 }
      );
    }

    // Delete all entries for this cycle in batches
    const entriesSnap = await adminDb
      .collection("payrollEntries")
      .where("cycleId", "==", id)
      .get();

    const BATCH_SIZE = 450;
    for (let i = 0; i < entriesSnap.docs.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      entriesSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    await adminDb.collection("payrollCycles").doc(id).delete();

    return NextResponse.json({ success: true, deletedEntries: entriesSnap.size });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
