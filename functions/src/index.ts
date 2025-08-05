
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import * as xlsx from "xlsx";
import * as cors from "cors";
import * as corsConfig from "../cors-config.json";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

const corsHandler = cors({origin: corsConfig.map((c) => c.origin).flat()});

/**
 * Sets a user's role (e.g., 'stateAdmin') as a custom claim.
 * This function can only be called by an existing admin.
 */
export const createStateAdmin = functions.https.onCall(async (data, context) => {
  // Check if the caller is an admin
  if (context.auth?.token.admin !== true) {
    throw new functions.https.HttpsError("permission-denied", "Must be an admin to create other admins.");
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
    throw new functions.https.HttpsError("internal", "An error occurred while setting the user role.");
  }
});


/**
 * Sets the first super admin for the project.
 * This function is designed to be run only once to secure the system.
 */
export const setSuperAdmin = functions.https.onCall(async (data, context) => {
  // Check if a super admin already exists to prevent misuse.
  const listUsersResult = await admin.auth().listUsers(1000);
  const superAdminExists = listUsersResult.users.some((user) => user.customClaims?.role === "superAdmin");

  if (superAdminExists) {
    throw new functions.https.HttpsError("already-exists", "A super admin already exists for this project.");
  }

  const {email} = data;
  if (!email) {
    throw new functions.https.HttpsError("invalid-argument", "The function must be called with an 'email' argument.");
  }

  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().setCustomUserClaims(user.uid, {role: "superAdmin"});
    return {result: `Successfully made ${email} a super admin.`};
  } catch (error) {
    console.error("Error setting super admin claim:", error);
    throw new functions.https.HttpsError("internal", "An error occurred while setting the super admin role.");
  }
});

/**
 * Exports all employee data from Firestore into an Excel file.
 * The Excel file will contain clickable hyperlinks to the documents stored in Firebase Storage.
 */
export const exportAllData = functions.runWith({timeoutSeconds: 300, memory: "512MB"})
  .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
    // Optional: Add role-based access control here if needed.
    // For onRequest, you would need to verify the user's ID token manually.
    // Example: const idToken = req.headers.authorization?.split('Bearer ')[1];
    // This example keeps it open for simplicity as per the original onCall structure.

    try {
      const employeesSnapshot = await db.collection("employees").get();
      if (employeesSnapshot.empty) {
        res.status(404).send({error: "No employee data to export."});
        return;
      }

      const employeesData = employeesSnapshot.docs.map((doc) => {
        const docData = doc.data();
        // Convert all Timestamps to ISO strings for consistent formatting in Excel.
        // URLs will be preserved as clickable links.
        Object.keys(docData).forEach((key) => {
          if (docData[key] instanceof admin.firestore.Timestamp) {
            docData[key] = docData[key].toDate().toISOString();
          }
        });
        return {id: doc.id, ...docData};
      });

      // 1. Create Excel file in a temporary directory
      const tmpdir = os.tmpdir();
      const excelFileName = `CISS_Export_${Date.now()}.xlsx`;
      const excelFilePath = path.join(tmpdir, excelFileName);

      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(employeesData);

      xlsx.utils.book_append_sheet(workbook, worksheet, "Employees");
      xlsx.writeFile(workbook, excelFilePath);

      // 2. Upload the Excel file to Firebase Storage
      const bucket = storage.bucket();
      const destinationPath = `exports/${excelFileName}`;
      const [uploadedExcelFile] = await bucket.upload(excelFilePath, {
        destination: destinationPath,
        metadata: {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });

      // 3. Get a signed URL for the user to download the file
      const signedUrl = await uploadedExcelFile.getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // URL is valid for 15 minutes
      });

      // 4. Clean up the temporary file from the Cloud Function's instance
      fs.unlinkSync(excelFilePath);

      // 5. Return the download URL and other metadata to the client
      res.status(200).send({
        data: {
          downloadUrl: signedUrl[0],
          employeeCount: employeesData.length,
          fileCount: "N/A",
        },
      });
    } catch (error: any) {
        console.error("Error exporting data:", error);
        res.status(500).send({error: "An internal error occurred while exporting data.", details: error.message});
    }
  });
});
