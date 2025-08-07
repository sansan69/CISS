
import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK if not already initialized elsewhere
if (admin.apps.length === 0) {
  admin.initializeApp();
}

// No cloud functions are defined for this version.
// All logic has been moved to the client and secured via Firestore Rules.
