// GET /api/download/apk — Streams the reassembled APK from chunked parts
import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';

export const dynamic = 'force-dynamic';

const PARTS = ['ciss-workforce-v1.0.6.apk.partaa', 'ciss-workforce-v1.0.6.apk.partab'];

function getPartPath(part: string) {
  return `${process.cwd()}/public/releases/${part}`;
}

export async function GET() {
  let totalSize = 0;

  // Validate all parts exist
  for (const part of PARTS) {
    try {
      const s = await stat(getPartPath(part));
      totalSize += s.size;
    } catch {
      return NextResponse.json({ error: `Missing part: ${part}` }, { status: 500 });
    }
  }

  // Read and concatenate parts
  const chunks = await Promise.all(PARTS.map((part) => readFile(getPartPath(part))));
  const full = Buffer.concat(chunks);

  return new NextResponse(full, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="ciss-workforce-v1.0.6.apk"',
      'Content-Length': String(totalSize),
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
