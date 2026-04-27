import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit } from "@/lib/server/audit";
import { dedupeClientOptions } from "@/lib/client-options";
import { buildClientPortalUrl, slugifyPortalSubdomain } from "@/lib/client-portal";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const snapshot = await adminDb.collection("clients").orderBy("createdAt", "desc").limit(500).get();
    const clients = dedupeClientOptions(
      snapshot.docs.map((doc) => {
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
          portalSubdomain:
            typeof data.portalSubdomain === "string" ? data.portalSubdomain : "",
          portalEnabled: data.portalEnabled !== false,
          portalUrl: buildClientPortalUrl(
            typeof data.portalSubdomain === "string" ? data.portalSubdomain : "",
          ),
        };
      }),
    );

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
      portalSubdomain?: string;
      portalEnabled?: boolean;
      nationalHolidayList?: string[];
      uniformAllowanceMonthly?: number;
      fieldAllowanceMonthly?: number;
    };
    const name = body.name?.trim();
    const portalSubdomain = slugifyPortalSubdomain(body.portalSubdomain || name || "");

    if (!name) {
      return NextResponse.json({ error: "Client name is required." }, { status: 400 });
    }

    const existingPortal = await adminDb
      .collection("clients")
      .where("portalSubdomain", "==", portalSubdomain)
      .limit(1)
      .get();
    if (!existingPortal.empty) {
      return NextResponse.json(
        { error: "This client portal subdomain is already assigned." },
        { status: 409 },
      );
    }

    const docRef = await adminDb.collection("clients").add({
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
      ...buildServerCreateAudit({
        uid: adminUser.uid,
        email: adminUser.email,
      }),
    });

    return NextResponse.json({
      id: docRef.id,
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
