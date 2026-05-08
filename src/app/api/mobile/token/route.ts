import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { db } from "@/lib/firebaseAdmin";
import { unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const body = (await request.json()) as { fcmToken?: string };
    const fcmToken = typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";

    if (!fcmToken) {
      return NextResponse.json({ error: "FCM token is required." }, { status: 400 });
    }

    await db.collection("fcmTokens").doc(`${decoded.uid}_mobile`).set(
      {
        uid: decoded.uid,
        token: fcmToken,
        platform: "mobile",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not save FCM token.";
    return unauthorizedResponse(message, 401);
  }
}
