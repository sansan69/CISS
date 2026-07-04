import { NextResponse } from "next/server";

import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText, serializeDate, sortByDateDesc } from "@/lib/server/mobile-api-utils";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "200", 10), 500);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb.collection("attendanceLogs").limit(limit).get();
    const attendance = sortByDateDesc(
      snapshot.docs.map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const reportedAt = serializeDate(data.reportedAt) ?? serializeDate(data.createdAt) ?? serializeDate(data.reportedAtClient);
        return {
          id: doc.id,
          employeeId: normalizeText(data.employeeId || data.employeeDocId),
          guardName: normalizeText(data.employeeName || data.guardName || data.fullName || data.employeeId || "Guard"),
          fullName: normalizeText(data.employeeName || data.fullName || data.guardName),
          status: normalizeText(data.status || "In"),
          clientName: normalizeText(data.clientName || data.employeeClientName || data.siteClientName),
          siteName: normalizeText(data.siteName || data.locationText || "Site"),
          district: normalizeText(data.district),
          dutyPointName: normalizeText(data.dutyPointName),
          attendanceDate: normalizeText(data.attendanceDate),
          checkIn: reportedAt ?? "",
          checkInTime: reportedAt ?? "",
          reportedAt,
        };
      }),
      (row) => row.reportedAt || row.attendanceDate,
    );

    return NextResponse.json({ attendance });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load attendance.";
    if (message.includes("Missing bearer") || message.includes("access required")) {
      return unauthorizedResponse(message, message.includes("access required") ? 403 : 401);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
