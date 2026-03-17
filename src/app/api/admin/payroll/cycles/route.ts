import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb
      .collection("payrollCycles")
      .orderBy("period", "desc")
      .limit(24)
      .get();

    const cycles = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ cycles });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
