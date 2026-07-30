import { NextResponse } from "next/server";
import {
  getAndroidRelease,
  resolveAndroidApkUrl,
} from "@/lib/android-release";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const release = await getAndroidRelease();
    const target = resolveAndroidApkUrl(release, new URL(request.url).origin);

    return NextResponse.redirect(target, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve Android download.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
