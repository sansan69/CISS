import { NextRequest, NextResponse } from "next/server";
import {
  verifyRequestAuth,
  hasAdminAccess,
  hasClientAccess,
  requireAdminOrFieldOfficer,
  unauthorizedResponse,
} from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return "employeeName,employeeId,status,clientName,employeeClientName,siteClientName,crossClientRelief,district,siteName,dutyPointName,attendanceDate,locationText,complianceStatus,complianceWarnings,requiresLocationReview,isMockLocationSuspected,gpsAccuracyMeters,reportedAt,createdAt\n";
  }

  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;

  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

export async function GET(request: NextRequest) {
  try {
    const decodedToken = await verifyRequestAuth(request);
    const isAdmin = hasAdminAccess(decodedToken);
    const isClient = hasClientAccess(decodedToken);
    if (!isAdmin && !isClient) {
      requireAdminOrFieldOfficer(decodedToken);
    }
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const from = request.nextUrl.searchParams.get("from");
    const to = request.nextUrl.searchParams.get("to");
    const status = request.nextUrl.searchParams.get("status");
    const district = request.nextUrl.searchParams.get("district");
    const clientName = request.nextUrl.searchParams.get("clientName");
    const format = request.nextUrl.searchParams.get("format") || "json";

    // Validate date strings before passing to Firestore
    if (from && isNaN(Date.parse(from))) {
      return NextResponse.json({ error: "Invalid 'from' date." }, { status: 400 });
    }
    if (to && isNaN(Date.parse(to))) {
      return NextResponse.json({ error: "Invalid 'to' date." }, { status: 400 });
    }

    let queryRef: FirebaseFirestore.Query = adminDb.collection("attendanceLogs");

    if (from) {
      queryRef = queryRef.where("createdAt", ">=", new Date(from));
    }
    if (to) {
      queryRef = queryRef.where("createdAt", "<=", new Date(to));
    }
    if (status && status !== "all") {
      queryRef = queryRef.where("status", "==", status);
    }
    if (district && district !== "all") {
      queryRef = queryRef.where("district", "==", district);
    }
    if (!isClient && clientName && clientName !== "all") {
      queryRef = queryRef.where("clientName", "==", clientName);
    }

    let clientScope = null;
    let snapshots: Array<{ size: number; docs: Array<{ id: string; data(): Record<string, any> }> }> = [];
    if (isClient) {
      clientScope = await resolveClientScope(adminDb, decodedToken);
      if (!clientScope) {
        return NextResponse.json({ error: "Client account is not linked to a valid client profile." }, { status: 403 });
      }
      if (clientName && clientName !== "all" && clientName !== clientScope.clientName) {
        return NextResponse.json({ error: "Access denied for that client." }, { status: 403 });
      }
      snapshots = await Promise.all([
        queryRef
          .where("clientName", "==", clientScope.clientName)
          .orderBy("createdAt", "desc")
          .limit(1000)
          .get() as any,
        queryRef
          .where("employeeClientName", "==", clientScope.clientName)
          .orderBy("createdAt", "desc")
          .limit(1000)
          .get() as any,
      ]);
    } else if (!isAdmin) {
      // Field officers can only export their assigned districts
      const foDistricts: string[] = Array.isArray(decodedToken.assignedDistricts)
        ? (decodedToken.assignedDistricts as string[])
        : [];
      if (foDistricts.length === 0) {
        return NextResponse.json({ rows: [], truncated: false });
      }
      // If a district filter was already applied, verify it's in the FO's scope
      if (district && district !== "all") {
        const allowed = foDistricts.some(
          (d) => d.trim().toLowerCase() === district.trim().toLowerCase(),
        );
        if (!allowed) {
          return NextResponse.json({ error: "Access denied for that district." }, { status: 403 });
        }
      } else {
        queryRef = queryRef.where("district", "in", foDistricts);
      }
    }

    const LIMIT = 1000;
    if (!isClient) {
      snapshots = [await queryRef.orderBy("createdAt", "desc").limit(LIMIT).get() as any];
    }
    const docsById = new Map<string, { id: string; data(): Record<string, any> }>();
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        docsById.set(doc.id, doc);
      }
    }
    const truncated = snapshots.some((snapshot) => snapshot.size === LIMIT);
    const rows = Array.from(docsById.values())
      .map((doc) => {
        const data = doc.data() as Record<string, any>;
        return {
          employeeName: data.employeeName || "",
          employeeId: data.employeeId || "",
          status: data.status || "",
          clientName: data.clientName || "",
          employeeClientName: data.employeeClientName || "",
          siteClientName: data.siteClientName || data.clientName || "",
          crossClientRelief: data.crossClientRelief === true ? "yes" : "no",
          district: data.district || "",
          siteName: data.siteName || "",
          dutyPointName: data.dutyPointName || "",
          attendanceDate: data.attendanceDate || "",
          locationText: data.locationText || "",
          complianceStatus: data.photoCompliance?.overallStatus || "",
          complianceWarnings: Array.isArray(data.photoCompliance?.warnings)
            ? data.photoCompliance.warnings.join(" | ")
            : "",
          requiresLocationReview: data.requiresLocationReview === true ? "yes" : "no",
          isMockLocationSuspected: data.isMockLocationSuspected === true ? "yes" : "no",
          gpsAccuracyMeters:
            typeof data.gpsAccuracyMeters === "number" ? data.gpsAccuracyMeters : "",
          reportedAt:
            typeof data.reportedAt?.toDate === "function"
              ? data.reportedAt.toDate().toISOString()
              : typeof data.reportedAtClient === "string"
                ? data.reportedAtClient
                : typeof data.createdAt?.toDate === "function"
                  ? data.createdAt.toDate().toISOString()
                  : "",
          createdAt:
            typeof data.createdAt?.toDate === "function"
              ? data.createdAt.toDate().toISOString()
              : "",
        };
      })
      .filter((row) => !clientScope || matchesClientScope(row, clientScope));

    if (format === "csv") {
      const headers: Record<string, string> = {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="attendance-report.csv"',
      };
      if (truncated) headers["X-Truncated"] = "true";
      return new NextResponse(toCsv(rows), { headers });
    }

    return NextResponse.json({ rows, truncated });
  } catch (error: any) {
    const msg = error?.message || "Unauthorized";
    if (msg.includes("Missing bearer token") || msg.includes("access required")) {
      return unauthorizedResponse(msg, 401);
    }
    console.error("[reports/attendance]", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
