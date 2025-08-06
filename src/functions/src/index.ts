
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

    // 5. Create Firestore Document for the officer
    await db.collection("fieldOfficers").doc(userRecord.uid).set({
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
 * Exports employee data from Firestore into an Excel file.
 * This function streams data for memory efficiency.
 * Triggered by a new document in the 'exportJobs' collection.
 * Supports filtering by clientName, district, and joiningDate range.
 */
export const onDataExportRequested = functions.runWith({timeoutSeconds: 540, memory: "1GB"})
  .firestore.document("exportJobs/{jobId}")
  .onCreate(async (snap, context) => {
    const jobId = context.params.jobId;
    const jobData = snap.data();
    const jobDocRef = db.collection("exportJobs").doc(jobId);

    await jobDocRef.update({
      status: "processing",
    });

    try {
      let employeesQuery: admin.firestore.Query = db.collection("employees");

      // Apply filters if they exist
      const filters = jobData.filters || {};
      if (filters.clientName) {
        employeesQuery = employeesQuery.where('clientName', '==', filters.clientName);
      }
      if (filters.district) {
        employeesQuery = employeesQuery.where('district', '==', filters.district);
      }
      if (filters.startDate) {
        employeesQuery = employeesQuery.where('joiningDate', '>=', new Date(filters.startDate));
      }
      if (filters.endDate) {
        // Add 1 day to the end date to make the range inclusive for 'less than or equal to' logic
        const inclusiveEndDate = new Date(filters.endDate);
        inclusiveEndDate.setDate(inclusiveEndDate.getDate() + 1);
        employeesQuery = employeesQuery.where('joiningDate', '<=', inclusiveEndDate);
      }

      const employeesData: any[] = [];
      
      const stream = employeesQuery.stream();
      
      await new Promise((resolve, reject) => {
          stream.on('data', (doc) => {
            const docData = doc.data();
            const cleanData: {[key: string]: any} = {};
            Object.keys(docData).forEach((key) => {
              if (!key.toLowerCase().includes('url') && key !== 'searchableFields' && key !== 'publicProfile') {
                if (docData[key] instanceof admin.firestore.Timestamp) {
                  cleanData[key] = docData[key].toDate().toISOString().split("T")[0];
                } else {
                   cleanData[key] = docData[key];
                }
              }
            });
            employeesData.push({id: doc.id, ...cleanData});
          });
          stream.on('end', resolve);
          stream.on('error', reject);
      });

      if (employeesData.length === 0) {
        throw new Error("No employee data found for the selected filters.");
      }

      // Create Excel file in a temporary directory
      const tmpdir = os.tmpdir();
      const excelFileName = `CISS_Export_${Date.now()}.xlsx`;
      const excelFilePath = path.join(tmpdir, excelFileName);

      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(employeesData);
      xlsx.utils.book_append_sheet(workbook, worksheet, "Employees");
      xlsx.writeFile(workbook, excelFilePath);

      // Upload to Firebase Storage
      const bucket = storage.bucket();
      const destinationPath = `exports/${excelFileName}`;
      const [uploadedExcelFile] = await bucket.upload(excelFilePath, {
        destination: destinationPath,
        metadata: {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          metadata: {
            owner: jobData.userId,
            jobId: jobId,
          },
        },
      });

      // Get a long-lived download URL
      const downloadUrl = await uploadedExcelFile.getSignedUrl({
        action: "read",
        expires: "03-17-2025",
      });

      // Update job document with success status and download URL
      await jobDocRef.update({
        status: "complete",
        downloadUrl: downloadUrl[0],
        employeeCount: employeesData.length,
        exportedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Clean up the temporary file
      fs.unlinkSync(excelFilePath);
    } catch (error: any) {
      console.error(`Error processing export job ${jobId}:`, error);
      await jobDocRef.update({
        status: "error",
        error: error.message || "An unknown error occurred.",
      });
    }
});
