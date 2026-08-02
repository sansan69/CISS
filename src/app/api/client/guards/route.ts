import { NextResponse } from "next/server";

import { hasClientAccess, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";
import { normalizeText } from "@/lib/server/mobile-api-utils";
import { serializeGuardProfileView } from "@/lib/server/guard-profile-view";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasClientAccess(decoded)) {
      return unauthorizedResponse("Client access required.", 403);
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "300", 10), 500);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const scope = await resolveClientScope(adminDb, decoded);
    if (!scope) {
      return unauthorizedResponse("Client account is not linked to a valid client profile.", 403);
    }

    const snapshots = await Promise.all([
      adminDb.collection("employees").where("clientName", "==", scope.clientName).limit(limit).get(),
      scope.clientId
        ? adminDb.collection("employees").where("clientId", "==", scope.clientId).limit(limit).get()
        : Promise.resolve({ docs: [] } as { docs: FirebaseFirestore.QueryDocumentSnapshot[] }),
    ]);

    const docsById = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        docsById.set(doc.id, doc);
      }
    }

    const guards = Array.from(docsById.values())
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const profile = serializeGuardProfileView(doc.id, data);
        return {
          ...profile,
          clientId: normalizeText(data.clientId),
          clientName: normalizeText(data.clientName),
          district: normalizeText(data.district) || profile.district,
        };
      })
      .filter((guard) => matchesClientScope(guard, scope))
      .sort((left, right) => left.fullName.localeCompare(right.fullName))
      .slice(0, limit);

    return NextResponse.json({ guards }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load guards.";
    return NextResponse.json({ error: message }, { status: message.includes("access required") ? 403 : 500 });
  }
}
