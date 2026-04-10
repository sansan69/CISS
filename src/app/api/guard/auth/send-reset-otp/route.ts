import { NextRequest, NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebaseAdmin';

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber } = await request.json();

    if (!phoneNumber || phoneNumber.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in Firestore using Admin SDK (expires in 10 minutes)
    await adminDb.collection('resetOtps').add({
      phone: phoneNumber,
      otp: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    // TODO: Send OTP via SMS (Twilio or Firebase Functions)
    // For now, log OTP in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`OTP for ${phoneNumber}: ${otp}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Send OTP error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}