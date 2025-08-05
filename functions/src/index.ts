
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import * as xlsx from "xlsx";
import * as archiver from "archiver";
import Busboy from "busboy";

// Initialize Firebase Admin SDK if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();


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
 * A callable Cloud Function to handle secure file uploads.
 * It uses the 'busboy' library to process multipart/form-data.
 */
export const uploadFile = functions.https.onCall(async (data, context) => {
  // Although this is a simple proxy, you could add more checks here,
  // e.g., for file type, size, or if the user (even unauthenticated)
  // has a valid token for this operation.
  // For now, we are keeping it open to support the public enrollment form.
  const {filePath} = data; // The destination path in the storage bucket.
  if (!filePath) {
    throw new functions.https.HttpsError("invalid-argument", "The function must be called with a 'filePath' argument.");
  }

  // This part is complex because we are streaming the raw request body
  // into busboy. `context.rawRequest` is essential here.
  const req = context.rawRequest;
  const busboy = Busboy({headers: req.headers});

  const tmpdir = os.tmpdir();
  const fileWrites: Promise<unknown>[] = [];
  let downloadUrl = "";

  return new Promise((resolve, reject) => {
    busboy.on("file", (fieldname, file,
      {filename, encoding, mimeType}) => {
      const filepath = path.join(tmpdir, filename);
      const writeStream = fs.createWriteStream(filepath);
      file.pipe(writeStream);

      const promise = new Promise((resolve, reject) => {
        file.on("end", () => {
          writeStream.end();
        });
        writeStream.on("finish", async () => {
          try {
            const bucket = admin.storage().bucket();
            const [uploadedFile] = await bucket.upload(filepath, {
              destination: filePath, // Use the path provided by the client
              metadata: {
                contentType: mimeType,
              },
            });
            // Make the file public for simplicity, or generate a signed URL
            await uploadedFile.makePublic();
            downloadUrl = uploadedFile.publicUrl();
            fs.unlinkSync(filepath); // Clean up the temp file
            resolve(true);
          } catch (err) {
            console.error("Error uploading to storage:", err);
            fs.unlinkSync(filepath);
            reject(new functions.https.HttpsError("internal", "Failed to upload file to storage."));
          }
        });
        writeStream.on("error", reject);
      });
      fileWrites.push(promise);
    });

    busboy.on("finish", async () => {
      try {
        await Promise.all(fileWrites);
        resolve({downloadUrl});
      } catch (err) {
        reject(err);
      }
    });

    // Pipe the raw request stream into busboy
    // This is the correct way to handle it with Cloud Functions v2
    if (req.body) {
      busboy.end(req.body);
    } else {
      reject(new functions.https.HttpsError("internal", "Request body is missing."));
    }
  });
});

/**
 * Exports all employee data from Firestore and their documents from Storage into a zip file.
 */
export const exportAllData = functions.runWith({timeoutSeconds: 540, memory: "1GB"})
  .https.onCall(async (data, context) => {
    // Optional: Add admin check for security
    // if (context.auth?.token.role !== "superAdmin") {
    //   throw new functions.https.HttpsError("permission-denied", "Only super admins can export data.");
    // }

    const employeesSnapshot = await db.collection("employees").get();
    if (employeesSnapshot.empty) {
      throw new functions.https.HttpsError("not-found", "No employee data to export.");
    }

    const employees = employeesSnapshot.docs.map((doc) => {
      const docData = doc.data();
      // Convert Timestamps to ISO strings for CSV
      Object.keys(docData).forEach((key) => {
        if (docData[key] instanceof admin.firestore.Timestamp) {
          docData[key] = docData[key].toDate().toISOString();
        }
      });
      return {id: doc.id, ...docData};
    });

    // 1. Create Excel file in temp directory
    const tmpdir = os.tmpdir();
    const excelFilePath = path.join(tmpdir, "employees.xlsx");
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(employees);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Employees");
    xlsx.writeFile(workbook, excelFilePath);

    // 2. Create a zip archive
    const zipFileName = `CISS_Export_${Date.now()}.zip`;
    const zipFilePath = path.join(tmpdir, zipFileName);
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver("zip", {zlib: {level: 9}});

    archive.pipe(output);
    archive.file(excelFilePath, {name: "employees.xlsx"});

    // 3. Download files from Storage and add to zip
    const bucket = storage.bucket();
    let fileCount = 0;
    for (const employee of employees) {
      const docUrls: string[] = [];
      // Collect all URL fields from the employee document
      Object.keys(employee).forEach((key) => {
        if (key.toLowerCase().includes("url") && typeof employee[key] === "string") {
          docUrls.push(employee[key]);
        }
      });

      if (docUrls.length > 0) {
        const employeeFolder = `documents/${employee.phoneNumber || employee.employeeId}/`;
        for (const url of docUrls) {
          try {
            // Extract file path from URL
            const decodedUrl = decodeURIComponent(url);
            const pathStartIndex = decodedUrl.indexOf("/o/") + 3;
            const pathEndIndex = decodedUrl.indexOf("?");
            const filePathInBucket = decodedUrl.substring(pathStartIndex, pathEndIndex);

            const tempFilePath = path.join(tmpdir, path.basename(filePathInBucket));
            await bucket.file(filePathInBucket).download({destination: tempFilePath});
            archive.file(tempFilePath, {name: `${employeeFolder}${path.basename(filePathInBucket)}`});
            fileCount++;
          } catch (err) {
            console.error(`Failed to download or add file ${url} for employee ${employee.id}. Error:`, err);
            // Continue to next file
          }
        }
      }
    }

    await archive.finalize();

    // 4. Upload the zip file to storage
    const destinationPath = `exports/${zipFileName}`;
    const [uploadedZip] = await bucket.upload(zipFilePath, {destination: destinationPath});

    // 5. Get a signed URL for download
    const signedUrl = await uploadedZip.getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    // 6. Clean up temp files
    fs.unlinkSync(excelFilePath);
    fs.unlinkSync(zipFilePath);
    // Note: Individual document temp files are deleted after being added to the archive

    return {
      downloadUrl: signedUrl[0],
      employeeCount: employees.length,
      fileCount: fileCount,
    };
  });
