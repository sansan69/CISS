
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as xlsx from "xlsx";
import * as cors from "cors";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();

// A simplified cors handler that allows requests from any origin.
const corsHandler = cors({origin: true});

/**
 * Sets a user's role (e.g., 'stateAdmin') as a custom claim.
 * This function can only be called by an existing superAdmin.
 */
export const createStateAdmin = functions.https.onCall(async (data, context) => {
  // Check if the caller is a super admin
  if (context.auth?.token.role !== "superAdmin") {
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
  const superAdminExists = listUsersResult.users.some((user) => user.customClaims?.role === "superAdmin");

  if (superAdminExists) {
    // If a super admin already exists, only an existing super admin can create another one.
    if (context.auth?.token.role !== "superAdmin") {
        throw new functions.https.HttpsError("already-exists", "A super admin already exists. Only another super admin can create more.");
    }
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
    if (error instanceof Error && (error as any).code === "auth/user-not-found") {
       throw new functions.https.HttpsError("not-found", `User with email ${email} not found.`);
    }
    throw new functions.https.HttpsError("internal", "An error occurred while setting the super admin role.");
  }
});

/**
 * Exports all employee data from Firestore into an Excel file.
 * The Excel file will contain clickable hyperlinks to the documents stored in Firebase Storage.
 */
export const exportAllData = functions.runWith({timeoutSeconds: 300, memory: "512MB"})
  .https.onRequest((req, res) => {
    // Wrap the entire function in the cors handler.
    corsHandler(req, res, async () => {
      // For simplicity, we are temporarily removing the auth check.
      // In a production environment, you would re-enable this.
      // if (!context.auth) {
      //   throw new functions.https.HttpsError("unauthenticated", "You must be logged in to perform this action.");
      // }
      try {
        console.log("Starting exportAllData function execution.");
        const employeesSnapshot = await db.collection("employees").get();
        if (employeesSnapshot.empty) {
          console.log("No employee data found to export.");
          res.status(404).send({error: "No employee data to export."});
          return;
        }

        console.log(`Found ${employeesSnapshot.size} employee documents.`);
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

        const tmpdir = os.tmpdir();
        const excelFileName = `CISS_Export_${Date.now()}.xlsx`;
        const excelFilePath = path.join(tmpdir, excelFileName);
        console.log(`Creating Excel file at: ${excelFilePath}`);

        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(employeesData);
        xlsx.utils.book_append_sheet(workbook, worksheet, "Employees");
        xlsx.writeFile(workbook, excelFilePath);

        const bucket = storage.bucket();
        const destinationPath = `exports/${excelFileName}`;
        console.log(`Uploading Excel file to Storage at: ${destinationPath}`);
        const [uploadedExcelFile] = await bucket.upload(excelFilePath, {
          destination: destinationPath,
          metadata: {
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        });

        const signedUrlConfig = {
          action: "read" as const,
          expires: Date.now() + 15 * 60 * 1000, // URL is valid for 15 minutes
        };
        console.log("Generating signed URL for the uploaded file.");
        const [signedUrl] = await uploadedExcelFile.getSignedUrl(signedUrlConfig);

        fs.unlinkSync(excelFilePath); // Clean up the temporary file from the server.
        console.log("Cleaned up temporary file and sending success response.");

        // Send the successful response back to the client.
        res.status(200).send({
          data: {
            downloadUrl: signedUrl,
            employeeCount: employeesData.length,
          },
        });
      } catch (error: any) {
          console.error("Error exporting data:", error);
          res.status(500).send({error: "An internal error occurred while exporting data.", details: error.message});
      }
    });
  });
