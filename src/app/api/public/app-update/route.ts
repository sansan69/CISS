import { NextResponse } from "next/server";
import {
  getAndroidRelease,
  resolveAndroidApkUrl,
} from "@/lib/android-release";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const release = await getAndroidRelease();
    const publicOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;

    return NextResponse.json({
      ...release,
      apkUrl: resolveAndroidApkUrl(release, publicOrigin),
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
