import { NextResponse } from "next/server";
import { requireAdmin, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const moduleId = url.searchParams.get("moduleId");

    let q: FirebaseFirestore.Query = adminDb.collection("questionBanks").orderBy("createdAt", "desc");
    if (moduleId) q = q.where("moduleId", "==", moduleId);
    const snap = await q.limit(200).get();
    const banks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ banks });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      title?: string;
      moduleId?: string;
      questionsPerAttempt?: number;
      timeLimitMinutes?: number;
      shuffle?: boolean;
      maxAttempts?: number;
    };

    if (!body.title?.trim() || !body.moduleId) {
      return NextResponse.json({ error: "title and moduleId are required." }, { status: 400 });
    }

    const now = new Date();
    const docRef = await adminDb.collection("questionBanks").add({
      title: body.title.trim(),
      moduleId: body.moduleId,
      questionsPerAttempt: body.questionsPerAttempt ?? 10,
      timeLimitMinutes: body.timeLimitMinutes ?? 0,
      shuffle: body.shuffle ?? true,
      maxAttempts: body.maxAttempts ?? 0,
      questionCount: 0,
      createdAt: now,
      createdBy: adminUser.uid,
    });

    return NextResponse.json({ id: docRef.id });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
