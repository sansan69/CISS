import { NextResponse } from "next/server";

import { fetchEnrollmentConfig } from "@/lib/enrollment-config";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const config = await fetchEnrollmentConfig(adminDb);
    return NextResponse.json({ config });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load enrollment configuration.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
