import { NextResponse } from "next/server";
import { requireAdmin, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await verifyRequestAuth(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snap = await adminDb
      .collection("questionBanks")
      .doc(id)
      .collection("questions")
      .orderBy("createdAt", "asc")
      .get();
    const questions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ questions });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminUser = await requireAdmin(request);
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      prompt?: string;
      options?: string[];
      correctIndex?: number;
      explanation?: string;
      questions?: Array<{ prompt: string; options: string[]; correctIndex: number; explanation?: string }>;
    };

    const bankRef = adminDb.collection("questionBanks").doc(id);

    if (Array.isArray(body.questions) && body.questions.length) {
      const batch = adminDb.batch();
      const now = new Date();
      body.questions.forEach((q) => {
        if (!q.prompt || !Array.isArray(q.options) || q.options.length < 2) return;
        const ref = bankRef.collection("questions").doc();
        batch.set(ref, {
          prompt: q.prompt,
          options: q.options,
          correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : 0,
          explanation: q.explanation ?? "",
          createdAt: now,
          createdBy: adminUser.uid,
        });
      });
      batch.update(bankRef, {
        questionCount: (await bankRef.collection("questions").count().get()).data().count + body.questions.length,
      });
      await batch.commit();
      return NextResponse.json({ imported: body.questions.length });
    }

    if (!body.prompt || !Array.isArray(body.options) || body.options.length < 2) {
      return NextResponse.json({ error: "prompt and at least 2 options required." }, { status: 400 });
    }
    const now = new Date();
    const ref = await bankRef.collection("questions").add({
      prompt: body.prompt,
      options: body.options,
      correctIndex: typeof body.correctIndex === "number" ? body.correctIndex : 0,
      explanation: body.explanation ?? "",
      createdAt: now,
      createdBy: adminUser.uid,
    });
    const count = (await bankRef.collection("questions").count().get()).data().count;
    await bankRef.update({ questionCount: count });
    return NextResponse.json({ id: ref.id });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
