import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { buildPublicAttendanceSiteOption } from "@/lib/attendance/public-attendance";

export async function GET() {
  try {
    const [sitesSnapshot, locationsSnapshot] = await Promise.all([
      db.collection('sites').get(),
      db.collection('clientLocations').get(),
    ]);

    const siteDocs = sitesSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
    const locationDocs = locationsSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));

    const sites = siteDocs.map((doc) =>
      buildPublicAttendanceSiteOption(doc.id, doc.data, 'sites'),
    );

    const locations = locationDocs.map((doc) =>
      buildPublicAttendanceSiteOption(doc.id, doc.data, 'clientLocations'),
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
