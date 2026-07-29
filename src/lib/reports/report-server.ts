import type FirebaseFirestore from "@google-cloud/firestore";

import { districtMatches } from "@/lib/districts";
import type { AppDecodedToken } from "@/lib/server/auth";

export type FieldOfficerReportProfile = {
  name: string;
  stateCode: string;
  assignedDistricts: string[];
};

export type ReportSiteSnapshot = {
  id: string;
  clientId: string;
  clientName: string;
  siteName: string;
  district: string;
  stateCode: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

export function serializeReportDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  const seconds =
    typeof (value as { seconds?: unknown }).seconds === "number"
      ? (value as { seconds: number }).seconds
      : typeof (value as { _seconds?: unknown })._seconds === "number"
        ? (value as { _seconds: number })._seconds
        : null;
  return seconds === null ? null : new Date(seconds * 1_000).toISOString();
}

export function serializeReport(
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot,
  dateField: "visitDate" | "trainingDate",
) {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    ...data,
    [dateField]: serializeReportDate(data[dateField]),
    createdAt: serializeReportDate(data.createdAt),
    updatedAt: serializeReportDate(data.updatedAt),
    submittedAt: serializeReportDate(data.submittedAt),
    reviewedAt: serializeReportDate(data.reviewedAt),
    acknowledgedAt: serializeReportDate(data.acknowledgedAt),
  } as Record<string, unknown>;
}

export async function getFieldOfficerReportProfile(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
): Promise<FieldOfficerReportProfile> {
  let name = decoded.name ?? decoded.email ?? "";
  let stateCode = decoded.stateCode ?? "KL";
  let assignedDistricts = Array.isArray(decoded.assignedDistricts) ? decoded.assignedDistricts : [];

  const snapshot = await adminDb
    .collection("fieldOfficers")
    .where("uid", "==", decoded.uid)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const data = snapshot.docs[0].data();
    name = typeof data.name === "string" ? data.name : name;
    stateCode = typeof data.stateCode === "string" ? data.stateCode : stateCode;
    assignedDistricts = Array.isArray(data.assignedDistricts)
      ? data.assignedDistricts.filter((value): value is string => typeof value === "string")
      : assignedDistricts;
  }

  return { name, stateCode, assignedDistricts };
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function resolveReportSite(
  adminDb: FirebaseFirestore.Firestore,
  siteId?: string,
): Promise<ReportSiteSnapshot | null> {
  if (!siteId) return null;
  const snapshot = await adminDb.collection("sites").doc(siteId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  const coordinates =
    data.coordinates && typeof data.coordinates === "object"
      ? (data.coordinates as Record<string, unknown>)
      : {};
  return {
    id: snapshot.id,
    clientId: typeof data.clientId === "string" ? data.clientId : "",
    clientName: typeof data.clientName === "string" ? data.clientName : "",
    siteName: typeof data.siteName === "string" ? data.siteName : "",
    district: typeof data.district === "string" ? data.district : "",
    stateCode: typeof data.stateCode === "string" ? data.stateCode : "KL",
    address:
      typeof data.address === "string"
        ? data.address
        : typeof data.location === "string"
          ? data.location
          : "",
    latitude: finiteNumber(data.latitude) ?? finiteNumber(coordinates.latitude),
    longitude: finiteNumber(data.longitude) ?? finiteNumber(coordinates.longitude),
  };
}

export function canFieldOfficerUseReportDistrict(
  profile: FieldOfficerReportProfile,
  district?: string,
) {
  if (!district || profile.assignedDistricts.length === 0) return true;
  return profile.assignedDistricts.some((assigned) => districtMatches(assigned, district));
}

export function reportMatchesAdminScope(
  report: Record<string, unknown>,
  decoded: AppDecodedToken,
) {
  if (decoded.role === "superAdmin") return true;
  const stateCode = decoded.stateCode || "KL";
  if (String(report.stateCode || "KL") !== stateCode) return false;
  const assignedDistricts = Array.isArray(decoded.assignedDistricts)
    ? decoded.assignedDistricts
    : [];
  if (assignedDistricts.length === 0) return true;
  return assignedDistricts.some((assigned) =>
    districtMatches(assigned, String(report.district ?? "")),
  );
}

export function reportCreatedAtMillis(report: Record<string, unknown>, fallbackField: string) {
  const iso =
    serializeReportDate(report.createdAt) ??
    serializeReportDate(report.submittedAt) ??
    serializeReportDate(report[fallbackField]);
  const millis = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(millis) ? millis : 0;
}

export class ReportApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ReportApiError";
  }
}
