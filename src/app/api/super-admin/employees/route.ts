import * as admin from "firebase-admin";
import { NextResponse } from "next/server";

import type { Employee } from "@/types/employee";
import type { RegionRecord } from "@/types/region";
import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { db as keralaDb } from "@/lib/firebaseAdmin";
import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import { getRegionConnection } from "@/lib/server/region-connections";

type RegionTarget = {
  regionCode: string;
  regionName: string;
  firebaseProjectId: string;
};

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object" && value !== null) {
    if ("toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
      return (value as { toMillis: () => number }).toMillis();
    }
    if ("seconds" in value && typeof (value as { seconds?: unknown }).seconds === "number") {
      return ((value as { seconds: number }).seconds ?? 0) * 1000;
    }
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function matchesSearch(employee: Employee, searchTerm: string) {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return true;
  return [
    employee.fullName,
    employee.employeeId,
    employee.phoneNumber,
    employee.clientName,
    employee.regionName,
    employee.regionCode,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

async function withTransientRegionApp<T>(
  credentials: {
    firebaseProjectId: string;
    storageBucket?: string | null;
    serviceAccountJson: string;
  },
  callback: (db: FirebaseFirestore.Firestore) => Promise<T>,
) {
  const serviceAccount = JSON.parse(credentials.serviceAccountJson) as admin.ServiceAccount;
  const appName = `super-admin-employees-${credentials.firebaseProjectId}-${Date.now()}`;
  const regionApp = admin.initializeApp(
    {
      credential: admin.credential.cert({
        ...serviceAccount,
        privateKey: serviceAccount.privateKey?.replace(/\\n/g, "\n"),
      }),
      projectId: credentials.firebaseProjectId,
      storageBucket: credentials.storageBucket || undefined,
    },
    appName,
  );

  try {
    return await callback(regionApp.firestore());
  } finally {
    await regionApp.delete().catch(() => undefined);
  }
}

async function fetchEmployeesForRegion(
  db: FirebaseFirestore.Firestore,
  target: RegionTarget,
  filters: {
    status: string;
    client: string;
    district: string;
    limit: number;
    searchTerm: string;
  },
): Promise<Employee[]> {
  let query: FirebaseFirestore.Query = db.collection("employees");

  if (filters.status !== "all") {
    query = query.where("status", "==", filters.status);
  }
  if (filters.client !== "all") {
    query = query.where("clientName", "==", filters.client);
  }
  if (filters.district !== "all") {
    query = query.where("district", "==", filters.district);
  }

  query = query.limit(filters.limit);
  const snapshot = await query.get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as Partial<Employee>;
      return {
        ...data,
        id: doc.id,
        regionCode: target.regionCode,
        regionName: target.regionName,
      } as Employee;
    })
    .filter((employee) => matchesSearch(employee, filters.searchTerm));
}

export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request);
    const { searchParams } = new URL(request.url);
    const regionCode = (searchParams.get("regionCode") || "all").trim().toUpperCase();
    const status = searchParams.get("status") || "all";
    const client = searchParams.get("client") || "all";
    const district = searchParams.get("district") || "all";
    const searchTerm = searchParams.get("searchTerm") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "500", 10), 1000);

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb.collection("regions").orderBy("regionCode").get();
    const savedRegions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as RegionRecord[];

    const targets: RegionTarget[] = [];
    if (regionCode === "ALL" || regionCode === "all") {
      targets.push({
        regionCode: REGION_CODE,
        regionName: REGION_NAME,
        firebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ciss-workforce",
      });
      savedRegions.forEach((region) => {
        if (region.regionCode !== REGION_CODE) {
          targets.push({
            regionCode: region.regionCode,
            regionName: region.regionName,
            firebaseProjectId: region.firebaseProjectId,
          });
        }
      });
    } else if (regionCode === REGION_CODE) {
      targets.push({
        regionCode: REGION_CODE,
        regionName: REGION_NAME,
        firebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ciss-workforce",
      });
    } else {
      const match = savedRegions.find((region) => region.regionCode === regionCode);
      if (!match) {
        return NextResponse.json({ employees: [], warning: `Region ${regionCode} was not found.` });
      }
      targets.push({
        regionCode: match.regionCode,
        regionName: match.regionName,
        firebaseProjectId: match.firebaseProjectId,
      });
    }

    const perRegionLimit = Math.max(100, Math.ceil(limit / Math.max(targets.length, 1)));
    const employees: Employee[] = [];
    const warnings: string[] = [];

    for (const target of targets) {
      try {
        const regionEmployees =
          target.regionCode === REGION_CODE
            ? await fetchEmployeesForRegion(keralaDb, target, {
                status,
                client,
                district,
                limit: perRegionLimit,
                searchTerm,
              })
            : await (async () => {
                const connection = await getRegionConnection(adminDb, target.regionCode);
                if (!connection) {
                  warnings.push(`${target.regionName} is missing saved HQ credentials.`);
                  return [] as Employee[];
                }
                return withTransientRegionApp(connection, (regionDb) =>
                  fetchEmployeesForRegion(regionDb, target, {
                    status,
                    client,
                    district,
                    limit: perRegionLimit,
                    searchTerm,
                  }),
                );
              })();

        employees.push(...regionEmployees);
      } catch (error: any) {
        warnings.push(`${target.regionName}: ${error?.message || "Could not load employees."}`);
      }
    }

    const sorted = employees
      .sort((a, b) => {
        const createdDelta = toMillis(b.createdAt) - toMillis(a.createdAt);
        if (createdDelta !== 0) return createdDelta;
        return a.fullName.localeCompare(b.fullName);
      })
      .slice(0, limit);

    return NextResponse.json({
      employees: sorted,
      warnings,
    });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Could not load super admin employees.",
      error?.message === "Super admin access required." ? 403 : 401,
    );
  }
}
