import { NextRequest, NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebaseAdmin';
import { hashPin } from '@/lib/guard/pin-utils';

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber, otp, newPin } = await request.json();

    if (!phoneNumber || phoneNumber.length !== 10) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    if (!otp || otp.length !== 6) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }
    if (!newPin || newPin.length < 4 || newPin.length > 6) {
      return NextResponse.json({ error: 'PIN must be 4-6 digits' }, { status: 400 });
    }

    // Find the employee by phone
    const empSnap = await adminDb
      .collection('employees')
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    if (empSnap.empty) {
      return NextResponse.json({ error: 'Phone number not found' }, { status: 404 });
    }

    const employeeDoc = empSnap.docs[0];

    // Verify OTP — must match phone + otp and not be expired
    const otpSnap = await adminDb
      .collection('resetOtps')
      .where('phone', '==', phoneNumber)
      .where('otp', '==', otp)
      .limit(1)
      .get();

    if (otpSnap.empty) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const otpDoc = otpSnap.docs[0];
    const otpData = otpDoc.data();

    if (new Date(otpData.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'OTP expired. Please request a new one.' }, { status: 400 });
    }

    // Hash the new PIN the same way setup-pin does (SHA-256 via Web Crypto)
    const pinHash = await hashPin(newPin);

    // Update the PIN on the employees document (matches how setup-pin stores it)
    await employeeDoc.ref.update({
      guardPin: pinHash,
      guardFailedAttempts: 0,
      guardLockoutUntil: null,
    });

    // Consume the OTP so it cannot be reused
    await otpDoc.ref.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PIN reset error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
