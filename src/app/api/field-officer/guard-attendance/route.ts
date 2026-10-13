import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
  type AppDecodedToken,
} from "@/lib/server/auth";
import { districtMatches } from "@/lib/districts";
import { requireActiveFieldOfficerProfile } from "@/lib/server/linked-profiles";
import { aggregateGuardAttendance } from "@/lib/attendance/guard-attendance";
export const runtime = "nodejs";

type FieldOfficerProfile = {
  assignedDistricts: string[];
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getFieldOfficerProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
): Promise<FieldOfficerProfile> {
  return requireActiveFieldOfficerProfile(adminDb, decoded);
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
    const date =
      normalizeText(url.searchParams.get("date")) ||
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    const requestedDistrict = normalizeText(url.searchParams.get("district"));
    const isAdmin = hasAdminAccess(decoded);
    const profile = await getFieldOfficerProfile(adminDb, decoded);
    if (!isAdmin && profile.assignedDistricts.length === 0) {
      return NextResponse.json(
        { error: "No districts are assigned to this field officer." },
        { status: 403 },
      );
    }

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

    const attendance = await aggregateGuardAttendance({
      adminDb,
      isAdmin,
      assignedDistricts: profile.assignedDistricts,
      requestedDistrict: requestedDistrict || null,
      startDate: date,
      endDate: date,
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
