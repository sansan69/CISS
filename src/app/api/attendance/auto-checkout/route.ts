import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebaseAdmin";
import { runChunked, buildSelfUrl } from "@/lib/server/self-queue";
import { processStaleSession } from "@/lib/attendance/auto-checkout";

export const runtime = "nodejs";

const PAGE_LIMIT = 100;

async function verifyVercelCronSignature(request: NextRequest): Promise<boolean> {
  const signatureHeader = request.headers.get("x-vercel-signature");
  const secret = process.env.CRON_SECRET;
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",");
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Part = parts.find((p) => p.startsWith("v1="));
  if (!tPart || !v1Part) return false;

  const timestamp = tPart.slice(2);
  const signature = v1Part.slice(3);

  let body = "";
  try {
    body = await request.clone().text();
  } catch {}

  const payload = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const authorization = request.headers.get("authorization") || "";
  const bearerSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  let authorized = false;
  if (
    process.env.CRON_SECRET &&
    (key === process.env.CRON_SECRET ||
      bearerSecret === process.env.CRON_SECRET)
  ) {
    authorized = true;
  } else {
    authorized = await verifyVercelCronSignature(request);
  }

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const selfUrl = buildSelfUrl(request.url, "/api/attendance/auto-checkout");
  const cronSecret = process.env.CRON_SECRET || "";

  try {
    const result = await runChunked(
      {
        stateCollection: "systemConfig",
        jobId: "autoCheckoutQueue",
        budgetMs: 50_000,
        selfUrl,
        cronSecret,
      },
      // ── claim: read one page of stale attendance states ──
      async (tx, cursor) => {
        let query = adminDb
          .collection("attendanceState")
          .where("lastStatus", "==", "In")
          .orderBy("lastAttendanceDate")
          .limit(PAGE_LIMIT);

        if (cursor) {
          const cursorDocRef = adminDb
            .collection("attendanceState")
            .doc(cursor as string);
          const cursorDoc = await tx.get(cursorDocRef);
          if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
          }
        }

        const snapshot = await query.get();
        if (snapshot.empty) {
          return { chunk: null, cursor: null };
        }

        const docs = snapshot.docs;
        return {
          chunk: docs,
          cursor: docs[docs.length - 1].id,
        };
      },
      // ── process: close stale sessions in individual transactions ──
      async (docs) => {
        let closedCount = 0;

        for (const doc of docs) {
          try {
            let closed = false;
            await adminDb.runTransaction(async (tx) => {
              const freshSnap = await tx.get(doc.ref);
              if (!freshSnap.exists) return;
              const freshState = freshSnap.data() as Record<string, any>;
              const openSessionId =
                typeof freshState.openSessionId === "string"
                  ? freshState.openSessionId
                  : "";
              if (freshState.lastStatus !== "In") return;

              let freshSession: Record<string, any> | undefined;
              if (openSessionId) {
                const sessionRef = adminDb
                  .collection("attendanceSessions")
                  .doc(openSessionId);
                const freshSessionSnap = await tx.get(sessionRef);
                if (!freshSessionSnap.exists) return;
                freshSession =
                  freshSessionSnap.data() as Record<string, any>;
                if (
                  freshSession.status !== "open" ||
                  freshSession.employeeDocId !== doc.id
                ) {
                  return;
                }
              }

              const result = processStaleSession(
                doc,
                freshState,
                freshSession,
                now,
              );
              if (!result) return;
              for (const write of result.writes) {
                if (write.merge) {
                  tx.set(write.ref, write.data, { merge: true });
                } else {
                  tx.set(write.ref, write.data);
                }
              }
              closed = true;
            });
            if (closed) closedCount++;
          } catch (txError) {
            // Transaction conflict — the guard likely checked out concurrently
            console.warn(
              `[auto-checkout] Transaction conflict for ${doc.id}:`,
              txError,
            );
          }
        }

        return { done: true, processed: closedCount };
      },
    );

    // Write completion marker (covers W-P2-2)
    if (result.done) {
      await adminDb
        .collection("systemConfig")
        .doc("autoCheckoutQueue")
        .set(
          {
            autoCheckoutLastRun: {
              ranAt: now.toISOString(),
              closedCount: result.processed,
              status: result.status,
            },
          },
          { merge: true },
        );
    }

    if (!result.done) {
      return NextResponse.json(
        {
          success: false,
          status: result.status,
          closedCount: result.processed,
        },
        { status: result.status === "retry-later" ? 503 : 202 },
      );
    }

    return NextResponse.json({
      success: true,
      closedCount: result.processed,
      checkedAt: now.toISOString(),
    });
  } catch (error: any) {
    const { log } = await import("@/lib/server/log");
    log("error", "auto-checkout", "Auto-checkout job failed", {
      error: error?.message,
    });
    return NextResponse.json(
      { error: error?.message || "Auto-checkout failed." },
      { status: 500 },
    );
  }
}

// Vercel Cron invokes configured paths with GET and an Authorization bearer
// token. Keep POST for explicit/manual runs and route both methods through the
// same secured implementation.
export async function GET(request: NextRequest) {
  return POST(request);
}
