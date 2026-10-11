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
export const dynamic = "force-dynamic";

type FieldOfficerProfile = {
  assignedDistricts: string[];
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Mirrors the mobile upper bound so a single range request cannot fan out.
const MAX_RANGE_DAYS = 62;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(DATE_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function dayNumber(parsed: { year: number; month: number; day: number }) {
  return Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86400000);
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
    const start = normalizeText(url.searchParams.get("start"));
    const end = normalizeText(url.searchParams.get("end"));
    const requestedDistrict = normalizeText(url.searchParams.get("district"));
    const isAdmin = hasAdminAccess(decoded);
    const profile = await getFieldOfficerProfile(adminDb, decoded);
    if (!isAdmin && profile.assignedDistricts.length === 0) {
      return NextResponse.json(
        { error: "No districts are assigned to this field officer." },
        { status: 403 },
      );
    }

    const startParsed = DATE_RE.test(start) ? parseIsoDate(start) : null;
    const endParsed = DATE_RE.test(end) ? parseIsoDate(end) : null;
    if (!startParsed || !endParsed) {
      return NextResponse.json(
        { error: "start and end must be in YYYY-MM-DD format." },
        { status: 400 },
      );
    }
    if (dayNumber(startParsed) > dayNumber(endParsed)) {
      return NextResponse.json(
        { error: "start must be on or before end." },
        { status: 400 },
      );
    }
    if (dayNumber(endParsed) - dayNumber(startParsed) + 1 > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `A range request must span at most ${MAX_RANGE_DAYS} days.` },
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
      startDate: start,
      endDate: end,
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
    console.error("[field-officer/guard-attendance/range]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
