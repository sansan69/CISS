import { getAndroidRelease } from "@/lib/android-release";
import { getStoredAndroidApkUrl, redirectAndroidApk } from "@/lib/server/android-apk-storage";

export const runtime = "nodejs";

export async function GET() {
  const release = await getAndroidRelease();
  const version = release.latestVersionName;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return new Response(null, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return redirectAndroidApk(await getStoredAndroidApkUrl(version));
  } catch {
    return redirectAndroidApk(
      `https://github.com/sansan69/CISS-Mobile/releases/download/v${version}/app-release.apk`,
    );
  }
}

export const HEAD = GET;
