// Firebase Cloud Messaging Service Worker
// Required for web push notifications. Served from /firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD_oZTSoD5P7KukyR90097fnNFvIVcdISs",
  authDomain: "ciss-workforce.firebaseapp.com",
  projectId: "ciss-workforce",
  storageBucket: "ciss-workforce.firebasestorage.app",
  messagingSenderId: "1041149201339",
  appId: "1:1041149201339:web:d8bc8ce567b2f0955b929e",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || 'CISS Workforce', {
    body: body || '',
    icon: '/icon-192x192.png',
    badge: '/icon-192x192.png',
    data: payload.data,
  });
});
