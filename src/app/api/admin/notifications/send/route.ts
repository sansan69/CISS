import { NextRequest, NextResponse } from "next/server";
import { db, messaging } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import type { AppNotification } from "@/types/notification";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, body: msgBody, role, district, data } = body as {
      title: string;
      body: string;
      role?: "guard" | "fieldOfficer" | "all";
      district?: string;
      data?: Record<string, string>;
    };

    if (!title || !msgBody) {
      return NextResponse.json(
        { error: "Title and body are required" },
        { status: 400 }
      );
    }

    // Save to Firestore
    const notification: Omit<AppNotification, "id"> = {
      type: "broadcast",
      title,
      body: msgBody,
      recipientRole: role ?? "all",
      recipientDistrict: district || undefined,
      data: data ?? undefined,
      read: false,
      createdAt: FieldValue.serverTimestamp() as any,
      createdBy: "admin",
    };

    const docRef = await db.collection("notifications").add(notification);
    const notifId = docRef.id;

    // Send FCM push via topic
    const fcmPayload: Record<string, string> = {
      type: "broadcast",
      notifId,
      ...(data ?? {}),
    };

    let fcmResults: string[] = [];

    try {
      if (role === "guard") {
        const msgId = await messaging.send({
          notification: { title, body: msgBody },
          data: fcmPayload,
          topic: "guards",
        });
        fcmResults.push(`guards:${msgId}`);
      } else if (role === "fieldOfficer") {
        const msgId = await messaging.send({
          notification: { title, body: msgBody },
          data: fcmPayload,
          topic: "field_officers",
        });
        fcmResults.push(`fo:${msgId}`);
      } else {
        // Send to both
        const gId = await messaging.send({
          notification: { title, body: msgBody },
          data: fcmPayload,
          topic: "guards",
        });
        const foId = await messaging.send({
          notification: { title, body: msgBody },
          data: fcmPayload,
          topic: "field_officers",
        });
        fcmResults = [`guards:${gId}`, `fo:${foId}`];
      }
    } catch (fcmError) {
      console.error("FCM send error (notification saved to Firestore):", fcmError);
    }

    return NextResponse.json({
      success: true,
      notifId,
      fcmResults,
    });
  } catch (error) {
    console.error("Notification send error:", error);
    return NextResponse.json(
      { error: "Failed to send notification" },
      { status: 500 }
    );
  }
}
