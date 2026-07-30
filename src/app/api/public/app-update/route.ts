import { NextResponse } from "next/server";
import {
  getAndroidRelease,
  resolveAndroidApkUrl,
} from "@/lib/android-release";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const release = await getAndroidRelease();

    return NextResponse.json({
      ...release,
      apkUrl: resolveAndroidApkUrl(release, new URL(request.url).origin),
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read Android update manifest.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
