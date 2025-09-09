
import * as admin from 'firebase-admin';

// This module is server-only and should not be imported into client-side components.

const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (!admin.apps.length) {
  if (!serviceAccountKey) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. This is required for server-side admin operations.');
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountKey)),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  } catch (error: any) {
    console.error('Firebase Admin Initialization Error:', error);
    // Provide a more helpful error message if parsing fails
    if (error.code === 'app/invalid-credential') {
        throw new Error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY. Make sure it is a valid JSON string.');
    }
    throw error;
  }
}

const firestoreAdmin = admin.firestore();
const storageAdmin = admin.storage();
const authAdmin = admin.auth();

export { firestoreAdmin, storageAdmin, authAdmin, admin };
