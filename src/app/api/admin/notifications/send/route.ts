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

    // Always save to Firestore first
    const docRef = await db.collection("notifications").add({
      type: "broadcast",
      title,
      body: msgBody,
      recipientRole: role ?? "all",
      recipientDistrict: district || undefined,
      data: data || undefined,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "admin",
    });

    const notifId = docRef.id;

    // FCM push — best effort, non-blocking
    const fcmPayload: Record<string, string> = {
      type: "broadcast",
      notifId,
      ...(data ?? {}),
    };

    const fcmErrors: string[] = [];

    const sendToTopic = async (topic: string) => {
      try {
        return await messaging.send({
          topic,
          notification: { title, body: msgBody },
          data: fcmPayload,
        });
      } catch (e: any) {
        fcmErrors.push(`${topic}: ${e?.message || e}`);
        return null;
      }
    };

    if (role === "guard") {
      await sendToTopic("guards");
    } else if (role === "fieldOfficer") {
      await sendToTopic("field_officers");
    } else {
      await Promise.all([sendToTopic("guards"), sendToTopic("field_officers")]);
    }

    return NextResponse.json({
      success: true,
      notifId,
      savedToFirestore: true,
      fcmDelivered: fcmErrors.length === 0,
      ...(fcmErrors.length > 0
        ? { fcmWarning: `Push delivery partially failed: ${fcmErrors.join("; ")}` }
        : {}),
    });
  } catch (error: any) {
    console.error("Notification send error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to send notification",
        detail: process.env.NODE_ENV === "development" ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
