import { NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebaseAdmin";
import {
  findPendingJob,
  executeOneStep,
  getAutomationJob,
} from "@/lib/server/region-automator";
import { runChunked, buildSelfUrl } from "@/lib/server/self-queue";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 300;

const AUTOMATION_COLLECTION = "automationJobs";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.AUTOMATION_WORKER_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const selfUrl = buildSelfUrl(request.url, "/api/internal/automation-worker");
  const cronSecret = process.env.CRON_SECRET || process.env.AUTOMATION_WORKER_SECRET || "";

  try {
    const result = await runChunked(
      {
        stateCollection: "systemConfig",
        jobId: "automationWorkerQueue",
        budgetMs: 50_000,
        selfUrl,
        cronSecret,
      },
      // ── claim: find and claim the next pending job ──
      async (tx, _cursor) => {
        const pending = await findPendingJob(adminDb);
        if (!pending) return { chunk: null, cursor: null };

        const jobRef = adminDb.collection(AUTOMATION_COLLECTION).doc(pending.id);
        const freshSnap = await tx.get(jobRef);
        if (!freshSnap.exists) return { chunk: null, cursor: null };

        const jobData = freshSnap.data() as Record<string, unknown>;
        const staleCutoff = Date.now() - 15 * 60 * 1000;
        const isQueued = jobData.status === "queued";
        const isStaleRunning =
          jobData.status === "running" &&
          (!jobData.claimedAt ||
            new Date(jobData.claimedAt as string).getTime() < staleCutoff);

        if (!isQueued && !isStaleRunning) return { chunk: null, cursor: null };

        const claimedAt = new Date().toISOString();
        const workerId = `worker-${crypto.randomUUID()}`;

        tx.update(jobRef, {
          status: "running",
          claimedAt,
          workerId,
          lastHeartbeatAt: FieldValue.serverTimestamp(),
          error: null,
        });

        return {
          chunk: {
            ...jobData,
            id: pending.id,
            status: "running",
            claimedAt,
            workerId,
          },
          cursor: pending.id,
        };
      },
      // ── process: execute ONE step of the claimed job ──
      async (chunk: any) => {
        const jobDoc = await adminDb
          .collection(AUTOMATION_COLLECTION)
          .doc(chunk.id)
          .get();
        if (!jobDoc.exists) return { done: true, processed: 0 };

        const job = { id: chunk.id, ...jobDoc.data() } as any;

        const regionSnap = await adminDb
          .collection("regions")
          .doc(job.regionCode)
          .get();
        if (!regionSnap.exists) {
          await jobDoc.ref.update({
            status: "failed",
            error: `Region ${job.regionCode} no longer exists.`,
            completedAt: new Date().toISOString(),
          });
          return { done: true, processed: 1 };
        }

        const region = {
          ...(regionSnap.data() as Record<string, unknown>),
          id: job.regionCode,
          regionCode: job.regionCode,
        };

        const { getRegionConnection } = await import(
          "@/lib/server/region-connections"
        );
        const connection = await getRegionConnection(
          adminDb,
          job.regionCode,
        ).catch(() => null);

        await executeOneStep(
          adminDb,
          job,
          region as any,
          connection?.serviceAccountJson || null,
          {
            uid: job.workerId || "automation-worker",
            email: "automation-worker@ciss.local",
          },
        );

        return { done: true, processed: 1 };
      },
    );

    if (!result.done) {
      return NextResponse.json({ status: 202 });
    }

    return NextResponse.json({
      done: true,
      processed: result.processed,
    });
  } catch (error: any) {
    console.error("[automation-worker] Error:", error?.message);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
