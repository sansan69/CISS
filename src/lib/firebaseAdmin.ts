import * as admin from 'firebase-admin';

function getAdminProjectId() {
  return (
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    undefined
  );
}

// This function robustly initializes the Firebase Admin SDK.
// It supports multiple environment variable configurations for flexibility across
// local development and hosting providers like Vercel.
function initializeAdmin() {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  let credential;

  // Local development can prefer the signed-in Google ADC account. This avoids
  // a revoked local service-account key breaking server routes while keeping
  // production on explicit service-account credentials.
  if (process.env.FIREBASE_ADMIN_PREFER_APPLICATION_DEFAULT === 'true') {
    try {
      credential = admin.credential.applicationDefault();
    } catch (e) {
      console.error("Application Default Credentials failed:", e);
      throw new Error("Local Firebase Admin ADC setup is incomplete. Run `gcloud auth application-default login`.");
    }
  }
  // 1. Recommended for Vercel: Base64 encoded service account
  else if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    try {
      const decodedServiceAccount = Buffer.from(
        process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64,
        'base64'
      ).toString('utf-8');
      credential = admin.credential.cert(JSON.parse(decodedServiceAccount));
    } catch (e) {
      console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG_BASE64:", e);
      throw new Error("Invalid Base64-encoded service account key.");
    }
  }
  // 2. For local dev: raw JSON string
  else if (process.env.FIREBASE_ADMIN_SDK_CONFIG) {
     try {
       credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG));
    } catch (e) {
      console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG:", e);
      throw new Error("Invalid JSON service account key.");
    }
  }
  // 3. For environments that prefer split variables
  else if (process.env.FIREBASE_ADMIN_PROJECT_ID && process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
     credential = admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      // Vercel might escape newlines, so we replace \\n with \n
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    });
  }
  // 4. Fallback to Application Default Credentials (for Google Cloud environments)
  else {
     console.info("No explicit service account found, attempting to use Application Default Credentials.");
     try {
        credential = admin.credential.applicationDefault();
     } catch (e) {
        console.error("Application Default Credentials failed. Please set up server-side Firebase authentication credentials.");
        throw new Error("Server authentication setup is incomplete.");
     }
  }

  return admin.initializeApp({
    credential,
    projectId: getAdminProjectId(),
    storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

let _adminApp: admin.app.App | null = null;
let _db: admin.firestore.Firestore | null = null;
let _auth: admin.auth.Auth | null = null;
let _storage: admin.storage.Storage | null = null;
let _messaging: admin.messaging.Messaging | null = null;

/** Lazy getter for the Admin app singleton. */
function getAdminApp(): admin.app.App {
  if (!_adminApp) {
    _adminApp = initializeAdmin();
  }
  return _adminApp;
}

/** Lazy getter for Admin Firestore (with preferRest to cut gRPC cold-start cost). */
export function getDb(): admin.firestore.Firestore {
  if (!_db) {
    _db = getAdminApp().firestore();
    try {
      _db.settings({ preferRest: true });
    } catch {
      // settings() can only be called once per Firestore instance and only
      // before any other method is used. On warm starts in dev where the app
      // was already initialized, this throws harmlessly — safe to ignore.
    }
  }
  return _db;
}

/** Lazy getter for Admin Auth (default app — can mint custom tokens). */
export function getAuth(): admin.auth.Auth {
  if (!_auth) {
    _auth = getAdminApp().auth();
  }
  return _auth;
}

/** Lazy getter for Admin Storage. */
export function getStorage(): admin.storage.Storage {
  if (!_storage) {
    _storage = getAdminApp().storage();
  }
  return _storage;
}

/** Lazy getter for Admin Messaging. */
export function getMessaging(): admin.messaging.Messaging {
  if (!_messaging) {
    _messaging = getAdminApp().messaging();
  }
  return _messaging;
}

// Re-export the admin app for advanced use-cases (e.g. multiple apps)
export { getAdminApp as adminApp };

// Backward-compatible aliases so existing imports keep working
export const db = new Proxy({} as admin.firestore.Firestore, { get(_, prop) { return (getDb() as any)[prop]; } });
export const auth = new Proxy({} as admin.auth.Auth, { get(_, prop) { return (getAuth() as any)[prop]; } });
export const storage = new Proxy({} as admin.storage.Storage, { get(_, prop) { return (getStorage() as any)[prop]; } });
export const messaging = new Proxy({} as admin.messaging.Messaging, { get(_, prop) { return (getMessaging() as any)[prop]; } });

// Drop customTokenSignerApp — the default app's auth() can mint custom tokens.
// Keep the export for backward compatibility.
export const customTokenAuth = new Proxy({} as admin.auth.Auth, { get(_, prop) { return (getAuth() as any)[prop]; } });
