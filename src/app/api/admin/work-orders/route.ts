import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit, buildServerUpdateAudit, buildServerAuditEvent } from "@/lib/server/audit";

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = await request.json();
    const { workOrderId, data } = body as {
      workOrderId?: string;
      data?: Record<string, unknown>;
    };

    if (!workOrderId || !data) {
      return NextResponse.json(
        { error: "workOrderId and data are required." },
        { status: 400 }
      );
    }

    const validFields = [
      "siteId",
      "siteName",
      "clientName",
      "district",
      "date",
      "maleGuardsRequired",
      "femaleGuardsRequired",
      "totalManpower",
      "assignedGuards",
      "importHistory",
    ];

    const filtered: Record<string, unknown> = {};
    for (const key of validFields) {
      if (key in data) {
        filtered[key] = data[key];
      }
    }

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided." },
        { status: 400 }
      );
    }

    const ref = adminDb.collection("workOrders").doc(workOrderId);
    const existing = await ref.get();

    if (existing.exists) {
      const existingData = existing.data() as Record<string, unknown>;
      const mergeData: Record<string, unknown> = {
        ...filtered,
        assignedGuards: filtered.assignedGuards ?? existingData.assignedGuards ?? [],
        createdAt: existingData.createdAt || new Date(),
        ...buildServerUpdateAudit({
          uid: adminUser.uid,
          email: adminUser.email,
        }),
      };

      if (Array.isArray(filtered.importHistory) || Array.isArray(existingData.importHistory)) {
        const history = [
          ...(Array.isArray(existingData.importHistory) ? existingData.importHistory : []),
          ...(Array.isArray(filtered.importHistory) ? filtered.importHistory : []),
        ];
        mergeData.importHistory = history;
      }

      await ref.set(mergeData, { merge: true });
    } else {
      await ref.set({
        ...filtered,
        ...buildServerCreateAudit({
          uid: adminUser.uid,
          email: adminUser.email,
        }),
      });
    }

    return NextResponse.json({ id: workOrderId });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    if (error?.message?.includes("Missing bearer") || error?.message?.includes("token")) {
      return unauthorizedResponse(error.message, 401);
    }
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
