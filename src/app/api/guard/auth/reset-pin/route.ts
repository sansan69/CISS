import { NextRequest, NextResponse } from 'next/server';
import { db as adminDb } from '@/lib/firebaseAdmin';

export async function POST(request: NextRequest) {
  try {
    const { phoneNumber, otp, newPin } = await request.json();

    // Validate inputs
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
    const employeesRef = adminDb.collection('employees');
    const empQuery = employeesRef.where('phoneNumber', '==', phoneNumber);
    const empSnap = await empQuery.get();

    if (empSnap.empty) {
      return NextResponse.json({ error: 'Phone number not found' }, { status: 404 });
    }

    const employeeDoc = empSnap.docs[0];
    const employeeId = employeeDoc.id;

    // Verify OTP
    const otpRef = adminDb.collection('resetOtps');
    const otpQuery = otpRef.where('phone', '==', phoneNumber).where('otp', '==', otp);
    const otpSnap = await otpQuery.get();

    if (otpSnap.empty) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 400 });
    }

    const otpDoc = otpSnap.docs[0];
    const otpData = otpDoc.data();

    // Check expiry
    if (new Date(otpData.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'OTP expired' }, { status: 400 });
    }

    // Update the PIN in users collection (find by employeeDocId)
    const usersRef = adminDb.collection('users');
    const userQuery = usersRef.where('employeeDocId', '==', employeeId);
    const userSnap = await userQuery.get();

    if (!userSnap.empty) {
      const userDoc = userSnap.docs[0];
      await userDoc.ref.update({
        pinHash: newPin,
        updatedAt: new Date().toISOString(),
      });
    }

    // Delete the used OTP
    await otpDoc.ref.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('PIN reset error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}