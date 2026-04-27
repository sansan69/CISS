import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (id === "demo") {
      return NextResponse.json({
        id: "demo",
        employeeId: "CISS/DEMO/2026-27/001",
        clientName: "TCS",
        firstName: "Anoop",
        lastName: "Kumar",
        fullName: "ANOOP KUMAR",
        dateOfBirth: "1997-05-14T00:00:00.000Z",
        gender: "Male",
        fatherName: "Raghavan",
        motherName: "Leela",
        maritalStatus: "Unmarried",
        district: "Ernakulam",
        educationalQualification: "Graduation",
        identityProofType: "Aadhaar Card",
        identityProofNumber: "1234 5678 9012",
        addressProofType: "Driving License",
        addressProofNumber: "KL07 20260012345",
        fullAddress: "Demo House, MG Road, Ernakulam, Kerala",
        emailAddress: "demo.guard@cisskerala.site",
        phoneNumber: "9999988888",
        profilePictureUrl: "",
        joiningDate: "2026-01-12T00:00:00.000Z",
        status: "Active",
        qrCodeUrl: "",
        createdAt: "2026-01-12T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
        publicProfile: {
          fullName: "ANOOP KUMAR",
          employeeId: "CISS/DEMO/2026-27/001",
          clientName: "TCS",
          profilePictureUrl: "",
          status: "Active",
        },
      });
    }

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
