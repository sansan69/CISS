import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerUpdateAudit } from "@/lib/server/audit";
import { buildClientPortalUrl, slugifyPortalSubdomain } from "@/lib/client-portal";
import { resolvePatrolSettings } from "@/lib/patrol";
export const runtime = "nodejs";

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
      patrolSettings?: Record<string, unknown>;
    };
    const existingDoc = await adminDb.collection("clients").doc(id).get();
    if (!existingDoc.exists) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    const existing = existingDoc.data() as Record<string, unknown>;
    const currentName = typeof existing.name === "string" ? existing.name : "";
    const name = body.name === undefined ? currentName : body.name.trim();

    if (!name) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }

    const hasPortalSubdomain = Object.prototype.hasOwnProperty.call(body, "portalSubdomain");
    const currentPortalSubdomain =
      typeof existing.portalSubdomain === "string" && existing.portalSubdomain
        ? existing.portalSubdomain
        : slugifyPortalSubdomain(name);
    const portalSubdomain = hasPortalSubdomain
      ? slugifyPortalSubdomain(body.portalSubdomain || "")
      : currentPortalSubdomain;

    if (!portalSubdomain) {
      return NextResponse.json({ error: "Client portal subdomain is required." }, { status: 400 });
    }

    if (portalSubdomain !== currentPortalSubdomain) {
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
    }

    const updateData: Record<string, unknown> = {
      name,
      portalSubdomain,
      ...buildServerUpdateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
    };

    if (typeof body.portalEnabled === "boolean") {
      updateData.portalEnabled = body.portalEnabled;
    }
    if (Array.isArray(body.nationalHolidayList)) {
      updateData.nationalHolidayList = body.nationalHolidayList.filter(Boolean);
    }
    if (typeof body.uniformAllowanceMonthly === "number") {
      updateData.uniformAllowanceMonthly = body.uniformAllowanceMonthly;
    }
    if (typeof body.fieldAllowanceMonthly === "number") {
      updateData.fieldAllowanceMonthly = body.fieldAllowanceMonthly;
    }

    if (body.dashboardModules && typeof body.dashboardModules === "object") {
      updateData.dashboardModules = body.dashboardModules;
    }
    if (body.patrolSettings && typeof body.patrolSettings === "object") {
      updateData.patrolSettings = resolvePatrolSettings(body.patrolSettings);
    }

    await adminDb.collection("clients").doc(id).update(updateData);

    return NextResponse.json({
      id,
      name,
      portalSubdomain,
      portalEnabled:
        typeof body.portalEnabled === "boolean"
          ? body.portalEnabled
          : existing.portalEnabled !== false,
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

    const [
      sitesSnap,
      locationsSnap,
      usersSnap,
      employeesSnap,
      workOrdersSnap,
      trainingAssignmentsSnap,
      wageConfigSnap,
    ] = await Promise.all([
      adminDb.collection("sites").where("clientId", "==", id).limit(1).get(),
      adminDb.collection("clientLocations").where("clientId", "==", id).limit(1).get(),
      adminDb.collection("clientUsers").where("clientId", "==", id).limit(1).get(),
      adminDb.collection("employees").where("clientId", "==", id).limit(1).get(),
      adminDb.collection("workOrders").where("clientId", "==", id).limit(1).get(),
      adminDb.collection("trainingAssignments").where("clientId", "==", id).limit(1).get(),
      adminDb.collection("clientWageConfig").doc(id).get(),
    ]);

    if (
      !sitesSnap.empty ||
      !locationsSnap.empty ||
      !usersSnap.empty ||
      !employeesSnap.empty ||
      !workOrdersSnap.empty ||
      !trainingAssignmentsSnap.empty ||
      wageConfigSnap.exists
    ) {
      const parts: string[] = [];
      if (!sitesSnap.empty) parts.push("sites");
      if (!locationsSnap.empty) parts.push("locations");
      if (!usersSnap.empty) parts.push("users");
      if (!employeesSnap.empty) parts.push("employees");
      if (!workOrdersSnap.empty) parts.push("work orders");
      if (!trainingAssignmentsSnap.empty) parts.push("training assignments");
      if (wageConfigSnap.exists) parts.push("wage configuration");
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
