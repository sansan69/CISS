import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { buildPublicAttendanceEmployee } from "@/lib/attendance/public-attendance";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const employeeId = request.nextUrl.searchParams.get("employeeId")?.trim() || "";

    if (!employeeId) {
      return NextResponse.json(
        { error: "employeeId is required.", found: false },
        { status: 400 },
      );
    }

    const snapshot = await db
      .collection("employees")
      .where("employeeId", "==", employeeId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json({ found: false, employee: null });
    }

    const doc = snapshot.docs[0];
    const employee = buildPublicAttendanceEmployee(
      doc.id,
      doc.data() as Record<string, unknown>,
    );

    return NextResponse.json({ found: true, employee });
  } catch (error) {
    console.error("[public/attendance/employee]", error);
    return NextResponse.json(
      { error: "Could not verify employee ID.", found: false },
      { status: 500 },
    );
  }
}
