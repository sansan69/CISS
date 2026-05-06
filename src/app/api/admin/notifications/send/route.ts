import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

type NotificationType = "work_order" | "attendance_marked" | "leave_approved" | "training_assigned" | "broadcast" | "report_review";

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

    // FCM push — best effort, non-blocking. Lazy-load messaging to avoid
    // crashing the route if the Firebase Admin messaging API isn't configured.
    const fcmPayload: Record<string, string> = {
      type: "broadcast",
      notifId,
      ...(data ?? {}),
    };

    const fcmErrors: string[] = [];

    try {
      // Dynamic import to isolate any messaging init failures
      const { messaging } = await import("@/lib/firebaseAdmin");

      const sendToTopic = async (topic: string) => {
        try {
          await messaging.send({
            topic,
            notification: { title, body: msgBody },
            data: fcmPayload,
          });
        } catch (e: any) {
          fcmErrors.push(`${topic}: ${e?.message || e}`);
        }
      };

      if (role === "guard") {
        await sendToTopic("guards");
      } else if (role === "fieldOfficer") {
        await sendToTopic("field_officers");
      } else {
        await Promise.all([sendToTopic("guards"), sendToTopic("field_officers")]);
      }
    } catch (e: any) {
      // messaging module itself failed to load — non-critical
      console.warn("FCM messaging module unavailable:", e?.message);
      fcmErrors.push(`init: ${e?.message || e}`);
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
