import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";

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
    if (clientId) {
      query = query.where("clientName", "==", clientId);
    }

    const snapshot = await query.get();
    const employees = snapshot.docs
      .map((doc) => {
        const data = doc.data() as {
          name?: string;
          firstName?: string;
          lastName?: string;
          employeeCode?: string;
          guardId?: string;
          clientId?: string;
          clientName?: string;
          district?: string;
          status?: string;
        };

        return {
          id: doc.id,
          name:
            data.name ||
            [data.firstName, data.lastName].filter(Boolean).join(" ") ||
            "Unnamed employee",
          employeeCode: data.employeeCode || data.guardId || "",
          clientId: data.clientId || "",
          clientName: data.clientName || "",
          district: data.district || "",
          status: data.status || "",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ employees });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
