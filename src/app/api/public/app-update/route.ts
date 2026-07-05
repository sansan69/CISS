import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
export const runtime = "nodejs";

type AppUpdateManifest = {
  platform: "android";
  packageName: string;
  latestVersionName: string;
  latestVersionCode: number;
  minimumSupportedVersionCode: number;
  apkPath: string;
  apkUrl?: string;
  sha256: string;
  sizeBytes: number;
  releaseDate: string;
  releaseNotes: string[];
  mandatory: boolean;
};

function absoluteUrl(request: Request, value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const origin = new URL(request.url).origin;
  return new URL(value, origin).toString();
}

export async function GET(request: Request) {
  try {
    const manifestPath = path.join(
      process.cwd(),
      "public",
      "downloads",
      "ciss-workforce-android.json",
    );
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as AppUpdateManifest;

    return NextResponse.json({
      ...manifest,
      apkUrl: absoluteUrl(request, manifest.apkUrl || manifest.apkPath),
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
