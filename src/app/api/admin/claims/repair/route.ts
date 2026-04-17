import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { LEGACY_ADMIN_EMAILS } from "@/lib/constants";
import { buildServerAuditEvent } from "@/lib/server/audit";

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
    const items = await collectRepairItems();
    let repaired = 0;

    for (const item of items) {
      const userRecord = await adminAuth.getUser(item.uid);
      const existingClaims = userRecord.customClaims || {};
      const nextClaims =
        item.expectedRole === "admin"
          ? { ...existingClaims, admin: true, role: "admin" }
          : {
              ...existingClaims,
              role: item.expectedRole,
              ...(item.claimPatch ?? {}),
            };
      await adminAuth.setCustomUserClaims(item.uid, nextClaims);
      if (!userRecord.emailVerified && userRecord.email) {
        await adminAuth.updateUser(item.uid, { emailVerified: true });
      }
      repaired += 1;
    }

    await adminDb.collection("roleClaimRepairAudit").add({
      ...buildServerAuditEvent(
        "role_claim_repair_run",
        {
          uid: adminUser.uid,
          email: adminUser.email,
        },
        {
          repaired,
          itemCount: items.length,
          repairedItems: items.map((item) => ({
            uid: item.uid,
            email: item.email ?? null,
            expectedRole: item.expectedRole,
            source: item.source,
          })),
        },
      ),
    });

    return NextResponse.json({
      repaired,
      items,
    });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
