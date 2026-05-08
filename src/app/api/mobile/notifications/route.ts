import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { canonicalizeDistrictList, canonicalizeDistrictName, districtMatches } from "@/lib/districts";
import { db } from "@/lib/firebaseAdmin";
import { unauthorizedResponse, verifyRequestAuth } from "@/lib/server/auth";
import { resolveMobileSession } from "@/lib/server/mobile-session";

type NotificationAudience = "guard" | "fieldOfficer" | "all";

type NotificationRecord = {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string | null;
  readAt: string | null;
  recipientUid?: string | null;
  recipientRole?: NotificationAudience | null;
  recipientDistrict?: string | null;
  data?: Record<string, string>;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalizeDistrict(value: unknown) {
  const normalized = normalizeText(value);
  return canonicalizeDistrictName(normalized) || normalized;
}

function buildReadStateDocId(uid: string, notifId: string) {
  return `${uid}__${notifId}`;
}

function canSeeLegacyNotification(
  notification: Record<string, unknown>,
  session: Awaited<ReturnType<typeof resolveMobileSession>>,
) {
  if (!session) return false;

  const recipientUid = normalizeText(notification.recipientUid);
  if (recipientUid) {
    return false;
  }

  const recipientRole = normalizeText(notification.recipientRole) as NotificationAudience | "";
  const recipientDistrict = canonicalizeDistrict(notification.recipientDistrict);
  const matchesRole =
    recipientRole === "all" ||
    (session.role === "guard" && recipientRole === "guard") ||
    (session.role === "fieldOfficer" && recipientRole === "fieldOfficer");

  if (!matchesRole) {
    return false;
  }

  if (!recipientDistrict) {
    return true;
  }

  if (session.role === "guard") {
    return districtMatches(session.district, recipientDistrict);
  }

  return canonicalizeDistrictList(session.assignedDistricts ?? []).some((district) =>
    districtMatches(district, recipientDistrict),
  );
}

function serializeNotification(
  id: string,
  data: Record<string, unknown>,
): NotificationRecord {
  const createdAtValue = data.createdAt as { toDate?: () => Date } | Date | undefined;
  const readAtValue = data.readAt as { toDate?: () => Date } | Date | undefined;
  const createdAtDate =
    createdAtValue instanceof Date
      ? createdAtValue
      : typeof createdAtValue?.toDate === "function"
        ? createdAtValue.toDate()
        : null;
  const readAtDate =
    readAtValue instanceof Date
      ? readAtValue
      : typeof readAtValue?.toDate === "function"
        ? readAtValue.toDate()
        : null;

  return {
    id,
    type: normalizeText(data.type) || "broadcast",
    title: normalizeText(data.title),
    body: normalizeText(data.body),
    read: data.read === true,
    createdAt: createdAtDate?.toISOString() ?? null,
    readAt: readAtDate?.toISOString() ?? null,
    recipientUid: normalizeText(data.recipientUid) || null,
    recipientRole: (normalizeText(data.recipientRole) as NotificationAudience | "") || null,
    recipientDistrict: normalizeText(data.recipientDistrict) || null,
    data:
      data.data && typeof data.data === "object"
        ? Object.fromEntries(
            Object.entries(data.data as Record<string, unknown>)
              .filter(([, value]) => value != null)
              .map(([key, value]) => [key, String(value)]),
          )
        : undefined,
  };
}

async function readDirectNotifications(uid: string) {
  const snapshot = await db
    .collection("notifications")
    .where("recipientUid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return snapshot.docs.map((doc) => serializeNotification(doc.id, doc.data()));
}

async function readLegacyReadStates(uid: string, notifications: NotificationRecord[]) {
  const states = await Promise.all(
    notifications.map(async (notification) => {
      const snapshot = await db
        .collection("notificationReadStates")
        .doc(buildReadStateDocId(uid, notification.id))
        .get();

      return {
        notificationId: notification.id,
        data: snapshot.data() || null,
      };
    }),
  );

  return new Map(
    states
      .filter((state) => state.data)
      .map((state) => [state.notificationId, state.data as Record<string, unknown>]),
  );
}

async function readLegacyNotifications(session: Awaited<ReturnType<typeof resolveMobileSession>>) {
  const snapshot = await db
    .collection("notifications")
    .orderBy("createdAt", "desc")
    .limit(150)
    .get();

  const legacyItems = snapshot.docs
    .map((doc) => serializeNotification(doc.id, doc.data()))
    .filter((notification) => canSeeLegacyNotification(notification as Record<string, unknown>, session))
    .slice(0, 50);

  const readStates = await readLegacyReadStates(session!.uid, legacyItems);

  return legacyItems.map((notification) => {
    const state = readStates.get(notification.id);
    if (!state) {
      return notification;
    }

    const readAtValue = state.readAt as { toDate?: () => Date } | Date | undefined;
    const readAtDate =
      readAtValue instanceof Date
        ? readAtValue
        : typeof readAtValue?.toDate === "function"
          ? readAtValue.toDate()
          : null;

    return {
      ...notification,
      read: state.read === true,
      readAt: readAtDate?.toISOString() ?? notification.readAt,
    };
  });
}

async function readVisibleNotifications(session: Awaited<ReturnType<typeof resolveMobileSession>>) {
  const [directItems, legacyItems] = await Promise.all([
    readDirectNotifications(session!.uid),
    readLegacyNotifications(session),
  ]);

  const items = [...directItems, ...legacyItems]
    .sort((left, right) => {
      const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
      const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
      return rightTime - leftTime;
    })
    .slice(0, 50);

  return {
    notifications: items,
    unreadCount: items.filter((notification) => !notification.read).length,
  };
}

export async function GET(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const session = await resolveMobileSession(decoded);

    if (!session) {
      return unauthorizedResponse("This Firebase account is not linked to a mobile profile.", 403);
    }

    const payload = await readVisibleNotifications(session);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not load notifications.";
    return unauthorizedResponse(message, 401);
  }
}

export async function POST(request: Request) {
  try {
    const decoded = await verifyRequestAuth(request);
    const session = await resolveMobileSession(decoded);

    if (!session) {
      return unauthorizedResponse("This Firebase account is not linked to a mobile profile.", 403);
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = normalizeText(body.action);

    if (action === "markRead") {
      const notifId = normalizeText(body.notifId);
      if (!notifId) {
        return NextResponse.json({ error: "Notification id is required." }, { status: 400 });
      }

      const docRef = db.collection("notifications").doc(notifId);
      const doc = await docRef.get();
      if (!doc.exists) {
        return NextResponse.json({ error: "Notification not found." }, { status: 404 });
      }

      const data = doc.data() || {};
      const recipientUid = normalizeText(data.recipientUid);

      if (recipientUid) {
        if (recipientUid !== session.uid) {
          return NextResponse.json({ error: "Notification not visible to this user." }, { status: 403 });
        }

        await docRef.update({
          read: true,
          readAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({ success: true });
      }

      if (!canSeeLegacyNotification(data, session)) {
        return NextResponse.json({ error: "Notification not visible to this user." }, { status: 403 });
      }

      await db.collection("notificationReadStates").doc(buildReadStateDocId(session.uid, notifId)).set({
        uid: session.uid,
        notificationId: notifId,
        read: true,
        readAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return NextResponse.json({ success: true });
    }

    if (action === "markAllRead") {
      const payload = await readVisibleNotifications(session);
      const unread = payload.notifications.filter((notification) => !notification.read);
      const batch = db.batch();

      for (const notification of unread) {
        if (normalizeText(notification.recipientUid) === session.uid) {
          batch.update(db.collection("notifications").doc(notification.id), {
            read: true,
            readAt: FieldValue.serverTimestamp(),
          });
          continue;
        }

        batch.set(
          db.collection("notificationReadStates").doc(buildReadStateDocId(session.uid, notification.id)),
          {
            uid: session.uid,
            notificationId: notification.id,
            read: true,
            readAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }

      if (unread.length > 0) {
        await batch.commit();
      }

      return NextResponse.json({ success: true, updatedCount: unread.length });
    }

    if (action === "createSystem") {
      return NextResponse.json(
        { error: "Guard-created system notifications are disabled." },
        { status: 403 },
      );
    }

    return NextResponse.json({ error: "Unsupported notification action." }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not update notifications.";
    return unauthorizedResponse(message, 401);
  }
}
