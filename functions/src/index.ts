
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


/**
 * Sets a user's role (e.g., 'stateAdmin') as a custom claim.
 * This function can only be called by an existing superAdmin.
 */
export const createStateAdmin = functions.https.onCall(async (data, context) => {
  // Check if the caller is a super admin
  if (context.auth?.token.superAdmin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Must be a super admin to create other admins.");
  }

  const {email, state} = data;
  if (!email || !state) {
    throw new functions.https.HttpsError("invalid-argument", "The function must be called with arguments 'email' and 'state'.");
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, {role: "stateAdmin", state: state});
    return {result: `Successfully made ${email} a state admin for ${state}.`};
  } catch (error) {
    console.error("Error setting custom claim:", error);
    if (error instanceof Error && (error as any).code === "auth/user-not-found") {
       throw new functions.https.HttpsError("not-found", `User with email ${email} not found.`);
    }
    throw new functions.https.HttpsError("internal", "An error occurred while setting the user role.");
  }
});


/**
 * Sets the first super admin for the project.
 * This function is designed to be run only once to secure the system.
 */
export const setSuperAdmin = functions.https.onCall(async (data, context) => {
  const listUsersResult = await admin.auth().listUsers(1000);
  const superAdminExists = listUsersResult.users.some((user) => user.customClaims?.superAdmin === true);

  if (superAdminExists) {
    // If a super admin already exists, only an existing super admin can create another one.
    if (context.auth?.token.superAdmin !== true) {
        throw new functions.https.HttpsError("already-exists", "A super admin already exists. Only another super admin can create more.");
    }
  }

  const {email} = data;
  if (!email) {
    throw new functions.https.HttpsError("invalid-argument", "The function must be called with an 'email' argument.");
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, {superAdmin: true, role: "superAdmin"});
    return {result: `Successfully made ${email} a super admin.`};
  } catch (error) {
    console.error("Error setting super admin claim:", error);
    if (error instanceof Error && (error as any).code === "auth/user-not-found") {
       throw new functions.https.HttpsError("not-found", `User with email ${email} not found.`);
    }
    throw new functions.https.HttpsError("internal", "An error occurred while setting the super admin role.");
  }
});

/**
 * Exports all employee data from Firestore into an Excel file when a job is created.
 * Triggered by a new document in the 'exportJobs' collection.
 */
export const onDataExportRequested = functions.runWith({timeoutSeconds: 540, memory: "1GB"})
  .firestore.document("exportJobs/{jobId}")
  .onCreate(async (snap, context) => {
    const jobId = context.params.jobId;
    const jobData = snap.data();

    // 1. Acknowledge the job has started
    await db.collection("exportJobs").doc(jobId).update({
      status: "processing",
    });

    try {
      // 2. Fetch all employee data
      const employeesSnapshot = await db.collection("employees").get();
      if (employeesSnapshot.empty) {
        throw new Error("No employee data found to export.");
      }

      // 3. Process data for Excel
      const employeesData = employeesSnapshot.docs.map((doc) => {
        const docData = doc.data();
        // Convert Firestore Timestamps to ISO strings for Excel compatibility.
        Object.keys(docData).forEach((key) => {
          if (docData[key] instanceof admin.firestore.Timestamp) {
            docData[key] = docData[key].toDate().toISOString().split("T")[0]; // Just the date part
          }
        });
        return {id: doc.id, ...docData};
      });

      // 4. Create Excel file in memory
      const tmpdir = os.tmpdir();
      const excelFileName = `CISS_Export_${Date.now()}.xlsx`;
      const excelFilePath = path.join(tmpdir, excelFileName);

      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(employeesData);
      xlsx.utils.book_append_sheet(workbook, worksheet, "Employees");

      // Use writeFile instead of write to buffer directly in memory if possible with xlsx
      xlsx.writeFile(workbook, excelFilePath);

      // 5. Upload to Firebase Storage
      const bucket = storage.bucket();
      const destinationPath = `exports/${excelFileName}`;
      const [uploadedExcelFile] = await bucket.upload(excelFilePath, {
        destination: destinationPath,
        metadata: {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          // Associate the file with the user who requested it.
          metadata: {
            owner: jobData.userId,
            jobId: jobId,
          },
        },
      });

      // 6. Get a long-lived download URL (no expiry)
      const downloadUrl = await uploadedExcelFile.getSignedUrl({
        action: "read",
        expires: "03-17-2025", // Set a far-future expiration date
      });


      // 7. Update job document with success status and download URL
      await db.collection("exportJobs").doc(jobId).update({
        status: "complete",
        downloadUrl: downloadUrl[0],
        employeeCount: employeesData.length,
        exportedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 8. Clean up the temporary file
      fs.unlinkSync(excelFilePath);
    } catch (error: any) {
      console.error(`Error processing export job ${jobId}:`, error);
      // Update job document with error status
      await db.collection("exportJobs").doc(jobId).update({
        status: "error",
        error: error.message || "An unknown error occurred.",
      });
    }
});
