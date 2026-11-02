import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { buildPublicAttendanceEmployee } from "@/lib/attendance/public-attendance";
import {
  buildRateLimitKey,
  checkRateLimit,
  getClientIp,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    // Employee IDs are sequential, so this lookup is enumerable by design.
    // Rate limit per client IP and per looked-up ID before touching Firestore.
    const ip = getClientIp(request);
    const ipLimit = await checkRateLimit(buildRateLimitKey("attendance-employee-ip", ip), {
      maxRequests: 30,
      windowMs: 5 * 60_000,
      failClosed: true,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many lookups. Please wait and try again.", found: false },
        { status: 429, headers: { "Retry-After": "300" } },
      );
    }

    let employeeId = request.nextUrl.searchParams.get("employeeId")?.trim() || "";
    const phoneNumber =
      request.nextUrl.searchParams.get("phoneNumber")?.replace(/\D/g, "").slice(-10) || "";
    const resourceId =
      request.nextUrl.searchParams.get("resourceId")?.trim() || "";

    // If no employeeId but phone or resourceId given, look up by those
    if (!employeeId && phoneNumber) {
      const phoneSnap = await db
        .collection("employees")
        .where("phoneNumber", "==", phoneNumber)
        .limit(1)
        .get();
      if (!phoneSnap.empty) {
        employeeId = (phoneSnap.docs[0].data() as Record<string, unknown>).employeeId as string || "";
      } else {
        // Try alternate phone fields
        const altSnap = await db
          .collection("employees")
          .where("phone", "==", phoneNumber)
          .limit(1)
          .get();
        if (!altSnap.empty) {
          employeeId = (altSnap.docs[0].data() as Record<string, unknown>).employeeId as string || "";
        }
      }
    }

    if (!employeeId && resourceId) {
      const resIdSnap = await db
        .collection("employees")
        .where("resourceIdNumber", "==", resourceId)
        .limit(1)
        .get();
      if (!resIdSnap.empty) {
        employeeId = (resIdSnap.docs[0].data() as Record<string, unknown>).employeeId as string || "";
      }
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: "employeeId, phoneNumber, or resourceId is required.", found: false },
        { status: 400 },
      );
    }

    // Per-ID limiter: a single guard retrying is fine, scraping the roster is not.
    const idLimit = await checkRateLimit(
      buildRateLimitKey("attendance-employee-id", employeeId.toLowerCase()),
      { maxRequests: 15, windowMs: 10 * 60_000, failClosed: true },
    );
    if (!idLimit.allowed) {
      return NextResponse.json(
        { error: "Too many lookups for this employee. Please wait and try again.", found: false },
        { status: 429, headers: { "Retry-After": "600" } },
      );
    }

    let snapshot = await db
      .collection("employees")
      .where("employeeId", "==", employeeId)
      .limit(phoneNumber ? 5 : 1)
      .get();

    let matchingDocs = phoneNumber
      ? snapshot.docs.filter((candidate) => {
          const data = candidate.data() as Record<string, unknown>;
          const phone = String(data.phoneNumber ?? data.phone ?? data.mobile ?? "")
            .replace(/\D/g, "")
            .slice(-10);
          return phone === phoneNumber;
        })
      : snapshot.docs;

    if (snapshot.empty || (phoneNumber && matchingDocs.length === 0)) {
      snapshot = await db
        .collection("employees")
        .where("previousEmployeeIds", "array-contains", employeeId)
        .limit(phoneNumber ? 5 : 2)
        .get();
      matchingDocs = phoneNumber
        ? snapshot.docs.filter((candidate) => {
            const data = candidate.data() as Record<string, unknown>;
            const phone = String(data.phoneNumber ?? data.phone ?? data.mobile ?? "")
              .replace(/\D/g, "")
              .slice(-10);
            return phone === phoneNumber;
          })
        : snapshot.docs;
    }

    if (snapshot.empty) {
      return NextResponse.json({ found: false, employee: null });
    }

    if (matchingDocs.length !== 1) {
      return NextResponse.json(
        {
          error:
            "This employee ID is not unique. Please scan an updated QR code or enter the current employee ID.",
          found: false,
          employee: null,
        },
        { status: 409 },
      );
    }

    const doc = matchingDocs[0];
    const attendanceStateSnap = await db.collection("attendanceState").doc(doc.id).get();
    const attendanceState = attendanceStateSnap.exists
      ? (attendanceStateSnap.data() as Record<string, unknown>)
      : null;

    const employee = buildPublicAttendanceEmployee(
      doc.id,
      doc.data() as Record<string, unknown>,
      attendanceState
        ? {
            lastAttendanceDate:
              typeof attendanceState.lastAttendanceDate === "string"
                ? attendanceState.lastAttendanceDate
                : undefined,
	            lastStatus:
	              attendanceState.lastStatus === "In" || attendanceState.lastStatus === "Out"
	                ? attendanceState.lastStatus
	                : undefined,
	            lastSiteId:
	              typeof attendanceState.lastSiteId === "string"
	                ? attendanceState.lastSiteId
	                : undefined,
	            lastDutyPointId:
	              typeof attendanceState.lastDutyPointId === "string"
	                ? attendanceState.lastDutyPointId
	                : undefined,
	            lastShiftCode:
	              typeof attendanceState.lastShiftCode === "string"
	                ? attendanceState.lastShiftCode
	                : undefined,
	            openSessionId:
	              typeof attendanceState.openSessionId === "string"
	                ? attendanceState.openSessionId
	                : undefined,
	          }
        : undefined,
    );

    return NextResponse.json({
      found: true,
      // Only echo the phone number back when the caller already proved it by
      // supplying it. Otherwise an employee-ID walk returns names + mobiles.
      employee: phoneNumber ? employee : { ...employee, phoneNumber: undefined },
    });
  } catch (error) {
    console.error("[public/attendance/employee]", error);
    return NextResponse.json(
      { error: "Could not verify employee ID.", found: false },
      { status: 500 },
    );
  }
}
