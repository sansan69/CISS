import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireAdminLike, unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { REGION_CODE } from "@/lib/runtime-config";

export async function POST(request: Request) {
  try {
    const actor = await requireAdminLike(await verifyRequestAuth(request));
    const { auth: adminAuth, db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      officers: Array<{ name: string; email: string; password?: string; districts: string[] }>;
    };

    if (!Array.isArray(body.officers) || body.officers.length === 0) {
      return NextResponse.json({ error: "At least one field officer is required." }, { status: 400 });
    }

    const results: Array<{ email: string; uid?: string; error?: string }> = [];
    const districtSnap = await adminDb.collection("districts").where("active", "==", true).get();
    const activeDistricts = districtSnap.docs
      .map((doc) => {
        const data = doc.data() as { name?: unknown };
        return typeof data.name === "string" ? data.name : "";
      })
      .filter(Boolean);

    for (const officer of body.officers) {
      try {
        const assignedDistricts =
          Array.isArray(officer.districts) && officer.districts.length > 0
            ? officer.districts.map((district) => district.trim()).filter(Boolean)
            : activeDistricts;

        if (assignedDistricts.length === 0) {
          throw new Error("Assign at least one district before creating a field officer.");
        }

        const user = await adminAuth.createUser({
          email: officer.email.trim(),
          password: officer.password ?? (crypto.randomUUID().slice(0, 16) + "Aa1!"),
          displayName: officer.name.trim(),
          emailVerified: true,
        });

        await adminAuth.setCustomUserClaims(user.uid, {
          role: "fieldOfficer",
          stateCode: REGION_CODE,
          assignedDistricts,
        });

        await adminDb.collection("fieldOfficers").add({
          uid: user.uid,
          email: officer.email.trim(),
          name: officer.name.trim(),
          stateCode: REGION_CODE,
          assignedDistricts,
        });

        results.push({ email: officer.email.trim(), uid: user.uid });
      } catch (error: any) {
        results.push({ email: officer.email.trim(), error: error.message });
      }
    }

    await adminDb.collection("regionSetupProgress").doc("default").set(
      { steps: { fieldOfficers: results.some((result) => result.uid) }, currentStep: 5 },
      { merge: true },
    );

    const createdCount = results.filter((result) => result.uid).length;
    if (createdCount === 0) {
      return NextResponse.json(
        { success: false, results, error: "No field officers were created." },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return unauthorizedResponse(error?.message || "Unauthorized");
  }
}
