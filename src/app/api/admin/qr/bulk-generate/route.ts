import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Fetch all active employees
    const empSnap = await adminDb
      .collection("employees")
      .where("status", "==", "Active")
      .limit(500)
      .get();

    if (empSnap.empty) {
      return NextResponse.json(
        { error: "No active employees found." },
        { status: 404 },
      );
    }

    const results: Array<{ employeeId: string; qrData: string }> = [];
    const batch = adminDb.batch();

    for (const doc of empSnap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const employeeId = normalizeText(data.employeeId || data.employeeCode || doc.id);
      if (!employeeId) continue;

      const qrData = JSON.stringify({
        type: "guard",
        employeeId,
        employeeDocId: doc.id,
        guardAuthUid: normalizeText(data.guardAuthUid),
      });

      const qrRef = adminDb.collection("qrCodes").doc(doc.id);
      batch.set(qrRef, {
        employeeDocId: doc.id,
        employeeId,
        qrData,
        generatedAt: new Date(),
        type: "guard",
      }, { merge: true });

      results.push({ employeeId, qrData });
    }

    await batch.commit();

    return NextResponse.json({
      success: true,
      count: results.length,
      qrCodes: results,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/qr/bulk-generate]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
