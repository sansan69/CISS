import { NextResponse } from "next/server";

import {
  hasClientAccess,
  unauthorizedResponse,
  verifyRequestAuth,
} from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";

export const runtime = "nodejs";

/**
 * Client-scoped site districts for a set of ids.
 *
 * The work-order board previously resolved `sites/{id}.district` with a
 * `where("__name__", "in", ids)` query from the browser. Firestore cannot prove
 * a client-scope constraint for a document-id-only query, so the rule denies it
 * and the client's site-district map stayed empty. This route performs the same
 * lookup with the Admin SDK and filters every document through
 * `matchesClientScope`, so a client only ever sees its own sites.
 */
export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasClientAccess(decoded)) {
      return unauthorizedResponse("Client access required.", 403);
    }

    const { searchParams } = new URL(request.url);
    const ids = (searchParams.get("ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100);

    if (ids.length === 0) {
      return NextResponse.json({ sites: [] });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const scope = await resolveClientScope(adminDb, decoded);
    if (!scope) {
      return unauthorizedResponse("Client account is not linked to a valid client profile.", 403);
    }

    const refs = ids.map((id) => adminDb.collection("sites").doc(id));
    const snapshots = await adminDb.getAll(...refs);

    const sites = snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => {
        const data = snapshot.data() as Record<string, unknown>;
        return {
          id: snapshot.id,
          district:
            (typeof data.district === "string" && data.district) ||
            (typeof data.districtName === "string" && data.districtName) ||
            "",
          clientName: typeof data.clientName === "string" ? data.clientName : "",
          clientId: typeof data.clientId === "string" ? data.clientId : "",
        };
      })
      .filter((site) => matchesClientScope(site, scope))
      .map(({ id, district }) => ({ id, district }));

    return NextResponse.json({ sites }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load sites.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("access required") ? 403 : 500 },
    );
  }
}
