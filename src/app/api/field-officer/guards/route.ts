import { NextResponse } from "next/server";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import {
  canonicalizeDistrictList,
  districtMatches,
  getDistrictFirestoreQueryValues,
} from "@/lib/districts";
import { employeeMatchesAnyDistrict, resolveEmployeeDistrict } from "@/lib/employees/visibility";
import { serializeGuardProfileView } from "@/lib/server/guard-profile-view";
import { requireActiveFieldOfficerProfile } from "@/lib/server/linked-profiles";
export const runtime = "nodejs";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// Firestore `in` queries only return a bounded page, ordered by document id.
// A district roster that exceeds one page would silently drop the guards that
// sort last (this is what hid an Ernakulam guard past the 300th document and
// made her impossible to assign). Page through the cursor until the scoped
// roster is exhausted, with a high safety ceiling.
const GUARD_PAGE_SIZE = 300;
const MAX_GUARD_RESULTS = 5000;

async function fetchAllDocs(
  buildQuery: () => FirebaseFirestore.Query,
  maxDocs: number,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (docs.length < maxDocs) {
    const pageSize = Math.min(GUARD_PAGE_SIZE, maxDocs - docs.length);
    let query = buildQuery().limit(pageSize);
    if (cursor) {
      query = query.startAfter(cursor);
    }
    const snapshot = await query.get();
    if (snapshot.empty) break;
    docs.push(...snapshot.docs);
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) break;
  }
  return docs;
}

type TimestampLike = {
  _nanoseconds?: number;
  _seconds?: number;
  nanoseconds?: number;
  seconds?: number;
  toDate?: () => Date;
  toMillis?: () => number;
};

function toEpochMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === "object") {
    const timestamp = value as TimestampLike;
    if (typeof timestamp.toMillis === "function") {
      const millis = timestamp.toMillis();
      return Number.isFinite(millis) ? millis : 0;
    }
    if (typeof timestamp.toDate === "function") {
      return toEpochMillis(timestamp.toDate());
    }

    const seconds = timestamp.seconds ?? timestamp._seconds;
    const nanoseconds = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0;
    if (typeof seconds === "number" && Number.isFinite(seconds)) {
      return (seconds * 1_000) + (Number.isFinite(nanoseconds) ? nanoseconds / 1_000_000 : 0);
    }
  }

  return 0;
}

function enrollmentTime(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  employee: Record<string, unknown>,
) {
  // `createdAt` is written by the enrollment endpoint. The aliases support
  // older imports, while Firestore's document creation time is the safest
  // fallback for legacy records that did not store an enrollment timestamp.
  const storedEnrollmentTime = [
    employee.createdAt,
    employee.enrollmentDate,
    employee.enrolledAt,
    employee.registeredAt,
  ]
    .map(toEpochMillis)
    .find((value) => value > 0);

  return storedEnrollmentTime
    || toEpochMillis(doc.createTime)
    || toEpochMillis(employee.joiningDate);
}

async function getAssignedDistricts(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
) {
  return (await requireActiveFieldOfficerProfile(adminDb, decoded)).assignedDistricts;
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { searchParams } = new URL(request.url);
    // Only honor an explicit `limit`. Callers that scope by district without a
    // limit (the work-order assignment dialog) must receive the whole roster,
    // otherwise guards beyond the first page can never be selected.
    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam === null ? NaN : Number.parseInt(limitParam, 10);
    const resultLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_GUARD_RESULTS)
      : MAX_GUARD_RESULTS;
    const requestedDistricts = searchParams
      .getAll("district")
      .map(normalizeText)
      .filter(Boolean);
    const isAdmin = hasAdminAccess(decoded);
    const assignedDistricts = isAdmin ? [] : await getAssignedDistricts(adminDb, decoded);
    const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "true";
    const districtScope = requestedDistricts.length > 0
      ? requestedDistricts.filter((district) =>
          isAdmin || assignedDistricts.some((assigned) => districtMatches(assigned, district)),
        )
      : assignedDistricts;

    if (!isAdmin && districtScope.length === 0) {
      return NextResponse.json({ guards: [] }, {
        headers: { "Cache-Control": "no-store, private" },
      });
    }

    const employeeDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    if (isAdmin && districtScope.length === 0) {
      const docs = await fetchAllDocs(() => adminDb.collection("employees"), resultLimit);
      docs.forEach((doc) => employeeDocs.set(doc.id, doc));
    } else {
      // Firestore supports at most 30 values in an `in` query. Query only the
      // officer's canonical district scope and merge chunks by document ID.
      const queryValues = Array.from(
        new Set(districtScope.flatMap((district) => getDistrictFirestoreQueryValues(district))),
      );
      const chunks: string[][] = [];
      for (let index = 0; index < queryValues.length; index += 30) {
        chunks.push(queryValues.slice(index, index + 30));
      }
      const districtFields = [
        "district",
        "districtName",
        "currentDistrict",
        "permanentDistrict",
        "addressDistrict",
        "locationDistrict",
        "city",
      ];
      const results = await Promise.all(
        districtFields.flatMap((field) =>
          chunks.map((districts) =>
            fetchAllDocs(
              () => adminDb.collection("employees").where(field, "in", districts),
              resultLimit,
            ),
          ),
        ),
      );
      results.forEach((docs) => {
        docs.forEach((doc) => employeeDocs.set(doc.id, doc));
      });
    }

    const guards = Array.from(employeeDocs.values())
      .map((doc) => {
        const employee = {
          id: doc.id,
          ...(doc.data() as Record<string, unknown>),
        } as Record<string, unknown> & { id: string };
        return { doc, employee, enrollmentTime: enrollmentTime(doc, employee) };
      })
      .filter(({ employee }) => includeInactive || normalizeText(employee.status || "Active").toLowerCase() === "active")
      .filter(({ employee }) => {
        if (districtScope.length === 0) return true;
        return employeeMatchesAnyDistrict(employee, districtScope);
      })
      .sort((left, right) => {
        // Newest enrolled guard first; name breaks ties for same-moment records.
        const byEnrollment = right.enrollmentTime - left.enrollmentTime;
        if (byEnrollment !== 0) return byEnrollment;
        const byName = normalizeText(left.employee.fullName).localeCompare(
          normalizeText(right.employee.fullName),
        );
        if (byName !== 0) return byName;
        return left.doc.id.localeCompare(right.doc.id);
      })
      .map(({ employee, enrollmentTime }) => {
        const profile = serializeGuardProfileView(String(employee.id), employee);
        return {
          ...profile,
          district: resolveEmployeeDistrict(employee),
          joiningDate: profile.joiningDate || "",
          // ISO string so the roster can render "Enrolled <date>"; falls back to
          // document creation time for legacy records without a stored timestamp.
          createdAt: new Date(enrollmentTime).toISOString(),
        };
      });
    const limitedGuards = guards.slice(0, resultLimit);

    return NextResponse.json({ guards: limitedGuards }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load guards.";
    return unauthorizedResponse(message, 401);
  }
}
