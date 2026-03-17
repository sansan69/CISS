
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  indexedDBLocalPersistence,
  setPersistence,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

// This configuration is now the single source of truth for the entire frontend application.
// It is populated from the .env file.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "placeholder-api-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "placeholder.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "placeholder-project",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    "placeholder-project.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "000000000000",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:000000000000:web:placeholder",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Optional
};

export const isFirebaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
);

let app;

// This check prevents re-initializing the app on every hot-reload
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

const auth = getAuth(app);

// Client: persistent IndexedDB cache → data appears instantly from cache, then syncs.
// Server (API routes): plain Firestore without browser cache.
const db = (() => {
  if (typeof window === "undefined") return getFirestore(app);
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // Already initialized on hot-reload — getFirestore returns the same instance
    return getFirestore(app);
  }
})();

const storage = getStorage(app);

let authPersistencePromise: Promise<void> | null = null;

export function ensureAuthPersistence() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (!authPersistencePromise) {
    authPersistencePromise = setPersistence(auth, indexedDBLocalPersistence)
      .catch(() => setPersistence(auth, browserLocalPersistence))
      .then(() => undefined);
  }

  return authPersistencePromise;
}

export { app, auth, db, storage };

// Pre-warm auth persistence on module load so the first auth check is fast
if (typeof window !== "undefined") {
  ensureAuthPersistence();
}
