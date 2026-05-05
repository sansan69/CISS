import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { canonicalizeDistrictList, districtMatches } from "@/lib/districts";

type FieldOfficerProfile = {
  assignedDistricts: string[];
};

type AttendanceLog = Record<string, unknown> & { id: string };

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().getTime();
  }
  if (typeof (value as { seconds?: unknown }).seconds === "number") {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function toTimeLabel(value: unknown) {
  const millis = toMillis(value);
  if (!millis) return null;
  return new Date(millis).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function getFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
): Promise<FieldOfficerProfile> {
  let assignedDistricts = Array.isArray(decoded.assignedDistricts)
    ? decoded.assignedDistricts
    : [];

  const snapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const data = snapshot.docs[0].data();
    assignedDistricts = Array.isArray(data.assignedDistricts)
      ? data.assignedDistricts.filter(
          (district): district is string => typeof district === "string",
        )
      : assignedDistricts;
  }

  return {
    assignedDistricts: canonicalizeDistrictList(assignedDistricts),
  };
}

function employeeKey(log: AttendanceLog) {
  return normalizeText(log.employeeDocId || log.employeeId || log.employeeName);
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse(
        "Field officer or admin access required.",
        403,
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const url = new URL(request.url);
    const date = normalizeText(url.searchParams.get("date")) || new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const requestedDistrict = normalizeText(url.searchParams.get("district"));
    const isAdmin = hasAdminAccess(decoded);
    const profile = await getFieldOfficerProfile(adminDb, decoded);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "date must be in YYYY-MM-DD format." },
        { status: 400 },
      );
    }

    if (
      !isAdmin &&
      requestedDistrict &&
      !profile.assignedDistricts.some((district) =>
        districtMatches(district, requestedDistrict),
      )
    ) {
      return NextResponse.json(
        { error: "Access denied for that district." },
        { status: 403 },
      );
    }

    const snapshot = await adminDb
      .collection("attendanceLogs")
      .where("attendanceDate", "==", date)
      .limit(2000)
      .get();

    const logs = snapshot.docs
      .map(
        (doc) =>
          ({
            id: doc.id,
            ...(doc.data() as Record<string, unknown>),
          }) as AttendanceLog,
      )
      .filter((log) => {
        const district = normalizeText(log.district);
        if (requestedDistrict && !districtMatches(district, requestedDistrict)) {
          return false;
        }
        if (isAdmin || profile.assignedDistricts.length == 0) {
          return true;
        }
        return profile.assignedDistricts.some((assigned) =>
          districtMatches(assigned, district),
        );
      });

    const grouped = new Map<
      string,
      {
        guardName: string;
        guardId: string;
        employeeId: string;
        siteName: string;
        clientName: string;
        district: string;
        dutyPointName: string;
        shiftLabel: string;
        photoUrl: string | null;
        checkIn: string | null;
        checkOut: string | null;
        lastMillis: number;
      }
    >();

    for (const log of logs) {
      const key = employeeKey(log);
      if (!key) continue;
      const millis = Math.max(
        toMillis(log.reportedAt),
        toMillis(log.createdAt),
        toMillis(log.reportedAtClient),
      );
      const status = normalizeText(log.status).toLowerCase();
      const current = grouped.get(key) ?? {
        guardName: normalizeText(log.employeeName) || "Guard",
        guardId: normalizeText(log.employeeId),
        employeeId: normalizeText(log.employeeId),
        siteName: normalizeText(log.siteName),
        clientName: normalizeText(log.clientName),
        district: normalizeText(log.district),
        dutyPointName: normalizeText(log.dutyPointName),
        shiftLabel: normalizeText(log.shiftLabel),
        photoUrl:
          typeof log.photoUrl === "string" && log.photoUrl.trim().length > 0
            ? log.photoUrl
            : null,
        checkIn: null,
        checkOut: null,
        lastMillis: 0,
      };

      if (status === "in" && !current.checkIn) {
        current.checkIn = toTimeLabel(log.reportedAt || log.createdAt);
      }
      if (status === "out" && !current.checkOut) {
        current.checkOut = toTimeLabel(log.reportedAt || log.createdAt);
      }

      if (millis >= current.lastMillis) {
        current.guardName = normalizeText(log.employeeName) || current.guardName;
        current.guardId = normalizeText(log.employeeId) || current.guardId;
        current.employeeId = normalizeText(log.employeeId) || current.employeeId;
        current.siteName = normalizeText(log.siteName) || current.siteName;
        current.clientName = normalizeText(log.clientName) || current.clientName;
        current.district = normalizeText(log.district) || current.district;
        current.dutyPointName =
          normalizeText(log.dutyPointName) || current.dutyPointName;
        current.shiftLabel = normalizeText(log.shiftLabel) || current.shiftLabel;
        current.photoUrl =
          (typeof log.photoUrl === "string" && log.photoUrl.trim().length > 0
              ? log.photoUrl
              : current.photoUrl) || null;
        current.lastMillis = millis;
      }

      grouped.set(key, current);
    }

    const attendance = Array.from(grouped.entries())
      .map(([key, value]) => ({
        id: key,
        guardName: value.guardName,
        guardId: value.guardId,
        employeeId: value.employeeId,
        siteName: value.siteName,
        clientName: value.clientName,
        district: value.district,
        date,
        checkIn: value.checkIn,
        checkOut: value.checkOut,
        dutyPointName: value.dutyPointName,
        shiftLabel: value.shiftLabel,
        status: value.checkOut != null
          ? "Checked out"
          : value.checkIn != null
            ? "Present"
            : "Absent",
        photoUrl: value.photoUrl,
      }))
      .sort((left, right) => {
        const statusOrder =
          (right.checkIn ? 1 : 0) - (left.checkIn ? 1 : 0);
        if (statusOrder != 0) return statusOrder;
        return left.guardName.localeCompare(right.guardName);
      });

    return NextResponse.json({ attendance });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not load attendance.";
    if (
      message.includes("Missing bearer token") ||
      message.includes("access required")
    ) {
      return unauthorizedResponse(message, 401);
    }
    console.error("[field-officer/guard-attendance]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
