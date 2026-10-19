import { NextResponse } from "next/server";
import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerAuditEvent } from "@/lib/server/audit";
import { runChunked, buildSelfUrl } from "@/lib/server/self-queue";
import {
  buildClaimRepairPlanFromIndexes,
  indexClaimRepairProfilesByUid,
  type ClaimsRepairPlan,
} from "@/lib/server/claims-repair";
export const runtime = "nodejs";
export const maxDuration = 60;

type RepairItem = ClaimsRepairPlan;

async function collectRepairItems() {
  const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
  const authUsers = [];
  let pageToken: string | undefined;
  do {
    const page = await adminAuth.listUsers(1000, pageToken);
    authUsers.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  const usersByUid = new Map(authUsers.map((user) => [user.uid, user]));
  const fieldOfficerDocs = await adminDb.collection("fieldOfficers").get();
  const clientUserDocs = await adminDb.collection("clientUsersByUid").get();
  const fieldOfficersByUid = indexClaimRepairProfilesByUid(
    fieldOfficerDocs.docs.map((snapshot) => snapshot.data() as Record<string, unknown>),
  );
  const clientUsersByUid = indexClaimRepairProfilesByUid(
    clientUserDocs.docs.map((snapshot) => snapshot.data() as Record<string, unknown>),
  );

  const repairItems: RepairItem[] = [];
  const linkedUids = new Set([
    ...fieldOfficersByUid.keys(),
    ...clientUsersByUid.keys(),
  ]);
  for (const uid of linkedUids) {
    const authUser = usersByUid.get(uid);
    // An absent Auth user cannot be repaired by POST; the shared planner also
    // rejects identities linked to both profile types.
    if (!authUser) continue;
    const profileEmail =
      fieldOfficersByUid.get(uid)?.email ?? clientUsersByUid.get(uid)?.email;
    const plan = buildClaimRepairPlanFromIndexes({
      uid,
      email:
        authUser.email ||
        (typeof profileEmail === "string" ? profileEmail : undefined),
      fieldOfficersByUid,
      clientUsersByUid,
      claims: authUser.customClaims as Record<string, unknown> | undefined,
    });
    if (plan) repairItems.push(plan);
  }

  return repairItems.sort((a, b) =>
    (a.email || a.uid).localeCompare(b.email || b.uid),
  );
}

export async function GET(request: Request) {
  try {
    await requireSuperAdmin(request);
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
    const adminUser = await requireSuperAdmin(request);
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");

    // Pre-load reference data from Firestore for cross-referencing
    const fieldOfficerDocs = await adminDb.collection("fieldOfficers").get();
    const clientUserDocs = await adminDb.collection("clientUsersByUid").get();

    const fieldOfficersByUid = indexClaimRepairProfilesByUid(
      fieldOfficerDocs.docs.map((doc) => doc.data() as Record<string, unknown>),
    );
    const clientUsersByUid = indexClaimRepairProfilesByUid(
      clientUserDocs.docs.map((doc) => doc.data() as Record<string, unknown>),
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
          const plan = buildClaimRepairPlanFromIndexes({
            uid: user.uid,
            email: user.email,
            fieldOfficersByUid,
            clientUsersByUid,
            claims: user.customClaims as Record<string, unknown> | undefined,
          });
          if (!plan) continue;

          // Fix the claims
          const nextClaims = {
            ...(user.customClaims as Record<string, unknown>),
            role: plan.expectedRole,
            ...plan.claimPatch,
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
