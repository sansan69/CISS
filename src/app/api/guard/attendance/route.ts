import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

function toISTTimeString(ts: FirebaseFirestore.Timestamp | null | undefined): string {
  if (!ts) return "";
  const date = ts.toDate();
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function workingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month, d).getDay();
    if (day !== 0) count++;
  }
  return count;
}

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);

    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get("month"); // YYYY-MM

    // Determine the month to query
    let year: number;
    let month: number; // 0-indexed
    let monthStr: string;

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      year = y;
      month = m - 1;
      monthStr = monthParam;
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
      monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
    }

    const firstDay = `${monthStr}-01`;
    // Last day of the month
    const lastDayDate = new Date(year, month + 1, 0);
    const lastDay = `${monthStr}-${String(lastDayDate.getDate()).padStart(2, "0")}`;

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const attendanceSnap = await adminDb
      .collection("attendanceLogs")
      .where("employeeDocId", "==", guard.employeeDocId)
      .where("attendanceDate", ">=", firstDay)
      .where("attendanceDate", "<=", lastDay)
      .orderBy("attendanceDate", "desc")
      .orderBy("reportedAt", "desc")
      .get();

    const rawLogs = attendanceSnap.docs.map((d) => {
      const data = d.data() as {
        attendanceDate?: string;
        status?: string;
        siteName?: string;
        dutyPointName?: string;
        reportedAt?: FirebaseFirestore.Timestamp;
        distanceMeters?: number;
        shiftLabel?: string;
      };
      return {
        id: d.id,
        date: data.attendanceDate ?? "",
        status: (data.status ?? "In") as "In" | "Out",
        siteName: data.siteName ?? "",
        dutyPointName: data.dutyPointName ?? "",
        time: toISTTimeString(data.reportedAt ?? undefined),
        distanceMeters: data.distanceMeters,
        shiftLabel: data.shiftLabel,
      };
    });

    // Summary
    const presentDates = new Set(
      rawLogs.filter((l) => l.status === "In").map((l) => l.date)
    );
    const presentDays = presentDates.size;
    const workingDays = workingDaysInMonth(year, month);
    const absentDays = Math.max(0, workingDays - presentDays);

    return NextResponse.json({
      month: monthStr,
      logs: rawLogs,
      presentDays,
      absentDays,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/attendance]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
