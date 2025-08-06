
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const ADMIN_EMAIL = "admin@cisskerala.app";

/**
 * Creates a new Field Officer user, sets their custom claims, and stores their info in Firestore.
 * This function can only be called by the designated admin.
 */
export const createFieldOfficer = functions.https.onCall(async (data, context) => {
  // 1. Authentication & Authorization
  if (!context.auth || context.auth.token.email !== ADMIN_EMAIL) {
    throw new functions.https.HttpsError("permission-denied", "Must be the designated admin to create a field officer.");
  }

  // 2. Input Validation
  const {email, password, name, assignedDistricts} = data;
  if (!email || !password || !name || !Array.isArray(assignedDistricts)) {
    throw new functions.https.HttpsError("invalid-argument", "The function must be called with email, password, name, and assignedDistricts.");
  }
  if (password.length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "Password must be at least 6 characters long.");
  }

  try {
    // 3. Create Firebase Auth User
    const userRecord = await admin.auth().createUser({
      email: email,
      password: password,
      displayName: name,
    });

    // 4. Set Custom Claims for role-based access
    await admin.auth().setCustomUserClaims(userRecord.uid, {
        role: "fieldOfficer",
        districts: assignedDistricts,
    });

    // 5. Create Firestore Document for the officer
    await db.collection("fieldOfficers").add({
      uid: userRecord.uid,
      name: name,
      email: email,
      assignedDistricts: assignedDistricts,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {result: `Successfully created field officer ${name} with email ${email}.`};
  } catch (error: any) {
    console.error("Error creating field officer:", error);
    if (error.code === "auth/email-already-exists") {
      throw new functions.https.HttpsError("already-exists", "An account with this email address already exists.");
    }
    throw new functions.https.HttpsError("internal", "An error occurred while creating the field officer.");
  }
});

/**
 * Updates an existing field officer's details and custom claims.
 * This function can only be called by the designated admin.
 */
export const updateFieldOfficer = functions.https.onCall(async (data, context) => {
    // 1. Authentication & Authorization
    if (!context.auth || context.auth.token.email !== ADMIN_EMAIL) {
        throw new functions.https.HttpsError("permission-denied", "Must be the designated admin to update a field officer.");
    }

    // 2. Input Validation
    const {uid, name, assignedDistricts} = data;
    if (!uid || !name || !Array.isArray(assignedDistricts)) {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with uid, name, and assignedDistricts.");
    }

    try {
        // 3. Update Custom Claims for role-based access
        await admin.auth().setCustomUserClaims(uid, {
            role: "fieldOfficer",
            districts: assignedDistricts,
        });

        // 4. Update Firestore Document
        const querySnapshot = await db.collection("fieldOfficers").where("uid", "==", uid).limit(1).get();
        if (querySnapshot.empty) {
            throw new functions.https.HttpsError("not-found", "Field officer document not found in Firestore.");
        }
        const officerDocRef = querySnapshot.docs[0].ref;
        await officerDocRef.update({
            name: name,
            assignedDistricts: assignedDistricts,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {result: `Successfully updated field officer ${name}.`};
    } catch (error: any) {
        console.error("Error updating field officer:", error);
        throw new functions.https.HttpsError("internal", "An error occurred while updating the field officer.");
    }
});

/**
 * Deletes a field officer's Auth account and their Firestore record.
 * This function can only be called by the designated admin.
 */
export const deleteFieldOfficer = functions.https.onCall(async (data, context) => {
    // 1. Authentication & Authorization
    if (!context.auth || context.auth.token.email !== ADMIN_EMAIL) {
        throw new functions.https.HttpsError("permission-denied", "Must be the designated admin to delete a field officer.");
    }

    // 2. Input Validation
    const {uid} = data;
    if (!uid) {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with a uid.");
    }

    try {
        const querySnapshot = await db.collection("fieldOfficers").where("uid", "==", uid).limit(1).get();
        if (!querySnapshot.empty) {
            const officerDocRef = querySnapshot.docs[0].ref;
            await officerDocRef.delete();
        }
        
        // Always try to delete auth user, even if DB record is missing
        await admin.auth().deleteUser(uid);

        return {result: "Successfully deleted field officer."};
    } catch (error: any) {
        console.error("Error deleting field officer:", error);
        if (error.code === "auth/user-not-found") {
           return {result: "Field officer Auth account not found, but Firestore record was deleted if it existed."};
        }
        throw new functions.https.HttpsError("internal", "An error occurred while deleting the field officer.");
    }
});
