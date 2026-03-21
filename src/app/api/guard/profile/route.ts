import { NextResponse } from "next/server";
import { requireGuard } from "@/lib/server/guard-auth";
import { unauthorizedResponse } from "@/lib/server/auth";

export async function GET(request: Request) {
  try {
    const guard = await requireGuard(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const employeeDoc = await adminDb.collection("employees").doc(guard.employeeDocId).get();
    if (!employeeDoc.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const data = employeeDoc.data() ?? {};

    return NextResponse.json({
      employee: {
        id: employeeDoc.id,
        employeeId: data.employeeId ?? guard.employeeId,
        fullName: data.fullName ?? data.name ?? [data.firstName, data.lastName].filter(Boolean).join(" "),
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        phoneNumber: data.phoneNumber ?? "",
        emailAddress: data.emailAddress ?? "",
        clientName: data.clientName ?? "",
        district: data.district ?? "",
        resourceIdNumber: data.resourceIdNumber ?? "",
        joiningDate: data.joiningDate ?? "",
        status: data.status ?? "",
        profilePhotoUrl: data.profilePhotoUrl ?? null,
        address: data.address ?? "",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Internal server error.";
    if (msg.includes("Missing bearer token") || msg.includes("Guard access required")) {
      return unauthorizedResponse(msg);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
