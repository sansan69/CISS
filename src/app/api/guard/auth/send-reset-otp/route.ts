import { NextResponse } from "next/server";

export async function POST() {
  try {
    return NextResponse.json(
      { error: "OTP-based PIN reset has been removed. Use the new Forgot PIN flow." },
      { status: 410 },
    );
  } catch {
    return NextResponse.json(
      { error: "OTP-based PIN reset has been removed. Use the new Forgot PIN flow." },
      { status: 410 },
    );
  }
}
