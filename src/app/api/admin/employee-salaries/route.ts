import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const limit = Math.min(parseInt(searchParams.get("limit") || "300", 10), 500);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    let query: FirebaseFirestore.Query = adminDb.collection("employeeSalaries").limit(limit);
    if (clientId) {
      query = query.where("clientId", "==", clientId);
    }

    const snapshot = await query.get();
    const assignments = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json({ assignments });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
