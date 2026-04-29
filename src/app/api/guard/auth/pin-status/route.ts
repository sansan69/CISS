import { normalizeGuardPhone } from "@/lib/guard/identity-utils";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { phoneNumber?: string; employeeId?: string };
    const phone = normalizeGuardPhone(String(body.phoneNumber || ""));
    const employeeId = String(body.employeeId || "").trim();

    if (!phone && !employeeId) {
      return NextResponse.json(
        { error: "Phone number or employee ID is required." },
        { status: 400 },
      );
    }

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    let snapshot;
    if (employeeId) {
      snapshot = await adminDb
        .collection("employees")
        .where("employeeId", "==", employeeId)
        .limit(1)
        .get();
    } else {
      snapshot = await adminDb
        .collection("employees")
        .where("phoneNumber", "==", phone)
        .limit(1)
        .get();
    }

    if (snapshot.empty) {
      return NextResponse.json({ found: false, hasPin: false });
    }

    const data = snapshot.docs[0].data();
    const hasPin = !!(data.guardPin && data.guardAuthUid);

    return NextResponse.json({
      found: true,
      hasPin,
      employeeName: data.name ?? data.fullName ?? "",
      employeeId: data.employeeId ?? "",
    });
  } catch (error: any) {
    console.error("PIN status check failed:", error);
    return NextResponse.json(
      { error: "Could not check PIN status." },
      { status: 500 },
    );
  }
}
