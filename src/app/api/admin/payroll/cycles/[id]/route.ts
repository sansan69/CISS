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

    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return NextResponse.json({
      cycle: { id: cycleDoc.id, ...cycleDoc.data() },
      entries,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
