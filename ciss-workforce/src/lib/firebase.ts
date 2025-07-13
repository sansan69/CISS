
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import dotenv from 'dotenv';

// Explicitly load environment variables from .env file to ensure they are available.
dotenv.config({ path: '.env' });


const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Optional
};

// Diagnostic log to check if environment variables are loaded correctly
// console.log("--- Firebase Config Check ---");
// console.log("Project ID:", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
// console.log("API Key Loaded:", !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
// console.log("--------------------------");


// Initialize Firebase
let app;
if (!getApps().length) {
  if (!firebaseConfig.projectId) {
    console.error("Firebase project ID is missing. Make sure your .env file is set up correctly.");
  }
  app = initializeApp(firebaseConfig);
} else {
  app = getApp();
}

// Initialize App Check
if (typeof window !== 'undefined') {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY;
  if (siteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true
    });
  } else {
    console.warn("Firebase App Check is not initialized. NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY is missing. This is expected for local development but required for production.");
  }
}


const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); // Initialize Firebase Storage

export { app, auth, db, storage }; // Export storage
