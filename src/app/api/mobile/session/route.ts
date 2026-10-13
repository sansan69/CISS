import { NextResponse } from "next/server";

import { unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { resolveMobileSession } from "@/lib/server/mobile-session";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const session = await resolveMobileSession(decoded);

    if (!session) {
      return unauthorizedResponse("Unauthorized.", 401);
    }

    return NextResponse.json(session);
  } catch (error: unknown) {
    console.error("[mobile/session]", error);
    return unauthorizedResponse("Unauthorized.", 401);
  }
}
