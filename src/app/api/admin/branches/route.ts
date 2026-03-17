import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb.collection("branches").orderBy("createdAt", "desc").get();
    const branches = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ branches });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      name?: string;
      stateCode?: string;
      district?: string;
      address?: string;
      phone?: string;
      email?: string;
      managedBy?: string;
      managedByName?: string;
    };

    if (!body.name || !body.stateCode || !body.district) {
      return NextResponse.json({ error: "name, stateCode, and district are required." }, { status: 400 });
    }

    const docRef = await adminDb.collection("branches").add({
      name: body.name,
      stateCode: body.stateCode,
      district: body.district,
      address: body.address ?? "",
      phone: body.phone ?? "",
      email: body.email ?? "",
      managedBy: body.managedBy ?? "",
      managedByName: body.managedByName ?? "",
      fieldOfficerIds: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
