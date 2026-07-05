import { NextResponse } from "next/server";

import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

function startOfTodayIst() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const todayKey = startOfTodayIst();

    const [
      employeesSnapshot,
      attendanceSnapshot,
      workOrdersSnapshot,
      clientsSnapshot,
      sitesSnapshot,
    ] = await Promise.all([
      adminDb.collection("employees").limit(2000).get(),
      adminDb.collection("attendanceLogs").where("attendanceDate", "==", todayKey).limit(1000).get(),
      adminDb.collection("workOrders").limit(1000).get(),
      adminDb.collection("clients").limit(1000).get(),
      adminDb.collection("sites").limit(1000).get(),
    ]);

    let activeGuards = 0;
    for (const doc of employeesSnapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (String(data.status ?? "Active").toLowerCase() === "active") {
        activeGuards += 1;
      }
    }

    let checkedInToday = 0;
    const latestByEmployee = new Map<string, string>();
    for (const doc of attendanceSnapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const employeeKey = String(data.employeeId || data.employeeDocId || doc.id);
      latestByEmployee.set(employeeKey, String(data.status || "In"));
    }
    for (const status of latestByEmployee.values()) {
      if (status.toLowerCase() === "in") checkedInToday += 1;
    }

    let pendingWorkOrders = 0;
    for (const doc of workOrdersSnapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const assignedCount = Array.isArray(data.assignedGuards) ? data.assignedGuards.length : 0;
      const totalManpower =
        typeof data.totalManpower === "number"
          ? data.totalManpower
          : (typeof data.maleGuardsRequired === "number" ? data.maleGuardsRequired : 0) +
            (typeof data.femaleGuardsRequired === "number" ? data.femaleGuardsRequired : 0);
      if (totalManpower > assignedCount) pendingWorkOrders += 1;
    }

    return NextResponse.json({
      totalGuards: employeesSnapshot.size,
      activeGuards,
      checkedInToday,
      pendingWorkOrders,
      totalClients: clientsSnapshot.size,
      totalSites: sitesSnapshot.size,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load admin dashboard.";
    if (message.includes("Missing bearer") || message.includes("access required")) {
      return unauthorizedResponse(message, message.includes("access required") ? 403 : 401);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
