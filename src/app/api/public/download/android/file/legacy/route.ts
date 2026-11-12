import { getStoredAndroidApkUrl, redirectAndroidApk } from "@/lib/server/android-apk-storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    return redirectAndroidApk(await getStoredAndroidApkUrl("1.0.21"));
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export const HEAD = GET;
