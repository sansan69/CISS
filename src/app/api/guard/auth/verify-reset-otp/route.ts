import { NextRequest, NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebaseAdmin';

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber, otp } = await request.json();

    if (!phoneNumber || phoneNumber.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    if (!otp || otp.length !== 6) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const otpSnap = await adminDb
      .collection('resetOtps')
      .where('phone', '==', phoneNumber)
      .where('otp', '==', otp)
      .limit(1)
      .get();

    if (otpSnap.empty) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const otpData = otpSnap.docs[0].data();
    if (new Date(otpData.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'OTP expired. Please request a new one.' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
