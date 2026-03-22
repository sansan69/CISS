import * as admin from "firebase-admin";
import { NextResponse } from "next/server";

import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { db as keralaDb } from "@/lib/firebaseAdmin";
import { getRegionConnection } from "@/lib/server/region-connections";
import { REGION_CODE, REGION_NAME } from "@/lib/runtime-config";
import type {
  RegionOverviewCard,
  RegionRecord,
  SuperAdminOverviewSummary,
} from "@/types/region";

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  const appName = `super-admin-overview-${credentials.firebaseProjectId}-${Date.now()}`;
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

async function countDocs(ref: FirebaseFirestore.Query | FirebaseFirestore.CollectionReference) {
  const snapshot = await ref.count().get();
  return snapshot.data().count ?? 0;
}

async function buildRegionMetrics(
  db: FirebaseFirestore.Firestore,
  region: Pick<RegionRecord, "regionCode" | "regionName" | "status" | "firebaseProjectId" | "regionAdminEmail">,
  connectionStatus: RegionOverviewCard["connectionStatus"],
  connectionNote?: string,
): Promise<RegionOverviewCard> {
  const today = startOfToday();
  const todayTimestamp = admin.firestore.Timestamp.fromDate(today);

  const [
    employees,
    activeEmployees,
    onLeaveEmployees,
    clients,
    fieldOfficers,
    attendanceToday,
    upcomingWorkOrders,
  ] = await Promise.all([
    countDocs(db.collection("employees")),
    countDocs(db.collection("employees").where("status", "==", "Active")),
    countDocs(db.collection("employees").where("status", "==", "OnLeave")),
    countDocs(db.collection("clients")),
    countDocs(db.collection("fieldOfficers")),
    countDocs(db.collection("attendanceLogs").where("createdAt", ">=", todayTimestamp)),
    countDocs(db.collection("workOrders").where("date", ">=", todayTimestamp)),
  ]);

  return {
    regionCode: region.regionCode,
    regionName: region.regionName,
    status: region.status,
    firebaseProjectId: region.firebaseProjectId,
    regionAdminEmail: region.regionAdminEmail ?? null,
    connectionStatus,
    connectionNote,
    totals: {
      employees,
      activeEmployees,
      onLeaveEmployees,
      clients,
      fieldOfficers,
      attendanceToday,
      upcomingWorkOrders,
    },
    lastSyncedAt: new Date().toISOString(),
  };
}

function summarize(cards: RegionOverviewCard[]): SuperAdminOverviewSummary {
  return cards.reduce<SuperAdminOverviewSummary>(
    (acc, card) => {
      acc.totalRegions += 1;
      if (card.connectionStatus === "connected") {
        acc.connectedRegions += 1;
      }
      acc.employees += card.totals.employees;
      acc.activeEmployees += card.totals.activeEmployees;
      acc.onLeaveEmployees += card.totals.onLeaveEmployees;
      acc.clients += card.totals.clients;
      acc.fieldOfficers += card.totals.fieldOfficers;
      acc.attendanceToday += card.totals.attendanceToday;
      acc.upcomingWorkOrders += card.totals.upcomingWorkOrders;
      return acc;
    },
    {
      connectedRegions: 0,
      totalRegions: 0,
      employees: 0,
      activeEmployees: 0,
      onLeaveEmployees: 0,
      clients: 0,
      fieldOfficers: 0,
      attendanceToday: 0,
      upcomingWorkOrders: 0,
    },
  );
}

export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb.collection("regions").orderBy("regionCode").get();
    const regionDocs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as RegionRecord[];

    const cards: RegionOverviewCard[] = [];

    cards.push(
      await buildRegionMetrics(
        keralaDb,
        {
          regionCode: REGION_CODE,
          regionName: REGION_NAME,
          status: "live",
          firebaseProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ciss-workforce",
          regionAdminEmail:
            process.env.SUPER_ADMIN_EMAIL || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || null,
        },
        "connected",
      ),
    );

    for (const region of regionDocs) {
      if (region.regionCode === REGION_CODE) {
        continue;
      }

      const connection = await getRegionConnection(adminDb, region.regionCode);
      if (!connection) {
        cards.push({
          regionCode: region.regionCode,
          regionName: region.regionName,
          status: region.status,
          firebaseProjectId: region.firebaseProjectId,
          regionAdminEmail: region.regionAdminEmail ?? null,
          connectionStatus: "needs_credentials",
          connectionNote:
            "Reconnect this region once from the onboarding wizard so HQ can read consolidated metrics.",
          totals: {
            employees: 0,
            activeEmployees: 0,
            onLeaveEmployees: 0,
            clients: 0,
            fieldOfficers: 0,
            attendanceToday: 0,
            upcomingWorkOrders: 0,
          },
        });
        continue;
      }

      try {
        const card = await withTransientRegionApp(connection, async (db) =>
          buildRegionMetrics(db, region, "connected"),
        );
        cards.push(card);
      } catch (error: any) {
        cards.push({
          regionCode: region.regionCode,
          regionName: region.regionName,
          status: region.status,
          firebaseProjectId: region.firebaseProjectId,
          regionAdminEmail: region.regionAdminEmail ?? null,
          connectionStatus: "error",
          connectionNote: error?.message || "Could not read this region backend.",
          totals: {
            employees: 0,
            activeEmployees: 0,
            onLeaveEmployees: 0,
            clients: 0,
            fieldOfficers: 0,
            attendanceToday: 0,
            upcomingWorkOrders: 0,
          },
        });
      }
    }

    const orderedCards = cards.sort((a, b) => a.regionCode.localeCompare(b.regionCode));
    return NextResponse.json({
      summary: summarize(orderedCards),
      regions: orderedCards,
    });
  } catch (error: any) {
    return unauthorizedResponse(
      error?.message || "Could not load the super admin overview.",
      error?.message === "Super admin access required." ? 403 : 401,
    );
  }
}
