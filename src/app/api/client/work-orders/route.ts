import { NextResponse } from "next/server";

import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { isOperationalWorkOrderClientName } from "@/lib/work-orders";
import { hasClientAccess, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { matchesClientScope, resolveClientScope } from "@/lib/server/client-access";
import { formatDateLabel, normalizeText, serializeDate, sortByDateDesc, toInt } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!hasClientAccess(decoded)) {
      return unauthorizedResponse("Client access required.", 403);
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "120", 10), 250);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const scope = await resolveClientScope(adminDb, decoded);
    if (!scope) {
      return unauthorizedResponse("Client account is not linked to a valid client profile.", 403);
    }

    const isOperationalClient = isOperationalWorkOrderClientName(scope.clientName);
    const snapshots = await Promise.all([
      adminDb.collection("workOrders").where("clientName", "==", scope.clientName).limit(limit).get(),
      scope.clientId
        ? adminDb.collection("workOrders").where("clientId", "==", scope.clientId).limit(limit).get()
        : Promise.resolve({ docs: [] } as { docs: FirebaseFirestore.QueryDocumentSnapshot[] }),
      isOperationalClient
        ? adminDb.collection("workOrders").where("clientName", "==", OPERATIONAL_CLIENT_NAME).limit(limit).get()
        : Promise.resolve({ docs: [] } as { docs: FirebaseFirestore.QueryDocumentSnapshot[] }),
    ]);

    const docsById = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        docsById.set(doc.id, doc);
      }
    }

    const workOrders = sortByDateDesc(
      Array.from(docsById.values())
        .map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          const assignedGuards = Array.isArray(data.assignedGuards) ? data.assignedGuards : [];
          const totalManpower =
            toInt(data.totalManpower) ||
            toInt(data.maleGuardsRequired) + toInt(data.femaleGuardsRequired);
          return {
            id: doc.id,
            workOrderId: doc.id,
            clientId: normalizeText(data.clientId),
            clientName: normalizeText(data.clientName),
            siteClientName: normalizeText(data.siteClientName || data.clientName),
            siteId: normalizeText(data.siteId),
            siteName: normalizeText(data.siteName || "Site"),
            district: normalizeText(data.district),
            date: serializeDate(data.date),
            dateLabel: formatDateLabel(data.date),
            assignedCount: assignedGuards.length,
            totalManpower,
            maleGuardsRequired: toInt(data.maleGuardsRequired),
            femaleGuardsRequired: toInt(data.femaleGuardsRequired),
          };
        })
        .filter((row) => matchesClientScope(row, scope) || (isOperationalClient && row.clientName === OPERATIONAL_CLIENT_NAME)),
      (row) => row.date,
    ).slice(0, limit);

    return NextResponse.json({ workOrders });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load work orders.";
    return NextResponse.json({ error: message }, { status: message.includes("access required") ? 403 : 500 });
  }
}
