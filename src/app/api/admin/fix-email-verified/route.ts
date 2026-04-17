import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
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
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
