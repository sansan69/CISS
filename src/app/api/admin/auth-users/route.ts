import { NextResponse } from "next/server";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { auth: adminAuth } = await import("@/lib/firebaseAdmin");
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email")?.trim().toLowerCase();

    if (email) {
      try {
        const user = await adminAuth.getUserByEmail(email);
        return NextResponse.json({
          users: [
            {
              uid: user.uid,
              email: user.email,
              name: user.displayName,
              customClaims: user.customClaims || {},
            },
          ],
        });
      } catch (error: any) {
        if (error?.code === "auth/user-not-found") {
          return NextResponse.json({ users: [] });
        }
        throw error;
      }
    }

    const listedUsers = await adminAuth.listUsers(1000);

    return NextResponse.json({
      users: listedUsers.users.map((user) => ({
        uid: user.uid,
        email: user.email,
        name: user.displayName,
        customClaims: user.customClaims || {},
      })),
    });
  } catch (error: any) {
    const status = error?.message === "Admin access required." ? 403 : 401;
    return unauthorizedResponse(error?.message || "Unauthorized", status);
  }
}
