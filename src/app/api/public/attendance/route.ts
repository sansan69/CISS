import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { buildPublicAttendanceSiteOption } from "@/lib/attendance/public-attendance";

export async function GET() {
  try {
    // Fetch all sites that are active
    const sitesSnapshot = await db.collection('sites').get();

    const sites = sitesSnapshot.docs.map((doc) =>
      buildPublicAttendanceSiteOption(
        doc.id,
        doc.data() as Record<string, unknown>,
        'sites',
      ),
    );

    // Also fetch clientLocations
    const locationsSnapshot = await db.collection('clientLocations').get();

    const locations = locationsSnapshot.docs.map((doc) =>
      buildPublicAttendanceSiteOption(
        doc.id,
        doc.data() as Record<string, unknown>,
        'clientLocations',
      ),
    );

    // Combine and deduplicate by ID
    const allOptions = [...sites];
    locations.forEach(loc => {
      if (!allOptions.find(o => o.id === loc.id)) {
        allOptions.push(loc);
      }
    });

    return NextResponse.json({ options: allOptions });
  } catch (error) {
    console.error('Error loading duty centers:', error);
    return NextResponse.json(
      { error: 'Could not load duty centers.' },
      { status: 500 }
    );
  }
}
