import { NextResponse } from "next/server";

import { unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { resolveMobileSession } from "@/lib/server/mobile-session";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const session = await resolveMobileSession(decoded);

    if (!session) {
      return unauthorizedResponse("This Firebase account is not linked to a mobile guard or field officer profile.", 403);
    }

    return NextResponse.json(session);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not resolve mobile session.";
    return unauthorizedResponse(message, 401);
  }
}
