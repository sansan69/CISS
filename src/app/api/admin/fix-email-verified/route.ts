import { NextResponse } from "next/server";
import { requireSuperAdmin, unauthorizedResponse } from "@/lib/server/auth";
export const runtime = "nodejs";

// Bulk-verifying email addresses is an identity step (the Aadhaar administrator
// requires a verified email), so it is restricted to super-admin — not every
// admin. See the 2026-10-06 assessment H-9.
export async function POST(request: Request) {
  try {
    await requireSuperAdmin(request);
    const { auth: adminAuth } = await import("@/lib/firebaseAdmin");

    const listedUsers = await adminAuth.listUsers(1000);
    const fixed: string[] = [];
    const skipped: string[] = [];

    for (const user of listedUsers.users) {
      if (!user.email) continue;
      const isGuard = user.email.endsWith("@guard.cisskerala.app")
        || user.email.endsWith("@guard.KL.ciss-regional.app");
      if (isGuard) {
        skipped.push(user.email);
        continue;
      }
      if (!user.emailVerified) {
        await adminAuth.updateUser(user.uid, { emailVerified: true });
        fixed.push(user.email);
      }
    }

    return NextResponse.json({ fixed, fixedCount: fixed.length, skippedCount: skipped.length });
  } catch (error: any) {
    const message = error?.message || "Unauthorized";
    const status =
      message === "Super admin access required." ||
      message === "Admin access required."
        ? 403
        : 401;
    return unauthorizedResponse(message, status);
  }
}
