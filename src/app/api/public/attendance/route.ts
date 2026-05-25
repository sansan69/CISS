import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { buildPublicAttendanceSiteOption } from "@/lib/attendance/public-attendance";

export async function GET() {
  try {
    const [sitesSnapshot, clientLocationsSnapshot] = await Promise.all([
      db.collection('sites').get(),
      db.collection('clientLocations').get(),
    ]);

    const sites = sitesSnapshot.docs.map((doc) =>
      buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'sites'),
    );
    const clientLocations = clientLocationsSnapshot.docs.map((doc) =>
      buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'clientLocations'),
    );

    return NextResponse.json({ options: [...sites, ...clientLocations] });
  } catch (error) {
    console.error('Error loading duty centers:', error);
    return NextResponse.json(
      { error: 'Could not load duty centers.' },
      { status: 500 }
    );
  }
}
