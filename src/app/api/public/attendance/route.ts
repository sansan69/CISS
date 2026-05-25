import { NextResponse } from 'next/server';
import { db } from '@/lib/firebaseAdmin';
import { buildPublicAttendanceSiteOption } from "@/lib/attendance/public-attendance";

export async function GET() {
  try {
    const sitesSnapshot = await db.collection('sites').get();

    const sites = sitesSnapshot.docs.map((doc) =>
      buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'sites'),
    );

    return NextResponse.json({ options: sites });
  } catch (error) {
    console.error('Error loading duty centers:', error);
    return NextResponse.json(
      { error: 'Could not load duty centers.' },
      { status: 500 }
    );
  }
}
