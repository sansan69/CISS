import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);

    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const empDoc = await adminDb.doc(`employees/${guard.employeeDocId}`).get();
    if (!empDoc.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }
    const empData = empDoc.data()!;

    let joiningDate: string | undefined;
    if (empData.joiningDate) {
      if (empData.joiningDate.toDate) {
        joiningDate = empData.joiningDate.toDate().toISOString();
      } else if (typeof empData.joiningDate === "string") {
        joiningDate = empData.joiningDate;
      }
    }

    return NextResponse.json({
      fullName: empData.fullName ?? empData.name ?? "",
      employeeId: guard.employeeId,
      clientName: empData.clientName ?? "",
      district: empData.district ?? "",
      phoneNumber: empData.phoneNumber ?? "",
      status: empData.status ?? "",
      gender: empData.gender ?? null,
      joiningDate: joiningDate ?? null,
      resourceIdNumber: empData.resourceIdNumber ?? null,
      profilePhotoUrl: empData.profilePhotoUrl ?? empData.profilePictureUrl ?? null,
      address: empData.fullAddress ?? empData.address ?? null,
      emailAddress: empData.emailAddress ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (
      msg.includes("Missing bearer token") ||
      msg.includes("Guard access required")
    ) {
      return unauthorizedResponse(msg);
    }
    console.error("[guard/profile]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
