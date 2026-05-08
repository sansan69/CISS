import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { canonicalizeDistrictList, canonicalizeDistrictName, districtMatches } from "@/lib/districts";
import { resolveEmployeeDistrict } from "@/lib/employees/visibility";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";

type NotificationType = "work_order" | "attendance_marked" | "leave_approved" | "training_assigned" | "broadcast" | "report_review";
type NotificationAudience = "guard" | "fieldOfficer" | "all";

type NotificationRecipient = {
  uid: string;
  role: Exclude<NotificationAudience, "all">;
  district?: string;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function slugifyTopicPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildDistrictTopic(role: "guard" | "fieldOfficer", district: string) {
  const prefix = role === "guard" ? "guards" : "field_officers";
  return `${prefix}_district_${slugifyTopicPart(district)}`;
}

function canonicalizeDistrict(value: unknown) {
  const normalized = normalizeText(value);
  return canonicalizeDistrictName(normalized) || normalized;
}

async function readGuardRecipients(district?: string): Promise<NotificationRecipient[]> {
  const snapshot = await db.collection("employees").get();
  const recipients = snapshot.docs
    .map((doc) => doc.data())
    .map((data) => ({
      uid: normalizeText(data.guardAuthUid),
      role: "guard" as const,
      district: canonicalizeDistrict(resolveEmployeeDistrict(data)),
    }))
    .filter((recipient) => recipient.uid);

  if (!district) {
    return recipients;
  }

  return recipients.filter((recipient) => districtMatches(recipient.district, district));
}

async function readFieldOfficerRecipients(district?: string): Promise<NotificationRecipient[]> {
  const snapshot = await db.collection("fieldOfficers").get();
  const recipients = snapshot.docs
    .map((doc) => doc.data())
    .map((data) => {
      const assignedDistricts = canonicalizeDistrictList(
        Array.isArray(data.assignedDistricts)
          ? data.assignedDistricts.filter((value): value is string => typeof value === "string")
          : [normalizeText(data.district)],
      );

      return {
        uid: normalizeText(data.uid),
        role: "fieldOfficer" as const,
        district: assignedDistricts[0] || undefined,
        assignedDistricts,
      };
    })
    .filter((recipient) => recipient.uid);

  if (!district) {
    return recipients.map(({ uid, role, district: recipientDistrict }) => ({
      uid,
      role,
      district: recipientDistrict,
    }));
  }

  return recipients
    .filter((recipient) => recipient.assignedDistricts.some((value) => districtMatches(value, district)))
    .map(({ uid, role, district: recipientDistrict }) => ({
      uid,
      role,
      district: recipientDistrict,
    }));
}

async function resolveRecipients(
  role: NotificationAudience,
  district?: string,
): Promise<NotificationRecipient[]> {
  const recipients: NotificationRecipient[] = [];

  if (role === "guard" || role === "all") {
    recipients.push(...(await readGuardRecipients(district)));
  }

  if (role === "fieldOfficer" || role === "all") {
    recipients.push(...(await readFieldOfficerRecipients(district)));
  }

  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = `${recipient.role}:${recipient.uid}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await requireAdmin(request);
    const body = await request.json();
    const { title, body: msgBody, role, district, data } = body as {
      title: string;
      body: string;
      role?: NotificationAudience;
      district?: string;
      data?: Record<string, string>;
    };

    if (!title || !msgBody) {
      return NextResponse.json(
        { error: "Title and body are required" },
        { status: 400 }
      );
    }

    const targetRole = role ?? "all";
    const targetDistrict = canonicalizeDistrict(district) || undefined;
    const notifId = crypto.randomUUID();
    const recipients = await resolveRecipients(targetRole, targetDistrict);

    await Promise.all(
      recipients.map((recipient) =>
        db.collection("notifications").add({
          broadcastId: notifId,
          type: "broadcast",
          title,
          body: msgBody,
          recipientUid: recipient.uid,
          recipientRole: recipient.role,
          recipientDistrict: targetDistrict ?? recipient.district ?? undefined,
          audienceRole: targetRole,
          data: data || undefined,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: adminUser.uid,
        }),
      ),
    );

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
        await sendToTopic(targetDistrict ? buildDistrictTopic("guard", targetDistrict) : "guards");
      } else if (role === "fieldOfficer") {
        await sendToTopic(targetDistrict ? buildDistrictTopic("fieldOfficer", targetDistrict) : "field_officers");
      } else {
        await Promise.all(
          targetDistrict
            ? [
                sendToTopic(buildDistrictTopic("guard", targetDistrict)),
                sendToTopic(buildDistrictTopic("fieldOfficer", targetDistrict)),
              ]
            : [sendToTopic("guards"), sendToTopic("field_officers")],
        );
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
      recipientCount: recipients.length,
      fcmDelivered: fcmErrors.length === 0,
      ...(fcmErrors.length > 0
        ? { fcmWarning: `Push delivery partially failed: ${fcmErrors.join("; ")}` }
        : {}),
    });
  } catch (error: any) {
    if (error?.message === "Missing bearer token." || error?.message === "Admin access required.") {
      return unauthorizedResponse(error.message, 401);
    }
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
