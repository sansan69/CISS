import { NextRequest, NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebaseAdmin';

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber } = await request.json();

    if (!phoneNumber || phoneNumber.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    // Rate limiting: max 3 OTP requests per phone per 10 minutes
    const rateLimitRef = adminDb.doc(`rateLimits/otp_${phoneNumber}`);
    const rateLimitSnap = await rateLimitRef.get();
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;

    if (rateLimitSnap.exists) {
      const data = rateLimitSnap.data()!;
      const windowStart: number = data.windowStart ?? 0;
      const attempts: number = data.attempts ?? 0;

      if (now - windowStart < windowMs && attempts >= 3) {
        return NextResponse.json(
          { error: 'Too many OTP requests. Please wait 10 minutes.' },
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

    // Verify the phone belongs to a registered employee before sending OTP
    const empSnap = await adminDb
      .collection('employees')
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (empSnap.empty) {
      // Return success to avoid phone enumeration
      return NextResponse.json({ success: true });
    }

    const empData = empSnap.docs[0].data();
    if (!empData.guardAuthUid) {
      // Guard hasn't set up PIN yet — can't reset what doesn't exist
      return NextResponse.json({ error: 'No PIN set up for this number.' }, { status: 400 });
    }

    // Delete any previous unused OTPs for this phone
    const oldOtps = await adminDb
      .collection('resetOtps')
      .where('phone', '==', phoneNumber)
      .get();
    const batch = adminDb.batch();
    oldOtps.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await adminDb.collection('resetOtps').add({
      phone: phoneNumber,
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    // TODO: Send OTP via SMS provider (e.g. Twilio, MSG91)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV] OTP for ${phoneNumber}: ${otp}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Send OTP error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
