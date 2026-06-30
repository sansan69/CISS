import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse } from "@/lib/server/auth";
import { REGION_CODE } from "@/lib/runtime-config";

export async function POST(request: Request) {
  try {
    const actor = await requireAdminLike(await (await import("@/lib/server/auth")).verifyRequestAuth(request));
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      officers: Array<{ name: string; email: string; password?: string; districts: string[] }>;
    };

    if (!Array.isArray(body.officers) || body.officers.length === 0) {
      return NextResponse.json({ error: "At least one field officer is required." }, { status: 400 });
    }

    const results: Array<{ email: string; uid?: string; error?: string }> = [];

    for (const officer of body.officers) {
      try {
        const user = await adminAuth.createUser({
          email: officer.email.trim(),
          password: officer.password ?? (crypto.randomUUID().slice(0, 16) + "Aa1!"),
          displayName: officer.name.trim(),
          emailVerified: true,
        });

        await adminAuth.setCustomUserClaims(user.uid, {
          role: "fieldOfficer",
          stateCode: REGION_CODE,
          assignedDistricts: officer.districts,
        });

        await adminDb.collection("fieldOfficers").add({
          uid: user.uid,
          email: officer.email.trim(),
          name: officer.name.trim(),
          stateCode: REGION_CODE,
          assignedDistricts: officer.districts,
        });

        results.push({ email: officer.email.trim(), uid: user.uid });
      } catch (error: any) {
        results.push({ email: officer.email.trim(), error: error.message });
      }
    }

    await adminDb.collection("regionSetupProgress").doc("default").set(
      { steps: { fieldOfficers: true } },
      { merge: true },
    );

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
