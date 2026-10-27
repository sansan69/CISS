import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { normalizeText, serializeDate } from "@/lib/server/mobile-api-utils";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json();
    const type = normalizeText(body.type);
    const format = normalizeText(body.format || "csv");
    const startDate = body.startDate ? String(body.startDate) : null;
    const endDate = body.endDate ? String(body.endDate) : null;
    const clientId = body.clientId ? normalizeText(body.clientId) : null;

    if (!type) {
      return NextResponse.json(
        { error: "Export type is required." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // attendanceLogs and employees do not carry a `clientId` (only 154 of 1,961
    // employees do); their client dimension is `clientName`. Resolve the
    // selected client id to its name once and filter on the field that exists,
    // otherwise the export either returns nothing or throws FAILED_PRECONDITION
    // on the non-existent `date`/`clientId` composite.
    let clientName: string | null = null;
    if (clientId) {
      const clientSnap = await adminDb.collection("clients").doc(clientId).get();
      if (clientSnap.exists) {
        const client = clientSnap.data() as Record<string, unknown>;
        const rawName =
          (typeof client.name === "string" && client.name) ||
          (typeof client.clientName === "string" && client.clientName) ||
          "";
        clientName = normalizeText(rawName) || null;
      }
      if (!clientName) {
        return NextResponse.json(
          { error: "Client not found or has no name." },
          { status: 404 },
        );
      }
    }

    let data: Record<string, unknown>[] = [];

    if (type === "attendance") {
      let query: FirebaseFirestore.Query = adminDb
        .collection("attendanceLogs")
        .limit(1000);

      if (startDate) {
        const from = new Date(startDate);
        if (!Number.isNaN(from.getTime())) {
          query = query.where(
            "attendanceDate",
            ">=",
            from.toISOString().split("T")[0],
          );
        }
      }
      if (endDate) {
        const to = new Date(endDate);
        if (!Number.isNaN(to.getTime())) {
          query = query.where(
            "attendanceDate",
            "<=",
            to.toISOString().split("T")[0],
          );
        }
      }
      if (clientName) {
        query = query.where("clientName", "==", clientName);
      }

      const snapshot = await query.get();
      data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }));
    } else if (type === "employees") {
      let query: FirebaseFirestore.Query = adminDb
        .collection("employees")
        .limit(1000);

      if (clientName) {
        query = query.where("clientName", "==", clientName);
      }

      const snapshot = await query.get();
      data = snapshot.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          name: normalizeText(d.name || d.fullName),
          employeeId: normalizeText(d.employeeId || d.employeeCode),
          phoneNumber: normalizeText(d.phoneNumber),
          clientName: normalizeText(d.clientName),
          district: normalizeText(d.district),
          status: normalizeText(d.status),
          joiningDate: serializeDate(d.joiningDate),
        };
      });
    } else if (type === "sites") {
      let query: FirebaseFirestore.Query = adminDb
        .collection("sites")
        .limit(1000);

      if (clientId) {
        query = query.where("clientId", "==", clientId);
      }

      const snapshot = await query.get();
      data = snapshot.docs.map((doc) => {
        const d = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          name: normalizeText(d.name || d.siteName),
          clientName: normalizeText(d.clientName),
          district: normalizeText(d.district),
          status: normalizeText(d.status),
        };
      });
    } else {
      return NextResponse.json(
        { error: `Unsupported export type: ${type}. Supported: attendance, employees, sites` },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      type,
      format,
      count: data.length,
      data,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Admin access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[admin/data-export]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
