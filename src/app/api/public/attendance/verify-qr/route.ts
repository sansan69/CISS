import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { verifyQrToken, parseQrContent } from "@/lib/qr/qr-token";

export const runtime = "nodejs";

/**
 * POST /api/public/attendance/verify-qr
 * Validates a scanned QR code and returns employee details.
 * This allows any scanner (web or mobile) to verify a guard's identity
 * before marking attendance.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const qrText = typeof body.qrText === "string" ? body.qrText.trim() : "";

    if (!qrText) {
      return NextResponse.json(
        { error: "QR text is required." },
        { status: 400 },
      );
    }

    const parsed = parseQrContent(qrText);

    if (!parsed.employeeId) {
      return NextResponse.json(
        { error: "Could not read employee ID from QR code." },
        { status: 400 },
      );
    }

    // Look up employee by employeeId
    const empSnap = await db
      .collection("employees")
      .where("employeeId", "==", parsed.employeeId)
      .limit(5)
      .get();

    if (empSnap.empty) {
      return NextResponse.json(
        { error: "Employee not found." },
        { status: 404 },
      );
    }

    // Filter by phone number if available
    let candidates = empSnap.docs;
    if (parsed.phoneNumber) {
      const matching = candidates.filter((doc) => {
        const phone = String(doc.data().phoneNumber ?? "").replace(/\D/g, "");
        return phone.includes(parsed.phoneNumber!);
      });
      if (matching.length > 0) {
        candidates = matching;
      }
    }

    if (candidates.length > 1) {
      return NextResponse.json(
        { error: "Multiple employees match this QR code. Please contact your supervisor." },
        { status: 409 },
      );
    }

    const employeeDoc = candidates[0];
    const employeeData = employeeDoc.data();

    // Verify QR token if present
    let tokenValid = false;
    if (parsed.token && parsed.phoneNumber) {
      tokenValid = await verifyQrToken(
        parsed.employeeId,
        parsed.phoneNumber,
        parsed.token,
      );
    }

    // Get attendance hint
    const stateSnap = await db
      .collection("attendanceState")
      .doc(employeeDoc.id)
      .get();
    const stateData = stateSnap.exists ? stateSnap.data() : null;

    return NextResponse.json({
      verified: tokenValid || !parsed.token, // Allow old QRs without token for backward compat
      employee: {
        id: employeeDoc.id,
        employeeId: employeeData.employeeId ?? "",
        fullName:
          employeeData.fullName ||
          employeeData.name ||
          [
            employeeData.firstName ?? "",
            employeeData.lastName ?? "",
          ]
            .join(" ")
            .trim(),
        phoneNumber: employeeData.phoneNumber ?? "",
        clientName: employeeData.clientName ?? "",
        district: employeeData.district ?? "",
        status: employeeData.status ?? "",
      },
      attendanceHint: stateData
        ? {
            lastAttendanceDate: stateData.lastAttendanceDate ?? null,
            lastStatus: stateData.lastStatus ?? null,
            lastSiteId: stateData.lastSiteId ?? null,
            lastDutyPointId: stateData.lastDutyPointId ?? null,
            lastShiftCode: stateData.lastShiftCode ?? null,
            openSessionId: stateData.openSessionId ?? null,
            recommendedStatus:
              stateData.lastStatus === "In" ? "Out" : "In",
          }
        : null,
    });
  } catch (error: any) {
    console.error("QR verification failed:", error);
    return NextResponse.json(
      { error: error?.message || "Could not verify QR code." },
      { status: 500 },
    );
  }
}
