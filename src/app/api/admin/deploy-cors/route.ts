import { NextResponse } from "next/server";
import { storage } from "@/lib/firebaseAdmin";
import { readFileSync } from "fs";
import { resolve } from "path";

// Temporary open endpoint for one-time CORS deployment.
// Will be re-locked immediately after use.
export async function GET() {
  try {
    const corsPath = resolve(process.cwd(), "cors.json");
    const corsConfig = JSON.parse(readFileSync(corsPath, "utf8"));

    const bucket = storage.bucket();
    await bucket.setCorsConfiguration(corsConfig);

    const [current] = await bucket.getCorsConfiguration();

    return NextResponse.json({
      success: true,
      bucket: bucket.name,
      applied: current,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
