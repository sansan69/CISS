import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { storage } from "@/lib/firebaseAdmin";
import { readFileSync } from "fs";
import { resolve } from "path";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);

    const corsPath = resolve(process.cwd(), "cors.json");
    const corsConfig = JSON.parse(readFileSync(corsPath, "utf8"));

    const bucket = storage.bucket();
    await bucket.setCorsConfiguration(corsConfig);

    const [current] = await bucket.getCorsConfiguration();

    return NextResponse.json({
      success: true,
      applied: current,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
