// src/lib/notifications.ts

import { db } from '@/lib/firebaseAdmin';

export type NotificationType = 
  | 'leave_approved' 
  | 'leave_rejected' 
  | 'payslip_ready'
  | 'training_assigned'
  | 'evaluation_complete'
  | 'shift_reminder';

export async function sendNotification(params: {
  recipientUid: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  // Add to notifications collection (for in-app display)
  await db.collection('notifications').add({
    recipientUid: params.recipientUid,
    type: params.type,
    title: params.title,
    body: params.body,
    data: params.data || {},
    createdAt: new Date(),
    read: false,
  });
  
  // Note: Actual FCM push would require firebase-admin messaging setup
  // For now, we rely on in-app notifications stored in Firestore
}