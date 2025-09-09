import * as admin from 'firebase-admin';

// This function robustly initializes the Firebase Admin SDK.
// It supports multiple environment variable configurations for flexibility across
// local development and hosting providers like Vercel.
function initializeAdmin() {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  let credential;

  // 1. Recommended for Vercel: Base64 encoded service account
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
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
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const adminApp = initializeAdmin();

const db = adminApp.firestore();
const bucket = adminApp.storage().bucket();
const auth = adminApp.auth();

export { adminApp, db, bucket, auth };
