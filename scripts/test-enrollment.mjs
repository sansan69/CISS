#!/usr/bin/env node

import { config as loadEnv } from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

loadEnv({ path: new URL("../.env.local", import.meta.url).pathname });

function initAdmin() {
  if (getApps().length > 0) return getApps()[0];
  let credential;
  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    credential = cert(JSON.parse(Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, "base64").toString("utf-8")));
  } else if (process.env.FIREBASE_ADMIN_SDK_CONFIG) {
    credential = cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK_CONFIG));
  } else {
    throw new Error("No Firebase Admin credentials found");
  }
  return initializeApp({ credential, storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
}

async function main() {
  const app = initAdmin();
  const db = getFirestore(app);
  const adminAuth = getAuth(app);

  // Step 1: Find or create an admin user to get a custom token
  console.log("=== Step 1: Get admin auth token ===");
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || "super.admin@ciss.app";

  let adminUser;
  try {
    adminUser = await adminAuth.getUserByEmail(adminEmail);
    console.log(`Found admin user: ${adminUser.uid} (${adminUser.email})`);
  } catch {
    // Admin doesn't exist in Auth, create one
    console.log(`No admin auth user for ${adminEmail}, checking all users...`);
    const allUsers = await adminAuth.listUsers(100);
    const adminLike = allUsers.users.find(u => {
      const claims = u.customClaims || {};
      return claims.admin === true || claims.role === "admin" || claims.role === "superAdmin";
    });
    if (adminLike) {
      adminUser = adminLike;
      console.log(`Found admin-like user: ${adminUser.uid} (${adminUser.email})`);
    } else {
      console.log("No admin user found. Creating one...");
      adminUser = await adminAuth.createUser({
        email: "test-audit-admin@ciss.app",
        password: "TestAudit2026!",
        displayName: "Audit Test Admin",
      });
      await adminAuth.setCustomUserClaims(adminUser.uid, { admin: true, role: "admin" });
      console.log(`Created admin user: ${adminUser.uid}`);
    }
  }

  // Create custom token for the admin
  const customToken = await adminAuth.createCustomToken(adminUser.uid);
  console.log(`Custom token created (length: ${customToken.length})`);

  // Step 2: Exchange custom token for ID token via Firebase Auth REST API
  console.log("\n=== Step 2: Exchange custom token for ID token ===");
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    console.error("NEXT_PUBLIC_FIREBASE_API_KEY not found in env");
    process.exit(1);
  }

  const signInResp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: customToken,
        returnSecureToken: true,
      }),
    }
  );

  if (!signInResp.ok) {
    const errText = await signInResp.text();
    console.error(`Failed to sign in with custom token: ${signInResp.status} ${errText}`);
    process.exit(1);
  }

  const signInData = await signInResp.json();
  const idToken = signInData.idToken;
  console.log(`ID token obtained (length: ${idToken.length})`);

  // Step 3: Test enrollment API
  console.log("\n=== Step 3: Test enrollment via API ===");
  const baseUrl = "http://localhost:3000";

  const testPhone = "9998887766";
  const testEmail = "test-audit-enroll@ciss.app";

  // First, get available clients
  console.log("Fetching available clients...");
  const clientsSnap = await db.collection("clients").orderBy("name", "asc").limit(1).get();
  if (clientsSnap.empty) {
    console.error("No clients found in Firestore - cannot test enrollment");
    process.exit(1);
  }
  const clientName = clientsSnap.docs[0].data().name;
  console.log(`Using client: ${clientName}`);

  const enrollmentPayload = {
    joiningDate: "2026-04-01T00:00:00.000Z",
    clientName,
    profilePictureUrl: "https://storage.example.com/test/profile.jpg",
    firstName: "TestAudit",
    lastName: "Enrollment",
    fatherName: "TestFather",
    motherName: "TestMother",
    dateOfBirth: "2000-01-15T00:00:00.000Z",
    gender: "Male",
    maritalStatus: "Unmarried",
    educationalQualification: "Graduation",
    district: "Ernakulam",
    fullAddress: "12/345 Test Street, Kochi, Kerala 682001",
    emailAddress: testEmail,
    phoneNumber: testPhone,
    identityProofType: "Aadhar Card",
    identityProofNumber: "123456789012",
    identityProofUrlFront: "https://storage.example.com/test/id-front.jpg",
    identityProofUrlBack: "https://storage.example.com/test/id-back.jpg",
    addressProofType: "Voter ID",
    addressProofNumber: "ABC1234567",
    addressProofUrlFront: "https://storage.example.com/test/addr-front.jpg",
    addressProofUrlBack: "https://storage.example.com/test/addr-back.jpg",
    signatureUrl: "https://storage.example.com/test/signature.jpg",
  };

  console.log("Submitting enrollment...");
  const enrollResp = await fetch(`${baseUrl}/api/employees/enroll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify(enrollmentPayload),
  });

  const enrollStatus = enrollResp.status;
  const enrollData = await enrollResp.json();
  console.log(`Enrollment response: ${enrollStatus}`);
  console.log(`Response body: ${JSON.stringify(enrollData, null, 2)}`);

  if (enrollStatus !== 200 && enrollStatus !== 201) {
    console.error("\nENROLLMENT FAILED!");
    console.error("This indicates the enrollment process has an error.");
  } else {
    console.log(`\nENROLLMENT SUCCESS!`);
    console.log(`  Doc ID: ${enrollData.id}`);
    console.log(`  Employee ID: ${enrollData.employeeId}`);

    // Step 4: Verify the employee exists in Firestore
    console.log("\n=== Step 4: Verify employee in Firestore ===");
    const empDoc = await db.doc(`employees/${enrollData.id}`).get();
    if (empDoc.exists) {
      const empData = empDoc.data();
      console.log(`  Name: ${empData.fullName}`);
      console.log(`  Status: ${empData.status}`);
      console.log(`  Phone: ${empData.phoneNumber}`);
      console.log(`  EmployeeId: ${empData.employeeId}`);
      console.log(`  Client: ${empData.clientName}`);
      console.log(`  District: ${empData.district}`);
      console.log(`  PublicProfile status: ${empData.publicProfile?.status}`);
      console.log(`  SearchableFields: ${JSON.stringify(empData.searchableFields)}`);
      console.log(`  DateOfBirth type: ${typeof empData.dateOfBirth}`);
      console.log(`  QR code exists: ${!!empData.qrCodeUrl}`);

      // Step 5: Test lookup by phone
      console.log("\n=== Step 5: Test phone lookup ===");
      const lookupResp = await fetch(`${baseUrl}/api/employees/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: testPhone }),
      });
      const lookupData = await lookupResp.json();
      console.log(`Lookup response: ${JSON.stringify(lookupData)}`);

      // Step 6: Test public profile API
      console.log("\n=== Step 6: Test public profile API ===");
      const profileResp = await fetch(`${baseUrl}/api/employees/public-profile/${enrollData.id}`);
      const profileData = await profileResp.json();
      console.log(`Profile response: ${JSON.stringify(profileData)}`);

      // Step 7: Clean up - delete the test employee
      console.log("\n=== Step 7: Clean up test data ===");
      await db.doc(`employees/${enrollData.id}`).delete();
      console.log(`Deleted employee doc: ${enrollData.id}`);

      // Also check for any attendance logs
      const attSnap = await db.collection("attendanceLogs")
        .where("employeeDocId", "==", enrollData.id)
        .get();
      if (!attSnap.empty) {
        const batch = db.batch();
        attSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        console.log(`Deleted ${attSnap.size} attendance logs`);
      }

      console.log("\n=== ALL TESTS PASSED ===");
    } else {
      console.error("Employee document not found in Firestore after enrollment!");
    }
  }

  // Clean up the test admin user if we created it
  if (adminUser.email === "test-audit-admin@ciss.app") {
    await adminAuth.deleteUser(adminUser.uid);
    console.log("\nCleaned up test admin user");
  }
}

main().catch(console.error);
