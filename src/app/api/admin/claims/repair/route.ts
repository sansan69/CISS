import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { LEGACY_ADMIN_EMAILS } from "@/lib/constants";
import { buildServerAuditEvent } from "@/lib/server/audit";
import { runChunked, buildSelfUrl } from "@/lib/server/self-queue";
export const runtime = "nodejs";
export const maxDuration = 60;

type RepairItem = {
  uid: string;
  email?: string;
  expectedRole: "admin" | "fieldOfficer" | "client";
  currentRole: string | null;
  source: "legacyAdminEmail" | "fieldOfficers" | "clientUsersByUid";
  claimPatch?: Record<string, unknown>;
};

function claimsToRole(claims: Record<string, unknown> | undefined) {
  if (claims?.admin === true || claims?.role === "admin") return "admin";
  if (claims?.role === "fieldOfficer") return "fieldOfficer";
  if (claims?.role === "client") return "client";
  return null;
}

async function collectRepairItems() {
  const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
  const listedUsers = await adminAuth.listUsers(1000);
  const usersByUid = new Map(listedUsers.users.map((user) => [user.uid, user]));
  const usersByEmail = new Map(
    listedUsers.users
      .filter((user) => user.email)
      .map((user) => [String(user.email).toLowerCase(), user]),
  );

  const fieldOfficerDocs = await adminDb.collection("fieldOfficers").get();
  const clientUserDocs = await adminDb.collection("clientUsersByUid").get();
  const repairItems = new Map<string, RepairItem>();

  for (const snapshot of fieldOfficerDocs.docs) {
    const data = snapshot.data() as {
      uid?: string;
      email?: string;
      stateCode?: string;
      assignedDistricts?: string[];
    };
    if (!data.uid) continue;
    const authUser = usersByUid.get(data.uid);
    const currentRole = claimsToRole(authUser?.customClaims);
    if (currentRole !== "fieldOfficer") {
      repairItems.set(data.uid, {
        uid: data.uid,
        email: authUser?.email || data.email,
        expectedRole: "fieldOfficer",
        currentRole,
        source: "fieldOfficers",
        claimPatch: {
          stateCode: data.stateCode ?? "KL",
          assignedDistricts: Array.isArray(data.assignedDistricts)
            ? data.assignedDistricts
            : [],
        },
      });
    }
  }

  for (const snapshot of clientUserDocs.docs) {
    const data = snapshot.data() as {
      uid?: string;
      email?: string;
      stateCode?: string;
      clientId?: string;
      clientName?: string;
    };
    if (!data.uid) continue;
    const authUser = usersByUid.get(data.uid);
    const currentRole = claimsToRole(authUser?.customClaims);
    if (currentRole !== "client") {
      repairItems.set(data.uid, {
        uid: data.uid,
        email: authUser?.email || data.email,
        expectedRole: "client",
        currentRole,
        source: "clientUsersByUid",
        claimPatch: {
          stateCode: data.stateCode ?? "KL",
          clientId: data.clientId ?? null,
          clientName: data.clientName ?? null,
        },
      });
    }
  }

  for (const email of LEGACY_ADMIN_EMAILS) {
    const authUser = usersByEmail.get(email.toLowerCase());
    if (!authUser) continue;
    const currentRole = claimsToRole(authUser.customClaims);
    if (currentRole !== "admin") {
      repairItems.set(authUser.uid, {
        uid: authUser.uid,
        email: authUser.email,
        expectedRole: "admin",
        currentRole,
        source: "legacyAdminEmail",
      });
    }
  }

  return Array.from(repairItems.values()).sort((a, b) =>
    (a.email || a.uid).localeCompare(b.email || b.uid),
  );
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const items = await collectRepairItems();

    return NextResponse.json({
      totalMismatches: items.length,
      items,
    });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");

    // Pre-load reference data from Firestore for cross-referencing
    const fieldOfficerDocs = await adminDb.collection("fieldOfficers").get();
    const clientUserDocs = await adminDb.collection("clientUsersByUid").get();

    const fieldOfficersByUid = new Map<string, Record<string, any>>();
    for (const doc of fieldOfficerDocs.docs) {
      const data = doc.data();
      if (data.uid) fieldOfficersByUid.set(data.uid, data);
    }

    const clientUsersByUid = new Map<string, Record<string, any>>();
    for (const doc of clientUserDocs.docs) {
      const data = doc.data();
      if (data.uid) clientUsersByUid.set(data.uid, data);
    }

    const legacyAdminEmailSet = new Set(
      LEGACY_ADMIN_EMAILS.map((e: string) => e.toLowerCase()),
    );

    const selfUrl = buildSelfUrl(request.url, "/api/admin/claims/repair");
    const cronSecret = process.env.CRON_SECRET || "";

    const result = await runChunked(
      {
        stateCollection: "systemConfig",
        jobId: "claimsRepairQueue",
        budgetMs: 50_000,
        selfUrl,
        cronSecret,
      },
      // ── claim: next page of auth users ──
      async (_tx, cursor) => {
        const listResult = await adminAuth.listUsers(
          1000,
          cursor ? (cursor as string) : undefined,
        );
        return {
          chunk: listResult.users.length > 0 ? listResult.users : null,
          cursor: listResult.pageToken ?? null,
        };
      },
      // ── process: diff claims and fix mismatches ──
      async (users) => {
        let repaired = 0;

        for (const user of users) {
          const foData = fieldOfficersByUid.get(user.uid);
          const cuData = clientUsersByUid.get(user.uid);
          const isLegacyAdmin =
            user.email && legacyAdminEmailSet.has(user.email.toLowerCase());

          let expectedRole: "admin" | "fieldOfficer" | "client" | null = null;
          let claimPatch: Record<string, unknown> | undefined;

          if (foData) {
            expectedRole = "fieldOfficer";
            claimPatch = {
              stateCode: foData.stateCode ?? "KL",
              assignedDistricts: Array.isArray(foData.assignedDistricts)
                ? foData.assignedDistricts
                : [],
            };
          } else if (cuData) {
            expectedRole = "client";
            claimPatch = {
              stateCode: cuData.stateCode ?? "KL",
              clientId: cuData.clientId ?? null,
              clientName: cuData.clientName ?? null,
            };
          } else if (isLegacyAdmin) {
            expectedRole = "admin";
          }

          if (!expectedRole) continue;

          const currentRole = claimsToRole(
            user.customClaims as Record<string, unknown> | undefined,
          );
          if (currentRole === expectedRole) continue;

          // Fix the claims
          const nextClaims =
            expectedRole === "admin"
              ? { ...user.customClaims, admin: true, role: "admin" }
              : {
                  ...(user.customClaims as Record<string, unknown>),
                  role: expectedRole,
                  ...(claimPatch ?? {}),
                };

          await adminAuth.setCustomUserClaims(user.uid, nextClaims);
          if (!user.emailVerified && user.email) {
            await adminAuth.updateUser(user.uid, { emailVerified: true });
          }
          repaired += 1;
        }

        return { done: true, processed: repaired };
      },
    );

    // Write audit doc on completion
    if (result.done) {
      await adminDb.collection("roleClaimRepairAudit").add({
        ...buildServerAuditEvent(
          "role_claim_repair_run",
          {
            uid: adminUser.uid,
            email: adminUser.email,
          },
          {
            repaired: result.processed,
            itemCount: result.processed,
            repairedItems: [],
          },
        ),
      });
    }

    if (!result.done) {
      return NextResponse.json({ status: 202 });
    }

    return NextResponse.json({
      repaired: result.processed,
    });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
