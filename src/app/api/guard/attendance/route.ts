import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

function timestampToMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function toISTTimeString(ts: unknown): string {
  if (!ts) return "";
  const millis = timestampToMillis(ts);
  if (!millis) return "";
  const date = new Date(millis);
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

    let attendanceSnap = await adminDb
      .collection("attendanceLogs")
      .where("employeeDocId", "==", guard.employeeDocId)
      .where("attendanceDate", ">=", firstDay)
      .where("attendanceDate", "<=", lastDay)
      .get();

    if (attendanceSnap.empty) {
      attendanceSnap = await adminDb
        .collection("attendanceLogs")
        .where("employeeId", "==", guard.employeeId)
        .where("attendanceDate", ">=", firstDay)
        .where("attendanceDate", "<=", lastDay)
        .get();
    }

    const rawLogs = attendanceSnap.docs.map((d) => {
      const data = d.data() as {
        attendanceDate?: string;
        status?: string;
        siteName?: string;
        dutyPointName?: string;
        reportedAt?: FirebaseFirestore.Timestamp;
        distanceMeters?: number;
        shiftLabel?: string;
        createdAt?: FirebaseFirestore.Timestamp;
      };
      return {
        id: d.id,
        date: data.attendanceDate ?? "",
        status: (data.status ?? "In") as "In" | "Out",
        siteName: data.siteName ?? "",
        dutyPointName: data.dutyPointName ?? "",
        time: toISTTimeString(data.reportedAt ?? data.createdAt),
        distanceMeters: data.distanceMeters,
        shiftLabel: data.shiftLabel,
        reportedAtMillis: timestampToMillis(data.reportedAt ?? data.createdAt),
      };
    }).sort((left, right) => {
        const dateOrder = right.date.localeCompare(left.date);
        if (dateOrder !== 0) return dateOrder;
        return right.reportedAtMillis - left.reportedAtMillis;
      })
      .map(({ reportedAtMillis: _reportedAtMillis, ...log }) => log);

    // Summary
    const presentDates = new Set(
      rawLogs.filter((l) => l.status === "In").map((l) => l.date)
    );
    const presentDays = presentDates.size;

    return NextResponse.json({
      month: monthStr,
      logs: rawLogs,
      presentDays,
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
