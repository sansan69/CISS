import { NextResponse } from "next/server";

import { db } from "@/lib/firebaseAdmin";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const stateDoc = await db
      .collection("attendanceState")
      .doc(guard.employeeDocId)
      .get();

    if (!stateDoc.exists) {
      return NextResponse.json({
        isClockedIn: false,
        siteId: null,
        openSessionId: null,
      });
    }

    const state = stateDoc.data() as Record<string, unknown>;
    const siteId = normalizeText(state.lastSiteId);
    const openSessionId = normalizeText(state.openSessionId);
    const isClockedIn =
      normalizeText(state.lastStatus) === "In" &&
      Boolean(siteId) &&
      Boolean(openSessionId);

    return NextResponse.json({
      isClockedIn,
      siteId: isClockedIn ? siteId : null,
      openSessionId: isClockedIn ? openSessionId : null,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Could not check tracking status.";
    if (
      message.includes("Missing bearer token") ||
      message.includes("Guard access required")
    ) {
      return unauthorizedResponse(message);
    }
    console.error("[guard/tracking/status]", error);
    return NextResponse.json(
      { error: "Tracking status could not be checked." },
      { status: 500 },
    );
  }
}
