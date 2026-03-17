import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    let query = adminDb.collection("salaryStructures").orderBy("createdAt", "desc");
    if (clientId) {
      query = adminDb
        .collection("salaryStructures")
        .where("clientId", "==", clientId)
        .orderBy("createdAt", "desc") as typeof query;
    }

    const snapshot = await query.get();
    const structures = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ structures });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const decoded = await requireAdmin(request);
    const body = await request.json();
    const { clientId, clientName, name, grossMonthly, componentAmounts } = body;

    if (!clientId || !name || !grossMonthly) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { FieldValue } = await import("firebase-admin/firestore");

    const ref = await adminDb.collection("salaryStructures").add({
      clientId,
      clientName,
      name,
      grossMonthly,
      componentAmounts: componentAmounts ?? {},
      createdAt: FieldValue.serverTimestamp(),
      createdBy: decoded.uid,
    });

    return NextResponse.json({ id: ref.id, success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
