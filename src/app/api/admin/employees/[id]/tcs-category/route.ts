import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminAccess, verifyRequestAuth } from "@/lib/server/auth";
import { parseTcsCategory } from "@/lib/tcs-category";

export const runtime = "nodejs";
const categoryBody = z.object({ tcsCategory: z.enum(["adhoc", "permanent"]) }).strict();
const invalidSessionCodes = new Set([
  "auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired",
  "auth/id-token-revoked", "auth/user-disabled", "auth/user-not-found",
]);
type CategoryErrorCode = "invalid_session" | "wrong_role" | "invalid_body" |
  "employee_not_found" | "not_tcs" | "wrong_scope" | "internal_error";

function categoryError(error: string, code: CategoryErrorCode, status: number) {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store, private" } });
}

function isInvalidSession(error: unknown) {
  if (error instanceof Error && error.message === "Missing bearer token.") return true;
  return typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" && invalidSessionCodes.has(error.code);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await verifyRequestAuth(request, true);
  } catch (error) {
    if (isInvalidSession(error)) return categoryError("Authentication required.", "invalid_session", 401);
    console.error("[admin/employees/tcs-category] Authentication infrastructure failure.");
    return categoryError("Could not update TCS category.", "internal_error", 500);
  }
  if (!hasAdminAccess(actor)) {
    return categoryError("Admin access required.", "wrong_role", 403);
  }
  try {
    const { id } = await params;
    if (!id || id.trim() !== id || id.includes("/") || id === "." || id === "..") {
      return categoryError("Employee document ID is required.", "invalid_body", 400);
    }
    const parsed = categoryBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return categoryError("Select Adhoc or Permanent only.", "invalid_body", 400);
    }
    const { db } = await import("@/lib/firebaseAdmin");
    const ref = db.collection("employees").doc(id);
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return { status: 404, error: "Employee not found.", code: "employee_not_found" as const };
      const employee = snapshot.data()!;
      if (actor.role !== "superAdmin" && actor.stateCode && employee.stateCode && employee.stateCode !== actor.stateCode) {
        return { status: 403, error: "This employee is outside your state.", code: "wrong_scope" as const };
      }
      if (!parseTcsCategory(employee.clientName, parsed.data.tcsCategory)) {
        return { status: 400, error: "TCS category is available only for TCS employees.", code: "not_tcs" as const };
      }
      transaction.update(ref, {
        tcsCategory: parsed.data.tcsCategory,
        tcsCategoryUpdatedAt: new Date(),
        tcsCategoryUpdatedBy: actor.uid,
      });
      return { status: 200 };
    });
    if (result.error) return categoryError(result.error, result.code, result.status);
    return NextResponse.json({ success: true, tcsCategory: parsed.data.tcsCategory }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    console.error("[admin/employees/tcs-category] Internal failure.");
    return categoryError("Could not update TCS category.", "internal_error", 500);
  }
}
