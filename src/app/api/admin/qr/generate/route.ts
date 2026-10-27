import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";
import { buildQrContent } from "@/lib/qr/qr-token";
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

    const qrEmployeeId = normalizeText(empData.employeeId || employeeId);
    const qrName = normalizeText(empData.fullName || empData.name || "");
    const qrPhone = normalizeText(
      empData.phoneNumber || empData.phone || empData.mobile || "",
    );
    if (!qrPhone) {
      return NextResponse.json(
        {
          error:
            "This employee has no phone number, so a signed attendance QR badge cannot be issued.",
        },
        { status: 422 },
      );
    }

    // The signed content is the same shape the guard app and printed badges
    // expect. A JSON envelope without Phone/Token is not a valid badge.
    const qrData = await buildQrContent(qrEmployeeId, qrName, qrPhone);

    // Store the QR data reference
    const qrRef = adminDb.collection("qrCodes").doc(empDoc.id);
    await qrRef.set({
      employeeDocId: empDoc.id,
      employeeId: qrEmployeeId,
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
