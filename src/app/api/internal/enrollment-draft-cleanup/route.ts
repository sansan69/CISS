import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db, storage } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

const CLEANUP_LIMIT = 100;

function isAuthorized(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const bearerSecret = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const querySecret = new URL(request.url).searchParams.get("key") || "";
  const expectedSecret = process.env.CRON_SECRET || "";

  return Boolean(
    expectedSecret &&
      (bearerSecret === expectedSecret || querySecret === expectedSecret),
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const expiredDrafts = await db
      .collection("enrollments")
      .where("status", "==", "draft")
      .where("expiresAt", "<=", Timestamp.now())
      .limit(CLEANUP_LIMIT)
      .get();

    const bucket = storage.bucket();
    let deleted = 0;
    const failed: string[] = [];

    for (const draft of expiredDrafts.docs) {
      try {
        await bucket.deleteFiles({
          prefix: `enrollments/${draft.id}/`,
          force: true,
        });
        await draft.ref.delete();
        deleted += 1;
      } catch (error) {
        failed.push(draft.id);
        console.error(
          `[enrollment-cleanup] Could not remove expired draft ${draft.id}:`,
          error,
        );
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      inspected: expiredDrafts.size,
      deleted,
      failed: failed.length,
      hasMore: expiredDrafts.size === CLEANUP_LIMIT,
    });
  } catch (error) {
    console.error("[enrollment-cleanup] Cleanup failed:", error);
    return NextResponse.json(
      { error: "Enrollment draft cleanup failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
