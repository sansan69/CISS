import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb
      .collection("attendanceState")
      .where("lastStatus", "==", "In")
      .limit(100)
      .get();

    const stale = snapshot.docs.map((doc) => {
      const d = doc.data() as Record<string, any>;
      return {
        employeeDocId: doc.id,
        employeeName: d.employeeName ?? "Unknown",
        lastAttendanceDate: d.lastAttendanceDate ?? null,
        lastSiteId: d.lastSiteId ?? null,
        openSessionId: d.openSessionId ?? null,
        lastLoggedAt: d.lastLoggedAt?.toDate?.()?.toISOString() ?? d.lastLoggedAt ?? null,
      };
    });

    return NextResponse.json({ count: stale.length, stale });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to query" },
      { status: 500 },
    );
  }
}
