import { NextRequest, NextResponse } from "next/server";
import {
  verifyRequestAuth,
  hasAdminAccess,
  hasClientAccess,
  requireAdminOrFieldOfficer,
  unauthorizedResponse,
} from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";

export const dynamic = "force-dynamic";

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return "employeeName,employeeId,status,clientName,employeeClientName,siteClientName,crossClientRelief,district,siteName,dutyPointName,attendanceDate,locationText,complianceStatus,complianceWarnings,requiresLocationReview,isMockLocationSuspected,gpsAccuracyMeters,reportedAt,createdAt\n";
  }

  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;

  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function normalizeAttendanceDateParam(value: string | null) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

async function getAllQueryDocuments(query: FirebaseFirestore.Query) {
  const pageSize = 1000;
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let pageQuery = query.limit(pageSize);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const snapshot = await pageQuery.get();
    documents.push(...snapshot.docs);
    if (snapshot.size < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1] ?? null;
    if (!cursor) break;
  }

  return documents;
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
    const rawFrom = request.nextUrl.searchParams.get("from");
    const rawTo = request.nextUrl.searchParams.get("to");
    const from = normalizeAttendanceDateParam(rawFrom);
    const to = normalizeAttendanceDateParam(rawTo);
    const status = request.nextUrl.searchParams.get("status");
    const district = request.nextUrl.searchParams.get("district");
    const clientName = request.nextUrl.searchParams.get("clientName");
    const format = request.nextUrl.searchParams.get("format") || "json";

    // Validate date strings before passing to Firestore
    if (rawFrom && !from) {
      return NextResponse.json({ error: "Invalid 'from' date. Use YYYY-MM-DD or ISO date-time." }, { status: 400 });
    }
    if (rawTo && !to) {
      return NextResponse.json({ error: "Invalid 'to' date. Use YYYY-MM-DD or ISO date-time." }, { status: 400 });
    }

    let queryRef: FirebaseFirestore.Query = adminDb.collection("attendanceLogs");

    if (from) {
      queryRef = queryRef.where("attendanceDate", ">=", from);
    }
    if (to) {
      queryRef = queryRef.where("attendanceDate", "<=", to);
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
    let documentGroups: FirebaseFirestore.QueryDocumentSnapshot[][] = [];
    if (isClient) {
      clientScope = await resolveClientScope(adminDb, decodedToken);
      if (!clientScope) {
        return NextResponse.json({ error: "Client account is not linked to a valid client profile." }, { status: 403 });
      }
      if (clientName && clientName !== "all" && clientName !== clientScope.clientName) {
        return NextResponse.json({ error: "Access denied for that client." }, { status: 403 });
      }
      documentGroups = await Promise.all([
        getAllQueryDocuments(queryRef
          .where("clientName", "==", clientScope.clientName)
          .orderBy("attendanceDate", "desc")),
        getAllQueryDocuments(queryRef
          .where("employeeClientName", "==", clientScope.clientName)
          .orderBy("attendanceDate", "desc")),
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

    if (!isClient) {
      documentGroups = [
        await getAllQueryDocuments(queryRef.orderBy("attendanceDate", "desc")),
      ];
    }
    const docsById = new Map<string, { id: string; data(): Record<string, any> }>();
    for (const documents of documentGroups) {
      for (const doc of documents) {
        docsById.set(doc.id, doc);
      }
    }
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
      return new NextResponse(toCsv(rows), { headers });
    }

    return NextResponse.json({ rows, truncated: false });
  } catch (error: any) {
    const msg = error?.message || "Unauthorized";
    if (msg.includes("Missing bearer token") || msg.includes("access required")) {
      return unauthorizedResponse(msg, 401);
    }
    console.error("[reports/attendance]", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
