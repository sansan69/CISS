import { NextResponse } from "next/server";

import { hasClientAccess, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";
import { normalizeText, serializeDate, sortByDateDesc } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasClientAccess(decoded)) {
      return unauthorizedResponse("Client access required.", 403);
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "150", 10), 300);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const scope = await resolveClientScope(adminDb, decoded);
    if (!scope) {
      return unauthorizedResponse("Client account is not linked to a valid client profile.", 403);
    }

    const [siteAttendanceSnapshot, employeeAttendanceSnapshot] = await Promise.all([
      adminDb.collection("attendanceLogs").where("clientName", "==", scope.clientName).limit(limit).get(),
      adminDb.collection("attendanceLogs").where("employeeClientName", "==", scope.clientName).limit(limit).get(),
    ]);

    const docsById = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const doc of [...siteAttendanceSnapshot.docs, ...employeeAttendanceSnapshot.docs]) {
      docsById.set(doc.id, doc);
    }

    const attendance = sortByDateDesc(
      Array.from(docsById.values())
        .map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          const reportedAt = serializeDate(data.reportedAt) ?? serializeDate(data.createdAt) ?? serializeDate(data.reportedAtClient);
          return {
            id: doc.id,
            employeeId: normalizeText(data.employeeId || data.employeeDocId),
            guardName: normalizeText(data.employeeName || data.guardName || data.fullName || data.employeeId || "Guard"),
            fullName: normalizeText(data.employeeName || data.fullName || data.guardName),
            status: normalizeText(data.status || "In"),
            clientName: normalizeText(data.clientName),
            employeeClientName: normalizeText(data.employeeClientName),
            siteClientName: normalizeText(data.siteClientName || data.clientName),
            siteName: normalizeText(data.siteName || data.locationText || "Site"),
            district: normalizeText(data.district),
            dutyPointName: normalizeText(data.dutyPointName),
            attendanceDate: normalizeText(data.attendanceDate),
            checkIn: reportedAt ?? "",
            checkInTime: reportedAt ?? "",
            reportedAt,
          };
        })
        .filter((row) => matchesClientScope(row, scope)),
      (row) => row.reportedAt || row.attendanceDate,
    ).slice(0, limit);

    return NextResponse.json({ attendance });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load attendance.";
    return NextResponse.json({ error: message }, { status: message.includes("access required") ? 403 : 500 });
  }
}
