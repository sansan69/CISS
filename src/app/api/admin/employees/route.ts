import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { normalizeText } from "@/lib/server/mobile-api-utils";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const status = searchParams.get("status") || "Active";
    const limit = Math.min(parseInt(searchParams.get("limit") || "200", 10), 500);

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    let query: FirebaseFirestore.Query = adminDb.collection("employees").limit(limit);

    if (status) {
      query = query.where("status", "==", status);
    }
    if (clientId) query = query.where("clientId", "==", clientId);

    const snapshot = await query.get();
    const employees = snapshot.docs
      .map((doc) => {
        const data = doc.data() as {
          name?: string;
          firstName?: string;
          lastName?: string;
          employeeCode?: string;
          employeeId?: string;
          guardId?: string;
          clientId?: string;
          clientName?: string;
          district?: string;
          status?: string;
          phoneNumber?: string;
          mobileNumber?: string;
          phone?: string;
          siteName?: string;
          assignedSiteName?: string;
        };

        const fullName =
          normalizeText(data.name) ||
          normalizeText([data.firstName, data.lastName].filter(Boolean).join(" ")) ||
          "Unnamed employee";
        const employeeId = normalizeText(data.employeeId || data.employeeCode || data.guardId || doc.id);

        return {
          id: doc.id,
          name: fullName,
          fullName,
          employeeId,
          employeeCode: normalizeText(data.employeeCode || data.guardId || data.employeeId),
          phoneNumber: normalizeText(data.phoneNumber || data.mobileNumber || data.phone),
          clientId: normalizeText(data.clientId),
          clientName: normalizeText(data.clientName),
          district: normalizeText(data.district),
          siteName: normalizeText(data.siteName || data.assignedSiteName),
          status: normalizeText(data.status),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ employees });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
