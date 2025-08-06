
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as xlsx from "xlsx";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const ADMIN_EMAIL = "admin@cisskerala.app";

/**
 * Creates a new Field Officer user, sets their custom claims, and stores their info in Firestore.
 * This function can only be called by the designated admin.
 */
export const createFieldOfficer = functions.https.onCall(async (data, context) => {
  // 1. Authentication & Authorization
  if (context.auth?.token.email !== ADMIN_EMAIL) {
    throw new functions.https.HttpsError("permission-denied", "Must be the designated admin to create a field officer.");
  }

  // 2. Input Validation
  const {email, password, name, assignedDistricts} = data;
  if (!email || !password || !name || !assignedDistricts) {
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

    // 5. Create Firestore Document for the officer using the auth UID as the document ID
    await db.collection("fieldOfficers").doc(userRecord.uid).set({
      uid: userRecord.uid, // Storing uid is good practice
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
    if (context.auth?.token.email !== ADMIN_EMAIL) {
        throw new functions.https.HttpsError("permission-denied", "Must be the designated admin to update a field officer.");
    }

    // 2. Input Validation
    const {uid, name, assignedDistricts} = data;
    if (!uid || !name || !assignedDistricts) {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with uid, name, and assignedDistricts.");
    }

    try {
        // 3. Update Custom Claims for role-based access
        await admin.auth().setCustomUserClaims(uid, {
            role: "fieldOfficer",
            districts: assignedDistricts,
        });

        // 4. Update Firestore Document
        const officerDocRef = db.collection("fieldOfficers").doc(uid);
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
    if (context.auth?.token.email !== ADMIN_EMAIL) {
        throw new functions.https.HttpsError("permission-denied", "Must be the designated admin to delete a field officer.");
    }

    // 2. Input Validation
    const {uid} = data;
    if (!uid) {
        throw new functions.https.HttpsError("invalid-argument", "The function must be called with a uid.");
    }

    try {
        // 3. Delete Firebase Auth User
        await admin.auth().deleteUser(uid);

        // 4. Delete Firestore Document
        await db.collection("fieldOfficers").doc(uid).delete();

        return {result: "Successfully deleted field officer."};
    } catch (error: any) {
        console.error("Error deleting field officer:", error);
        if (error.code === "auth/user-not-found") {
            try {
                // If auth user is already gone, still try to delete the DB record
                await db.collection("fieldOfficers").doc(uid).delete();
                return {result: "Field officer Auth account not found, but Firestore record was deleted."};
            } catch (fsError) {
                 throw new functions.https.HttpsError("internal", "Auth user not found and failed to delete Firestore record.");
            }
        }
        throw new functions.https.HttpsError("internal", "An error occurred while deleting the field officer.");
    }
});

/**
 * Processes an uploaded work order Excel file from a specific Storage path.
 */
export const onWorkOrderUploaded = functions.runWith({timeoutSeconds: 540, memory: "1GB"})
  .storage.object().onFinalize(async (object) => {
    const filePath = object.name;
    const contentType = object.contentType;

    // Exit if this is not a work order file in the correct folder
    if (!filePath || !filePath.startsWith("work-order-uploads/") || !contentType?.includes("sheet")) {
      functions.logger.log("Not a work order file, skipping.", {filePath, contentType});
      return;
    }

    const fileBucket = object.bucket;
    const bucket = storage.bucket(fileBucket);
    const tmpdir = os.tmpdir();
    const tempFilePath = path.join(tmpdir, path.basename(filePath));

    await bucket.file(filePath).download({destination: tempFilePath});
    functions.logger.log("Work order file downloaded to", tempFilePath);

    try {
      const workbook = xlsx.readFile(tempFilePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      // Convert sheet to JSON, assuming first row is headers
      const workOrderData: any[] = xlsx.utils.sheet_to_json(worksheet);

      if (workOrderData.length === 0) {
        functions.logger.warn("Work order file is empty.");
        return;
      }

      const batch = db.batch();
      let operationsCount = 0;

      // Fetch all sites once to avoid multiple reads inside the loop
      const sitesSnapshot = await db.collection("sites").get();
      const sitesMap = new Map();
      sitesSnapshot.forEach((doc) => {
        const siteData = doc.data();
        const key = `${siteData.clientName?.toLowerCase()}_${siteData.siteName?.toLowerCase()}`;
        sitesMap.set(key, {id: doc.id, ...siteData});
      });

      for (const row of workOrderData) {
        const clientName = row["Client Name"];
        const siteName = row["Site Name"];
        const date = row["Date"];
        const manpowerRequired = parseInt(row["Manpower Required"], 10);

        if (!clientName || !siteName || !date || isNaN(manpowerRequired)) {
          functions.logger.warn("Skipping invalid row:", row);
          continue;
        }
        
        const siteKey = `${clientName.toLowerCase()}_${siteName.toLowerCase()}`;
        const site = sitesMap.get(siteKey);

        if (!site) {
          functions.logger.warn(`Site not found for client "${clientName}" and site "${siteName}". Skipping.`);
          continue;
        }

        // Convert Excel date serial number to JS Date if necessary
        const workDate = xlsx.SSF.parse_date_code(date);
        const firestoreTimestamp = admin.firestore.Timestamp.fromDate(new Date(workDate.y, workDate.m - 1, workDate.d));

        // Create a unique ID for the work order document to prevent duplicates
        const workOrderId = `${site.id}_${workDate.y}-${String(workDate.m).padStart(2, "0")}-${String(workDate.d).padStart(2, "0")}`;

        const workOrderRef = db.collection("workOrders").doc(workOrderId);

        batch.set(workOrderRef, {
          siteId: site.id,
          siteName: site.siteName,
          clientName: site.clientName,
          district: site.district,
          date: firestoreTimestamp,
          manpowerRequired: manpowerRequired,
          assignedGuards: {}, // Initialize as empty map
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        operationsCount++;
      }

      if (operationsCount > 0) {
        await batch.commit();
        functions.logger.log(`Successfully processed and committed ${operationsCount} work order entries.`);
      } else {
        functions.logger.log("No new work order entries to commit.");
      }
    } catch (error) {
      functions.logger.error("Error processing work order file:", error);
    } finally {
      // Clean up the temporary file
      fs.unlinkSync(tempFilePath);
    }
});
