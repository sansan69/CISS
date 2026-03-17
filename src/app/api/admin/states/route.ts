import { NextResponse } from "next/server";
import { verifyRequestAuth, unauthorizedResponse } from "@/lib/server/auth";
import { isLegacyAdminEmail } from "@/lib/auth/admin";
import { FieldValue } from "firebase-admin/firestore";

function isAdmin(decoded: Record<string, unknown>) {
  return (
    decoded.admin === true ||
    decoded.role === "admin" ||
    (typeof decoded.email === "string" && isLegacyAdminEmail(decoded.email))
  );
}

function isSuperAdmin(decoded: Record<string, unknown>) {
  return decoded.role === "superAdmin";
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!isAdmin(decoded) && !isSuperAdmin(decoded)) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    // Try to get from dedicated states collection first
    const statesSnap = await adminDb.collection("states").get();
    if (!statesSnap.empty) {
      const states = statesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return NextResponse.json({ states });
    }

    // Fallback: derive unique stateCodes from employees collection
    const empSnap = await adminDb.collection("employees").select("stateCode").limit(500).get();
    const codes = new Set<string>();
    empSnap.docs.forEach((d) => {
      const code = d.data().stateCode;
      if (code) codes.add(code as string);
    });
    if (codes.size === 0) codes.add("KL"); // default

    const states = Array.from(codes).map((code) => ({ stateCode: code }));
    return NextResponse.json({ states });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    if (!isSuperAdmin(decoded)) {
      return NextResponse.json({ error: "Super admin access required." }, { status: 403 });
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = (await request.json()) as {
      stateCode?: string;
      stateName?: string;
      adminEmail?: string;
    };

    if (!body.stateCode || !body.stateName) {
      return NextResponse.json({ error: "stateCode and stateName are required." }, { status: 400 });
    }

    const docRef = await adminDb.collection("states").add({
      stateCode: body.stateCode.toUpperCase(),
      stateName: body.stateName,
      adminEmail: body.adminEmail ?? "",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: decoded.uid,
    });

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unauthorized";
    return unauthorizedResponse(msg);
  }
}
