// Deploy CORS config to Firebase Storage bucket
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Read CORS config
const corsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cors.json'), 'utf8'));

// Initialize Firebase Admin
const serviceAccount = process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64
  ? JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, 'base64').toString())
  : process.env.FIREBASE_ADMIN_SDK_CONFIG
    ? JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG)
    : null;

if (!serviceAccount) {
  // Try env vars
  if (process.env.FIREBASE_PROJECT_ID) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || 'ciss-workforce',
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'ciss-workforce.appspot.com',
    });
  } else {
    console.error('No Firebase credentials found');
    process.exit(1);
  }
} else {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
  });
}

const bucket = admin.storage().bucket();

async function deployCors() {
  console.log('Setting CORS config on bucket:', bucket.name);
  try {
    await bucket.setCorsConfiguration(corsConfig);
    console.log('CORS configuration deployed successfully!');
    console.log('Origins:', corsConfig[0].origin);
    console.log('Methods:', corsConfig[0].method);
  } catch (err) {
    console.error('Failed to deploy CORS:', err.message);
    process.exit(1);
  }
}

deployCors();
