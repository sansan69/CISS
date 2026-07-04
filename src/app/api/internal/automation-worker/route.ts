import { NextResponse } from "next/server";

import { processNextAutomationJob } from "@/lib/server/region-automator";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.AUTOMATION_WORKER_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function runWorker(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db: adminDb } = await import("@/lib/firebaseAdmin");
  const result = await processNextAutomationJob(adminDb);
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return runWorker(request);
}

export async function POST(request: Request) {
  return runWorker(request);
}
