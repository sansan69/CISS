import { NextRequest, NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebaseAdmin';
import { verifyOtp } from '@/lib/guard/otp-utils';

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber, otp } = await request.json();

    if (!phoneNumber || phoneNumber.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    if (!otp || otp.length !== 6) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    // Rate limiting: max 5 verification attempts per phone per 10 minutes
    const rateLimitRef = adminDb.doc(`rateLimits/verify_otp_${phoneNumber}`);
    const rateLimitSnap = await rateLimitRef.get();
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;

    if (rateLimitSnap.exists) {
      const data = rateLimitSnap.data()!;
      const windowStart: number = data.windowStart ?? 0;
      const attempts: number = data.attempts ?? 0;

      if (now - windowStart < windowMs && attempts >= 5) {
        return NextResponse.json(
          { error: 'Too many OTP attempts. Please wait 10 minutes.' },
          { status: 429 }
        );
      }

      if (now - windowStart >= windowMs) {
        await rateLimitRef.set({ windowStart: now, attempts: 1 });
      } else {
        const { FieldValue } = await import('firebase-admin/firestore');
        await rateLimitRef.update({ attempts: FieldValue.increment(1) });
      }
    } else {
      await rateLimitRef.set({ windowStart: now, attempts: 1 });
    }

    const otpSnap = await adminDb
      .collection('resetOtps')
      .where('phone', '==', phoneNumber)
      .limit(1)
      .get();

    if (otpSnap.empty) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const otpDoc = otpSnap.docs[0];
    const otpData = otpDoc.data();

    if (new Date(otpData.expiresAt) < new Date()) {
      await otpDoc.ref.delete();
      return NextResponse.json({ error: 'OTP expired. Please request a new one.' }, { status: 400 });
    }

    const isValid = await verifyOtp(otp, otpData.otpHash as string | undefined, otpData.otp as string | undefined);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
