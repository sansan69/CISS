import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { buildPublicAttendanceEmployee } from "@/lib/attendance/public-attendance";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim() || "";
    const phoneNumber =
      request.nextUrl.searchParams.get("phoneNumber")?.replace(/\D/g, "").slice(-10) || "";

    if (!employeeId) {
      return NextResponse.json(
        { error: "employeeId is required.", found: false },
        { status: 400 },
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

    return NextResponse.json({ found: true, employee });
  } catch (error) {
    console.error("[public/attendance/employee]", error);
    return NextResponse.json(
      { error: "Could not verify employee ID.", found: false },
      { status: 500 },
    );
  }
}
