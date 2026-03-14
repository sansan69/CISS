import { NextRequest, NextResponse } from 'next/server';

// Simple server-side geocoding proxy so that the API key is never exposed to the browser.
// Configure one of the supported providers via environment variables.
// Recommended: OpenCage (https://opencagedata.com/)
//
// Set:
//   OPENCAGE_API_KEY=<your_key>
//
// This route expects JSON: { address: string }
// and responds with: { lat: number; lng: number } or 400/500 on error.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { address?: string } | null;
    const address = body?.address?.trim();

    if (!address) {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    }

    const apiKey = process.env.OPENCAGE_API_KEY?.trim().replace(/^['"]|['"]$/g, '');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Geocoding API key is not configured. Please set OPENCAGE_API_KEY in your environment.' },
        { status: 500 },
      );
    }

    const url = new URL('https://api.opencagedata.com/geocode/v1/json');
    url.searchParams.set('q', address);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('limit', '1');
    url.searchParams.set('no_annotations', '1');

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text();
      let providerMessage = text || res.statusText;
      try {
        const parsed = JSON.parse(text) as { status?: { message?: string } };
        providerMessage = parsed?.status?.message || providerMessage;
      } catch {
        // Keep the raw provider response if it is not JSON.
      }
      return NextResponse.json(
        { error: `Geocoding provider error (${res.status}): ${providerMessage}` },
        { status: 502 },
      );
    }

    const data = await res.json() as any;
    const first = data?.results?.[0];
    const lat = first?.geometry?.lat;
    const lng = first?.geometry?.lng;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json(
        { error: 'No coordinates found for the given address.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ lat, lng });
  } catch (e: any) {
    console.error('Geocode API error', e);
    return NextResponse.json(
      { error: e?.message || 'Unexpected server error while geocoding.' },
      { status: 500 },
    );
  }
}

