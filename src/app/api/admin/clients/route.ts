import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit } from "@/lib/server/audit";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb.collection("clients").orderBy("createdAt", "desc").limit(500).get();
    const clients = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        name:
          typeof data.name === "string" && data.name.trim()
            ? data.name
            : typeof data.clientName === "string"
              ? data.clientName
              : "",
      };
    });

    return NextResponse.json({ clients });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      name?: string;
      nationalHolidayList?: string[];
      uniformAllowanceMonthly?: number;
      fieldAllowanceMonthly?: number;
    };
    const name = body.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }

    const docRef = await adminDb.collection("clients").add({
      name,
      nationalHolidayList: Array.isArray(body.nationalHolidayList)
        ? body.nationalHolidayList.filter(Boolean)
        : [],
      uniformAllowanceMonthly:
        typeof body.uniformAllowanceMonthly === "number"
          ? body.uniformAllowanceMonthly
          : 0,
      fieldAllowanceMonthly:
        typeof body.fieldAllowanceMonthly === "number"
          ? body.fieldAllowanceMonthly
          : 0,
      ...buildServerCreateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
    });

    return NextResponse.json({ id: docRef.id, name });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
