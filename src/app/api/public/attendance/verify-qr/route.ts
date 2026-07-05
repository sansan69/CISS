import { NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { verifyQrToken, parseQrContent } from "@/lib/qr/qr-token";
import { checkRateLimit, getClientIp, buildRateLimitKey } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/public/attendance/verify-qr
 * Validates a scanned QR code and returns employee details.
 * This allows any scanner (web or mobile) to verify a guard's identity
 * before marking attendance.
 */
export async function POST(request: Request) {
  try {
    // IP-based rate limiting
    const ip = getClientIp(request);
    const rateKey = buildRateLimitKey("verify-qr", ip);
    const rateResult = await checkRateLimit(rateKey, {
      maxRequests: 60,
      windowMs: 60 * 1000, // 60 requests per minute per IP
      failClosed: false,
    });
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": "60" },
        },
      );
    }

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

    // Verify QR token if present — undocumented QRs are NOT reported as verified
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

    // Check if caller is authenticated (has a valid bearer token)
    // to decide whether to include PII fields
    const authHeader = request.headers.get("authorization") || "";
    const callerIsAuthenticated = authHeader.startsWith("Bearer ");

    const employee: Record<string, unknown> = {
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
      clientName: employeeData.clientName ?? "",
      district: employeeData.district ?? "",
    };

    // Only include PII fields (phoneNumber, status) for authenticated callers
    if (callerIsAuthenticated) {
      employee.phoneNumber = employeeData.phoneNumber ?? "";
      employee.status = employeeData.status ?? "";
    }

    return NextResponse.json({
      verified: tokenValid, // Tokenless QRs must NOT be reported as verified
      employee,
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
