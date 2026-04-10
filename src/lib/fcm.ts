"use client";

import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { db } from './firebase';
import { doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let messaging: ReturnType<typeof getMessaging> | null = null;

function getFCMMessaging() {
  const senderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  if (!senderId || senderId === '000000000000') {
    console.warn('FCM Sender ID not configured');
    return null;
  }
  
  if (!getApps().length) {
    initializeApp(firebaseConfig);
  }
  
  if (!messaging) {
    try {
      messaging = getMessaging();
    } catch {
      console.warn('FCM not available');
      return null;
    }
  }
  
  return messaging;
}

export async function requestNotificationPermission(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  
  if (!('Notification' in window)) {
    console.warn('Notifications not supported');
    return null;
  }
  
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('Notification permission denied');
    return null;
  }
  
  const fc = getFCMMessaging();
  if (!fc) return null;
  
  try {
    const token = await getToken(fc, {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    });
    return token;
  } catch (error) {
    console.error('FCM token error:', error);
    return null;
  }
}

export async function registerFCMToken(uid: string, token: string): Promise<void> {
  if (!db) return;
  await setDoc(doc(db, 'fcmTokens', uid), {
    token,
    platform: 'web',
    createdAt: new Date(),
    updatedAt: new Date(),
  }, { merge: true });
}

export function onForegroundMessage(callback: (payload: any) => void): () => void {
  const fc = getFCMMessaging();
  if (!fc) return () => {};
  
  return onMessage(fc, (payload) => {
    if (payload.notification) {
      new Notification(payload.notification.title || 'CISS', {
        body: payload.notification.body,
        icon: '/favicon.ico',
      });
    }
    callback(payload);
  });
}