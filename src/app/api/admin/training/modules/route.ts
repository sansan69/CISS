import { NextResponse } from "next/server";
import { requireAdmin, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb
      .collection("trainingModules")
      .orderBy("createdAt", "desc")
      .get();
    const modules = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ modules });
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
      description?: string;
      category?: string;
      durationMinutes?: number;
      passingScore?: number;
      contentUrl?: string;
      contentType?: "pdf" | "pptx" | "image";
      contentPath?: string;
      contentFileName?: string;
    };

    if (!body.title?.trim()) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const now = new Date();
    const docRef = await adminDb.collection("trainingModules").add({
      title: body.title.trim(),
      description: body.description?.trim() ?? "",
      category: body.category ?? "safety",
      durationMinutes: body.durationMinutes ?? 60,
      passingScore: body.passingScore ?? 70,
      contentUrl: body.contentUrl ?? null,
      contentType: body.contentType ?? null,
      contentPath: body.contentPath ?? null,
      contentFileName: body.contentFileName ?? null,
      isActive: true,
      createdAt: now,
      createdBy: adminUser.uid,
    });

    return NextResponse.json({ id: docRef.id });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
