import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
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

    await adminDb.collection("clients").doc(id).update({
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
      ...buildServerUpdateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
    });

    return NextResponse.json({ id, name });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const { id } = await params;
    await adminDb.collection("clients").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
