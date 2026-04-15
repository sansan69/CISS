import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { db: adminDb } = await import("@/lib/firebaseAdmin");

    const docSnap = await adminDb.collection("employees").doc(id).get();

    if (!docSnap.exists) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    const data = docSnap.data()!;

    const publicProfile = data.publicProfile as Record<string, unknown> | undefined;

    if (publicProfile && publicProfile.status === "Active") {
      return NextResponse.json({
        id: docSnap.id,
        fullName: publicProfile.fullName ?? data.fullName ?? "",
        employeeId: publicProfile.employeeId ?? data.employeeId ?? "",
        clientName: publicProfile.clientName ?? data.clientName ?? "",
        profilePictureUrl: publicProfile.profilePictureUrl ?? data.profilePictureUrl ?? "",
        status: publicProfile.status ?? data.status ?? "",
        qrCodeUrl: data.qrCodeUrl ?? "",
        joiningDate: data.joiningDate ?? null,
      });
    }

    return NextResponse.json({
      id: docSnap.id,
      fullName: data.fullName ?? "",
      employeeId: data.employeeId ?? "",
      clientName: data.clientName ?? "",
      profilePictureUrl: data.profilePictureUrl ?? "",
      status: data.status ?? "",
      qrCodeUrl: data.qrCodeUrl ?? "",
      joiningDate: data.joiningDate ?? null,
    });
  } catch (error) {
    console.error("Public profile fetch failed:", error);
    return NextResponse.json({ error: "Could not fetch profile." }, { status: 500 });
  }
}
