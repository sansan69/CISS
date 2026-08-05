import { NextResponse } from "next/server";
import { hasAdminAccess, hasFieldOfficerAccess, unauthorizedResponse, verifyRequestAuth, type AppDecodedToken } from "@/lib/server/auth";
import {
  canonicalizeDistrictList,
  districtMatches,
  getDistrictFirestoreQueryValues,
} from "@/lib/districts";
import { employeeMatchesAnyDistrict, resolveEmployeeDistrict } from "@/lib/employees/visibility";
import { serializeGuardProfileView } from "@/lib/server/guard-profile-view";
export const runtime = "nodejs";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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
  const foSnapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!foSnapshot.empty) {
    const foData = foSnapshot.docs[0].data();
    if (Array.isArray(foData.assignedDistricts)) {
      return canonicalizeDistrictList(
        foData.assignedDistricts.filter((district): district is string => typeof district === "string"),
      );
    }
  }

  return Array.isArray(decoded.assignedDistricts)
    ? canonicalizeDistrictList(decoded.assignedDistricts.filter((district): district is string => typeof district === "string"))
    : [];
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded)) {
      return unauthorizedResponse("Field officer or admin access required.", 403);
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const requestedDistricts = new URL(request.url)
      .searchParams
      .getAll("district")
      .map(normalizeText)
      .filter(Boolean);
    const assignedDistricts = await getAssignedDistricts(adminDb, decoded);
    const isAdmin = hasAdminAccess(decoded);
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
      const snapshot = await adminDb.collection("employees").get();
      snapshot.docs.forEach((doc) => employeeDocs.set(doc.id, doc));
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
      const snapshots = await Promise.all(
        districtFields.flatMap((field) =>
          chunks.map((districts) =>
            adminDb.collection("employees").where(field, "in", districts).get(),
          ),
        ),
      );
      snapshots.forEach((snapshot) => {
        snapshot.docs.forEach((doc) => employeeDocs.set(doc.id, doc));
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
        const byEnrollment = right.enrollmentTime - left.enrollmentTime;
        if (byEnrollment !== 0) return byEnrollment;
        const byName = normalizeText(left.employee.fullName).localeCompare(normalizeText(right.employee.fullName));
        return byName || left.doc.id.localeCompare(right.doc.id);
      })
      .map(({ employee }) => {
        const profile = serializeGuardProfileView(String(employee.id), employee);
        return {
          ...profile,
          district: resolveEmployeeDistrict(employee),
          joiningDate: profile.joiningDate || "",
        };
      });

    return NextResponse.json({ guards }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load guards.";
    return unauthorizedResponse(message, 401);
  }
}
