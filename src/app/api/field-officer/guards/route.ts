import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import {
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

    // Explicitly paged clients use stable document-ID order; legacy callers
    // retain the complete newest-enrollment roster used by assignment dialogs.
    if (limitParam !== null || searchParams.has("after")) {
      const pageLimit = Math.min(resultLimit, 200);
      const scope = createHash("sha256").update(JSON.stringify({
        uid: decoded.uid, districts: [...districtScope].sort(), includeInactive,
      })).digest("hex");
      let after = "";
      const encoded = searchParams.get("after");
      if (encoded) {
        try {
          if (encoded.length > 2048) throw new Error();
          const cursor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
          if (cursor.v !== 1 || cursor.scope !== scope || typeof cursor.id !== "string" || !cursor.id || cursor.id.includes("/")) throw new Error();
          after = cursor.id;
        } catch {
          return NextResponse.json({ error: "Invalid or expired employee cursor." }, { status: 400 });
        }
      }
      const builds: Array<() => FirebaseFirestore.Query> = [];
      if (isAdmin && districtScope.length === 0) builds.push(() => adminDb.collection("employees"));
      else {
        const values = [...new Set(districtScope.flatMap(getDistrictFirestoreQueryValues))];
        for (const field of ["district", "districtName", "currentDistrict", "permanentDistrict", "addressDistrict", "locationDistrict", "city"]) {
          for (let i = 0; i < values.length; i += 30) {
            const chunk = values.slice(i, i + 30);
            builds.push(() => adminDb.collection("employees").where(field, "in", chunk));
          }
        }
      }
      const visible: Array<{ id: string; profile: ReturnType<typeof serializeGuardProfileView> & { district: string; createdAt: string } }> = [];
      let scanned = 0;
      while (visible.length <= pageLimit && scanned < MAX_GUARD_RESULTS) {
        const pages = await Promise.all(builds.map(async (build) => {
          let query = build().orderBy("__name__").limit(pageLimit + 1);
          if (after) query = query.startAfter(after);
          return (await query.get()).docs;
        }));
        const unique = new Map(pages.flat().map(doc => [doc.id, doc]));
        const docs = [...unique.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        if (!docs.length) break;
        const batch = docs.slice(0, pageLimit + 1);
        for (const doc of batch) {
          scanned++;
          after = doc.id;
          const employee = doc.data() as Record<string, unknown>;
          if (!includeInactive && normalizeText(employee.status || "Active").toLowerCase() !== "active") continue;
          if (districtScope.length && !employeeMatchesAnyDistrict(employee, districtScope)) continue;
          const profile = serializeGuardProfileView(doc.id, employee);
          visible.push({ id: doc.id, profile: { ...profile, district: resolveEmployeeDistrict(employee), createdAt: new Date(enrollmentTime(doc, employee)).toISOString() } });
          if (visible.length > pageLimit) break;
        }
        if (docs.length < pageLimit + 1) break;
      }
      const hasMore = visible.length > pageLimit || scanned >= MAX_GUARD_RESULTS;
      // Use the last returned row, not a prefetched row, as the continuation.
      const cursorId = visible[Math.min(visible.length, pageLimit) - 1]?.id ?? after;
      return NextResponse.json({
        guards: visible.slice(0, pageLimit).map(row => row.profile),
        nextCursor: hasMore && cursorId ? Buffer.from(JSON.stringify({ v: 1, id: cursorId, scope })).toString("base64url") : null,
      }, { headers: { "Cache-Control": "no-store, private" } });
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
