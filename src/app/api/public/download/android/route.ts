import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
export const runtime = "nodejs";

type AndroidManifest = {
  apkPath: string;
};

export async function GET(request: Request) {
  try {
    const manifestPath = path.join(
      process.cwd(),
      "public",
      "downloads",
      "ciss-workforce-android.json",
    );
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as AndroidManifest;
    const target = new URL(manifest.apkPath, new URL(request.url).origin);

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
