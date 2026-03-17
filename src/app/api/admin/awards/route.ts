import { NextResponse } from "next/server";
import { requireAdmin, verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await verifyRequestAuth(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb
      .collection("awards")
      .orderBy("awardedAt", "desc")
      .limit(50)
      .get();
    const awards = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ awards });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const body = (await request.json()) as {
      employeeId?: string;
      employeeName?: string;
      employeeCode?: string;
      district?: string;
      clientId?: string;
      clientName?: string;
      profilePicUrl?: string;
      type?: string;
      period?: string;
      score?: number;
      awardedByName?: string;
      notes?: string;
    };

    if (!body.employeeId || !body.type || !body.period) {
      return NextResponse.json({ error: "employeeId, type, and period are required." }, { status: 400 });
    }

    const now = new Date();
    const awardRef = await adminDb.collection("awards").add({
      employeeId: body.employeeId,
      employeeName: body.employeeName ?? "",
      employeeCode: body.employeeCode ?? "",
      district: body.district ?? "",
      clientId: body.clientId ?? "",
      clientName: body.clientName ?? "",
      profilePicUrl: body.profilePicUrl ?? null,
      type: body.type,
      period: body.period,
      score: body.score ?? 0,
      awardedBy: adminUser.uid,
      awardedByName: body.awardedByName ?? adminUser.email ?? "",
      awardedAt: now,
      notes: body.notes ?? "",
    });

    // Add badge to guardScores
    const badgeKey = `${body.type}_${body.period}`;
    try {
      const { FieldValue } = await import("firebase-admin/firestore");
      await adminDb.collection("guardScores").doc(body.employeeId).update({
        badges: FieldValue.arrayUnion(badgeKey),
        lastUpdated: now,
      });
    } catch {
      // If guardScores doc doesn't exist yet, create it minimally
    }

    return NextResponse.json({ id: awardRef.id });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
