import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import { buildClientPortalUrl, slugifyPortalSubdomain } from "@/lib/client-portal";

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
      portalSubdomain?: string;
      portalEnabled?: boolean;
      nationalHolidayList?: string[];
      uniformAllowanceMonthly?: number;
      fieldAllowanceMonthly?: number;
      dashboardModules?: Record<string, boolean>;
    };
    const name = body.name?.trim();
    const portalSubdomain = slugifyPortalSubdomain(body.portalSubdomain || name || "");

    if (!name) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }

    const existingPortal = await adminDb
      .collection("clients")
      .where("portalSubdomain", "==", portalSubdomain)
      .limit(2)
      .get();
    const conflict = existingPortal.docs.find((doc) => doc.id !== id);
    if (conflict) {
      return NextResponse.json(
        { error: "This client portal subdomain is already assigned." },
        { status: 409 },
      );
    }

    const updateData: Record<string, unknown> = {
      name,
      portalSubdomain,
      portalEnabled: body.portalEnabled !== false,
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
    };

    if (body.dashboardModules && typeof body.dashboardModules === "object") {
      updateData.dashboardModules = body.dashboardModules;
    }

    await adminDb.collection("clients").doc(id).update(updateData);

    return NextResponse.json({
      id,
      name,
      portalSubdomain,
      portalEnabled: body.portalEnabled !== false,
      portalUrl: buildClientPortalUrl(portalSubdomain),
    });
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

    const sitesSnap = await adminDb
      .collection("sites")
      .where("clientId", "==", id)
      .limit(1)
      .get();

    const locationsSnap = await adminDb
      .collection("clientLocations")
      .where("clientId", "==", id)
      .limit(1)
      .get();

    const usersSnap = await adminDb
      .collection("clientUsers")
      .where("clientId", "==", id)
      .limit(1)
      .get();

    if (!sitesSnap.empty || !locationsSnap.empty || !usersSnap.empty) {
      const parts: string[] = [];
      if (!sitesSnap.empty) parts.push("sites");
      if (!locationsSnap.empty) parts.push("locations");
      if (!usersSnap.empty) parts.push("users");
      return NextResponse.json(
        {
          error: `Cannot delete client with existing ${parts.join(", ")}. Please remove them first.`,
        },
        { status: 409 }
      );
    }

    await adminDb.collection("clients").doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
