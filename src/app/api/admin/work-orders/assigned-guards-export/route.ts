import { NextResponse } from "next/server";
import writeXlsxFile from "write-excel-file/node";

import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { districtMatches } from "@/lib/districts";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";

export const runtime = "nodejs";

const EXPORT_HEADERS = [
  "Sl No.",
  "State",
  "City",
  "Center Name",
  "Center code",
  "Exam Name",
  "First Name of the employee",
  "Last Name of the employee",
  "male/female",
  "date of birth",
  "father name",
  "mother name",
  "Full address",
  "contact number",
  "email id",
  "Resources ID (If available)",
  "ID Proof Type",
  "ID proof number",
];

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseDateFilter(value: string | null, endOfDay = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Dates must use the YYYY-MM-DD format.");
  }
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const parsed = new Date(`${value}T${time}+05:30`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Please choose a valid date.");
  }
  return parsed;
}

function buildFileName(filters: {
  district: string;
  officerName: string;
  startDate: string;
  endDate: string;
}) {
  const parts = ["Assigned_Guards"];
  if (filters.district) parts.push(filters.district);
  if (filters.officerName) parts.push(filters.officerName);
  if (filters.startDate) parts.push(`From_${filters.startDate}`);
  if (filters.endDate) parts.push(`To_${filters.endDate}`);
  return `${parts.join("_").replace(/[^a-zA-Z0-9_-]+/g, "_")}.xlsx`;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const district = normalizeText(searchParams.get("district"));
    const officerUid = normalizeText(searchParams.get("officerUid"));
    const startDateText = normalizeText(searchParams.get("startDate"));
    const endDateText = normalizeText(searchParams.get("endDate"));
    const startDate = parseDateFilter(startDateText);
    const endDate = parseDateFilter(endDateText, true);

    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json(
        { error: "The From Date must be on or before the To Date." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    let officerName = "";
    let officerDistricts: string[] | null = null;
    if (officerUid) {
      const officerSnapshot = await adminDb
        .collection("fieldOfficers")
        .where("uid", "==", officerUid)
        .limit(1)
        .get();
      if (officerSnapshot.empty) {
        return NextResponse.json(
          { error: "The selected field officer could not be found." },
          { status: 404 },
        );
      }
      const officer = officerSnapshot.docs[0].data();
      officerName = normalizeText(officer.name);
      officerDistricts = Array.isArray(officer.assignedDistricts)
        ? officer.assignedDistricts.map(normalizeText).filter(Boolean)
        : [];
    }

    const workOrdersSnapshot = await adminDb.collection("workOrders").get();
    const workOrders = workOrdersSnapshot.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...(doc.data() as Record<string, unknown>),
          }) as Record<string, unknown> & { id: string },
      )
      .filter(
        (workOrder) =>
          normalizeText(workOrder.recordStatus || "active").toLowerCase() ===
            "active" &&
          isOperationalWorkOrderClientName(normalizeText(workOrder.clientName)),
      )
      .filter((workOrder) => {
        const workOrderDistrict = normalizeText(workOrder.district);
        if (district && !districtMatches(district, workOrderDistrict)) return false;
        if (
          officerDistricts &&
          !officerDistricts.some((assignedDistrict) =>
            districtMatches(assignedDistrict, workOrderDistrict),
          )
        ) {
          return false;
        }
        const date = toDate(workOrder.date);
        if (!date) return false;
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
      })
      .sort(
        (left, right) =>
          (toDate(left.date)?.getTime() ?? 0) -
          (toDate(right.date)?.getTime() ?? 0),
      );

    const sitesSnapshot = await adminDb.collection("sites").get();
    const sites = new Map<string, Record<string, unknown>>();
    sitesSnapshot.docs.forEach((doc) => {
      const site = doc.data() as Record<string, unknown>;
      sites.set(doc.id, site);
      const businessSiteId = normalizeText(site.siteId);
      if (businessSiteId) sites.set(businessSiteId, site);
    });

    const assignedGuards = workOrders.flatMap((workOrder) =>
      Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : [],
    );
    const guardDocIds = Array.from(
      new Set(
        assignedGuards
          .map((guard) =>
            guard && typeof guard === "object"
              ? normalizeText((guard as { uid?: unknown }).uid)
              : "",
          )
          .filter(Boolean),
      ),
    );
    const employees = new Map<string, Record<string, unknown>>();
    for (let index = 0; index < guardDocIds.length; index += 30) {
      const chunk = guardDocIds.slice(index, index + 30);
      const employeeSnapshot = await adminDb
        .collection("employees")
        .where("__name__", "in", chunk)
        .get();
      employeeSnapshot.docs.forEach((doc) => employees.set(doc.id, doc.data()));
    }

    const rows: Array<Array<string | number | Date>> = [];
    let serialNumber = 1;
    for (const workOrder of workOrders) {
      const site = sites.get(normalizeText(workOrder.siteId)) ?? {};
      const guards = Array.isArray(workOrder.assignedGuards)
        ? workOrder.assignedGuards
        : [];
      for (const rawGuard of guards) {
        if (!rawGuard || typeof rawGuard !== "object") continue;
        const guard = rawGuard as {
          uid?: unknown;
          name?: unknown;
          employeeId?: unknown;
          gender?: unknown;
        };
        const employee = employees.get(normalizeText(guard.uid)) ?? {};
        const embeddedName = normalizeText(guard.name);
        const nameParts = embeddedName.split(/\s+/).filter(Boolean);
        rows.push([
          serialNumber++,
          normalizeText(site.state) || "Kerala",
          normalizeText(workOrder.district),
          normalizeText(site.siteName || workOrder.siteName),
          normalizeText(site.siteId || workOrder.siteId),
          normalizeText(workOrder.examName || workOrder.examCode) ||
            "General Duty",
          normalizeText(employee.firstName) || nameParts[0] || "",
          normalizeText(employee.lastName) || nameParts.slice(1).join(" "),
          normalizeText(guard.gender || employee.gender),
          toDate(employee.dateOfBirth) ?? "",
          normalizeText(employee.fatherName),
          normalizeText(employee.motherName),
          normalizeText(employee.fullAddress).replace(/\n/g, ", "),
          normalizeText(employee.phoneNumber),
          normalizeText(employee.emailAddress).toLowerCase(),
          normalizeText(employee.resourceIdNumber),
          normalizeText(employee.identityProofType),
          normalizeText(employee.identityProofNumber),
        ]);
      }
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No assigned guards match the selected filters." },
        { status: 404 },
      );
    }

    const fileName = buildFileName({
      district,
      officerName,
      startDate: startDateText,
      endDate: endDateText,
    });
    const fileBuffer = await writeXlsxFile([EXPORT_HEADERS, ...rows], {
      sheet: "Assigned Guards",
      dateFormat: "dd-mm-yyyy",
    }).toBuffer();

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(fileBuffer.byteLength),
        "X-Export-Row-Count": String(rows.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : `Could not export ${OPERATIONAL_CLIENT_NAME} guard assignments.`;
    if (message.includes("access required")) {
      return unauthorizedResponse(message, 403);
    }
    if (message.includes("Missing bearer") || message.includes("token")) {
      return unauthorizedResponse(message, 401);
    }
    console.error("Assigned guard export failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
