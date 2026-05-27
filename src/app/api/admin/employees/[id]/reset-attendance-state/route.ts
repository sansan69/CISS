import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
    const { id: employeeDocId } = await params;

    if (!employeeDocId) {
      return NextResponse.json(
        { error: "Employee ID is required." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Close any open attendance session for this employee
    const stateSnap = await adminDb
      .collection("attendanceState")
      .doc(employeeDocId)
      .get();

    const stateData = stateSnap.exists
      ? (stateSnap.data() as Record<string, any>)
      : null;

    if (stateData?.openSessionId) {
      await adminDb
        .collection("attendanceSessions")
        .doc(String(stateData.openSessionId))
        .set(
          {
            status: "closed",
            autoClosed: true,
            autoClosedReason: "Admin reset on " + new Date().toISOString().split("T")[0],
            updatedAt: new Date(),
          },
          { merge: true },
        );
    }

    // Delete the attendanceState document — guard starts fresh
    await adminDb.collection("attendanceState").doc(employeeDocId).delete();

    return NextResponse.json({
      success: true,
      message: "Attendance state reset. Guard can now mark IN fresh.",
      hadOpenSession: Boolean(stateData?.openSessionId),
      previousStatus: stateData?.lastStatus ?? null,
      previousDate: stateData?.lastAttendanceDate ?? null,
    });
  } catch (error: any) {
    console.error("Failed to reset attendance state:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to reset attendance state." },
      { status: error?.status || 500 },
    );
  }
}
