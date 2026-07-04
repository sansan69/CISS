import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit, buildServerUpdateAudit, buildServerAuditEvent } from "@/lib/server/audit";
import { OPERATIONAL_CLIENT_NAME } from "@/lib/constants";
import { formatDateLabel, normalizeText, serializeDate, sortByDateDesc, toInt } from "@/lib/server/mobile-api-utils";

function normalizeWorkOrderDate(value: unknown) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return value;
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "200", 10), 500);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const snapshot = await adminDb.collection("workOrders").limit(limit).get();
    const workOrders = sortByDateDesc(
      snapshot.docs.map((doc) => {
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
      }),
      (row) => row.date,
    );

    return NextResponse.json({ workOrders });
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

    if ("date" in filtered) {
      filtered.date = normalizeWorkOrderDate(filtered.date);
    }

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided." },
        { status: 400 }
      );
    }

    filtered.clientName = OPERATIONAL_CLIENT_NAME;

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
