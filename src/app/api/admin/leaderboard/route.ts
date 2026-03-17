import { NextResponse } from "next/server";
import { verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const district = url.searchParams.get("district");
    const clientId = url.searchParams.get("clientId");

    let q = adminDb
      .collection("guardScores")
      .orderBy("currentMonthScore", "desc") as FirebaseFirestore.Query;

    if (district) q = q.where("district", "==", district);
    if (clientId) q = q.where("clientId", "==", clientId);

    const snapshot = await q.limit(50).get();
    const scores = snapshot.docs.map((d, idx) => ({
      rank: idx + 1,
      id: d.id,
      ...d.data(),
    }));

    return NextResponse.json({ scores });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
