import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const employeeId = normalizeText(body.employeeId);

    if (!employeeId) {
      return NextResponse.json(
        { error: "employeeId is required." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Find the employee
    const empSnap = await adminDb
      .collection("employees")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();

    if (empSnap.empty) {
      return NextResponse.json(
        { error: "Employee not found." },
        { status: 404 },
      );
    }

    const empDoc = empSnap.docs[0];
    const empData = empDoc.data() as Record<string, unknown>;

    // Generate a unique QR data payload
    const qrData = JSON.stringify({
      type: "guard",
      employeeId: normalizeText(empData.employeeId || employeeId),
      employeeDocId: empDoc.id,
      guardAuthUid: normalizeText(empData.guardAuthUid),
    });

    // Store the QR data reference
    const qrRef = adminDb.collection("qrCodes").doc(empDoc.id);
    await qrRef.set({
      employeeDocId: empDoc.id,
      employeeId: normalizeText(empData.employeeId || employeeId),
      qrData,
      generatedAt: new Date(),
      type: "guard",
    });

    return NextResponse.json({
      success: true,
      employeeId,
      qrData,
      qrId: empDoc.id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/qr/generate]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
