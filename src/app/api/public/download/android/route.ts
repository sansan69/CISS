import { NextResponse } from "next/server";
import { getAndroidRelease } from "@/lib/android-release";

export const runtime = "nodejs";

export async function GET() {
  try {
    const release = await getAndroidRelease();
    // A relative Location keeps downloads on the browser's host when the
    // hosting proxy supplies an internal origin to the Next.js server.
    return new NextResponse(null, {
      status: 307,
      headers: {
        Location: release.apkUrl || release.apkPath,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve Android download.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
