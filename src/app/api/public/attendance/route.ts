import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { buildPublicAttendanceSiteOption } from "@/lib/attendance/public-attendance";

export async function GET() {
  try {
    const [sitesSnapshot, clientLocSnapshot] = await Promise.all([
      db.collection('sites').get(),
      db.collection('clientLocations').get(),
    ]);

    const options = [
      ...sitesSnapshot.docs.map((doc) =>
        buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'sites'),
      ),
      ...clientLocSnapshot.docs.map((doc) =>
        buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'clientLocations'),
      ),
    ];

    return NextResponse.json({ options });
  } catch (error) {
    console.error('Error loading duty centers:', error);
    return NextResponse.json(
      { error: 'Could not load duty centers.' },
      { status: 500 }
    );
  }
}
