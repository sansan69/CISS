import { NextResponse } from "next/server";
import {
  hasAdminAccess,
  hasClientAccess,
  hasFieldOfficerAccess,
  unauthorizedResponse,
  verifyRequestAuth,
} from "@/lib/server/auth";
import { findEmployeeById } from "@/lib/server/employee-document-access";
import { assertGuardProfileScope, serializeGuardProfileView } from "@/lib/server/guard-profile-view";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const decoded = await verifyRequestAuth(request);
    const isReadOnlyStaff = ["hr", "accounts", "compliance"].includes(decoded.role || "");
    if (!hasAdminAccess(decoded) && !hasFieldOfficerAccess(decoded) && !hasClientAccess(decoded) && !isReadOnlyStaff) {
      return unauthorizedResponse("Guard profile access required.", 403);
    }

    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const employeeSnap = await findEmployeeById(adminDb, id);
    if (!employeeSnap?.exists) {
      return NextResponse.json({ error: "Guard profile not found." }, { status: 404 });
    }

    const data = employeeSnap.data() as Record<string, unknown>;
    await assertGuardProfileScope(adminDb, decoded, data);

    const profile = serializeGuardProfileView(employeeSnap.id, data);
    return NextResponse.json({ profile }, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load guard profile.";
    return NextResponse.json({ error: message }, {
      status: message.includes("access") || message.includes("scope") || message.includes("districts") ? 403 : 500,
    });
  }
}
