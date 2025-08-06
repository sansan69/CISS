
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
 * Exports employee data from Firestore into an Excel file.
 * Triggered by a new document in the 'exportJobs' collection.
 * Supports filtering by clientName and joiningDate range.
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
      if (filters.startDate) {
        employeesQuery = employeesQuery.where('joiningDate', '>=', new Date(filters.startDate));
      }
      if (filters.endDate) {
        // Add 1 day to the end date to make the range inclusive
        const inclusiveEndDate = new Date(filters.endDate);
        inclusiveEndDate.setDate(inclusiveEndDate.getDate() + 1);
        employeesQuery = employeesQuery.where('joiningDate', '<=', inclusiveEndDate);
      }

      const employeesSnapshot = await employeesQuery.get();
      if (employeesSnapshot.empty) {
        throw new Error("No employee data found for the selected filters.");
      }

      const employeesData = employeesSnapshot.docs.map((doc) => {
        const docData = doc.data();
        const cleanData: {[key: string]: any} = {};

        Object.keys(docData).forEach((key) => {
          if (!key.toLowerCase().includes('url')) {
            if (docData[key] instanceof admin.firestore.Timestamp) {
              cleanData[key] = docData[key].toDate().toISOString().split("T")[0];
            } else if (key !== 'searchableFields' && key !== 'publicProfile') {
               cleanData[key] = docData[key];
            }
          }
        });
        return {id: doc.id, ...cleanData};
      });

      const tmpdir = os.tmpdir();
      const excelFileName = `CISS_Export_${Date.now()}.xlsx`;
      const excelFilePath = path.join(tmpdir, excelFileName);

      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(employeesData);
      xlsx.utils.book_append_sheet(workbook, worksheet, "Employees");
      xlsx.writeFile(workbook, excelFilePath);

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

      const downloadUrl = await uploadedExcelFile.getSignedUrl({
        action: "read",
        expires: "03-17-2025",
      });

      await jobDocRef.update({
        status: "complete",
        downloadUrl: downloadUrl[0],
        employeeCount: employeesData.length,
        exportedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      fs.unlinkSync(excelFilePath);
    } catch (error: any) {
      console.error(`Error processing export job ${jobId}:`, error);
      await jobDocRef.update({
        status: "error",
        error: error.message || "An unknown error occurred.",
      });
    }
});
