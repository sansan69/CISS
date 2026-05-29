// GET /api/download/apk — Streams the reassembled APK from chunked parts
import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';

export const dynamic = 'force-dynamic';

const PARTS = ['ciss-workforce-v1.0.6.apk.partaa', 'ciss-workforce-v1.0.6.apk.partab']; 

export async function GET() {
  const chunks: Buffer[] = [];
  
  for (const part of PARTS) {
    const partPath = `${process.cwd()}/public/releases/${part}`;
    try {
      const data = await readFile(partPath);
      chunks.push(data);
    } catch {
      return NextResponse.json({ error: `Missing part: ${part}` }, { status: 500 });
    }
  }
  
  const full = Buffer.concat(chunks);
  
  return new NextResponse(full, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="ciss-workforce-v1.0.6.apk"',
      'Content-Length': String(full.length),
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
