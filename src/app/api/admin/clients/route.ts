import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit } from "@/lib/server/audit";

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }

    const docRef = await adminDb.collection("clients").add({
      name,
      ...buildServerCreateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
    });

    return NextResponse.json({ id: docRef.id, name });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
