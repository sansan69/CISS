
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as csvParser from "csv-parser";
import * as sharp from "sharp";
import * as Busboy from "busboy";
import {v4 as uuidv4} from "uuid";
import * as corsLib from "cors";
import {Timestamp} from "firebase-admin/firestore";
import * as QRCode from "qrcode";


// Initialize Firebase Admin SDK (do this once)
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket(); // Default bucket: <project-id>.appspot.com

// Configure CORS middleware
// IMPORTANT: In production, restrict the origin to your app"s actual domain(s)
const cors = corsLib({origin: true});

const runtimeOpts: functions.RuntimeOptions = {
  timeoutSeconds: 540, // 9 minutes (maximum)
  memory: "1GB", // Start with 1GB, might need 2GB for many large images
};

// Helper to generate Employee ID
const abbreviateClientName = (clientName: string): string => {
  if (!clientName) return "CLIENT";
  const upperCaseName = clientName.trim().toUpperCase();

  const abbreviations: { [key: string]: string } = {
    "TATA CONSULTANCY SERVICES": "TCS",
    "WIPRO": "WIPRO",
  };
  if (abbreviations[upperCaseName]) {
    return abbreviations[upperCaseName];
  }

  const words = upperCaseName.split(/[\s-]+/).filter((w) => w.length > 0);
  if (words.length > 1) {
    return words.map((word) => word[0]).join("");
  }

  if (upperCaseName.length <= 4) {
    return upperCaseName;
  }
  return upperCaseName.substring(0, 4);
};

const getCurrentFinancialYear = (): string => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();
  if (currentMonth >= 4) { // April or later
    return `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
  } else { // Jan, Feb, March
    return `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
  }
};

const generateEmployeeId = (clientName: string): string => {
  const shortClientName = abbreviateClientName(clientName);
  const financialYear = getCurrentFinancialYear();
  const randomNumber = Math.floor(Math.random() * 999) + 1; // 1-999
  return `CISS/${shortClientName}/${financialYear}/${randomNumber.toString().padStart(3, "0")}`;
};

const generateQrCodeDataUrl = async (employeeId: string, fullName: string, phoneNumber: string): Promise<string> => {
  const dataString = `Employee ID: ${employeeId}\nName: ${fullName}\nPhone: ${phoneNumber}`;
  try {
    const dataUrl = await QRCode.toDataURL(dataString, {
      errorCorrectionLevel: "H",
      type: "image/png",
      quality: 0.92,
      margin: 1,
      width: 256,
    });
    return dataUrl;
  } catch (err) {
    console.error("Server-side QR code generation failed:", err);
    // Return a placeholder or rethrow, depending on how critical it is.
    // For now, returning a string that indicates an error might be better than a generic placeholder.
    return `ERROR_GENERATING_QR_FOR:${encodeURIComponent(dataString)}`;
  }
};


export const processEmployeeCSV = functions
  .runWith(runtimeOpts)
  .https.onRequest((req, res) => {
    cors(req, res, async () => {
      if (req.method !== "POST") {
        res.status(405).send({success: false, message: "Method Not Allowed"});
        return;
      }

      /* eslint-disable new-cap */
      // The `new-cap` rule is disabled for this line because `Busboy` is a constructor-like function.
      const busboy = Busboy({headers: req.headers});
      /* eslint-enable new-cap */
      const employeesToProcess: Record<string, string>[] = [];
      let fileProcessingError: Error | null = null;

      busboy.on("file", (_fieldname, fileStream, MimeType) => {
        console.log(`Processing file: ${MimeType.filename}, MimeType: ${MimeType.mimeType}`);
        fileStream
          .pipe(csvParser({
            mapHeaders: ({header}: { header: string }) => header.trim(), // Trim header whitespace
            mapValues: ({value}: { value: string }) => typeof value === "string" ? value.trim() : value,
          }))
          .on("data", (row: Record<string, string>) => {
            employeesToProcess.push(row);
          })
          .on("end", () => {
            console.log(`CSV file [${MimeType.filename}] parsed. ${employeesToProcess.length} rows found.`);
            // Processing will happen in busboy.on('finish')
          })
          .on("error", (error: Error) => {
            console.error("Error parsing CSV stream:", error);
            fileProcessingError = error; // Capture error to respond later
          });
      });

      busboy.on("finish", async () => {
        if (fileProcessingError) {
          if (!res.headersSent) {
            res.status(500).json({success: false, message: `Error parsing CSV: ${fileProcessingError.message}`});
          }
          return;
        }

        if (employeesToProcess.length === 0) {
          console.log("No data rows found in CSV or file was not processed.");
          if (!res.headersSent) {
            res.status(400).json({
              success: false,
              message: "CSV contains no data rows or was not processed correctly.",
            });
          }
          return;
        }

        console.log(`Processing ${employeesToProcess.length} employee records from CSV...`);
        let recordsProcessedCount = 0;
        const processedEmployeesForFirestore = [];

        for (const emp of employeesToProcess) {
          try {
            const employeeData: Record<string, any> = {};
            // Map and validate essential fields
            employeeData.firstName = emp.first_name || "";
            employeeData.lastName = emp.last_name || "";
            employeeData.fullName = `${employeeData.firstName} ${employeeData.lastName}`.trim();
            employeeData.phoneNumber = (emp.phone_number || "").replace(/\D/g, ""); // Sanitize phone
            employeeData.emailAddress = emp.email || "";
            employeeData.clientName = emp.client_name || "Unassigned";

            // Date handling (ensure they are valid dates before converting)
            if (emp.joining_date && !isNaN(new Date(emp.joining_date).getTime())) {
              employeeData.joiningDate = Timestamp.fromDate(new Date(emp.joining_date));
            } else {
              console.warn(`Invalid or missing JoiningDate for ${employeeData.fullName}, using current date as fallback.`);
              employeeData.joiningDate = Timestamp.now(); // Fallback or handle as error
            }
            if (emp.date_of_birth && !isNaN(new Date(emp.date_of_birth).getTime())) {
              employeeData.dateOfBirth = Timestamp.fromDate(new Date(emp.date_of_birth));
            } else {
              console.warn(`Invalid or missing DateOfBirth for ${employeeData.fullName}`);
              employeeData.dateOfBirth = null;
            }

            employeeData.gender = emp.gender || "Other";
            employeeData.fatherName = emp.father_name || "";
            employeeData.motherName = emp.mother_name || "";
            employeeData.maritalStatus = emp.marital_status || "Unmarried";
            employeeData.spouseName = emp.spouse_name || ""; // Optional
            employeeData.district = emp.district || "";
            employeeData.idProofType = emp.id_proof_type || "";
            employeeData.idProofNumber = emp.id_proof_number || "";
            employeeData.bankAccountNumber = emp.bank_account_number || "";
            employeeData.ifscCode = emp.bank_ifsc_code || "";
            employeeData.bankName = emp.bank_name || "";
            employeeData.fullAddress = emp.full_address || "";

            employeeData.panNumber = emp.pan_card_number || "";
            employeeData.epfUanNumber = emp.epf_uan_number || "";
            employeeData.esicNumber = emp.esic_number || "";
            employeeData.resourceIdNumber = emp.resource_id_number || "";

            // Use phone number for subfolder, or uuid if phone is missing (should be rare)
            const safeIdentifier = employeeData.phoneNumber || uuidv4();

            // Image Handling for 'PhotoBlob'
            if (emp.PhotoBlob && typeof emp.PhotoBlob === "string" && emp.PhotoBlob.startsWith("data:image/")) {
              const matches = emp.PhotoBlob.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/i);
              if (matches && matches.length === 3) {
                // const imageMimeType = matches[1]; // e.g., image/jpeg // Not directly used, sharp infers
                const base64Data = matches[2];
                const imageBuffer = Buffer.from(base64Data, "base64");

                const imageName = `${uuidv4()}.jpg`; // Compress to JPEG
                const filePath = `employee_photos/${safeIdentifier}/${imageName}`;

                const compressedImageBuffer = await sharp(imageBuffer)
                  .resize({width: 800, height: 800, fit: "inside", withoutEnlargement: true})
                  .jpeg({quality: 75})
                  .toBuffer();

                const file = bucket.file(filePath);
                await file.save(compressedImageBuffer, {metadata: {contentType: "image/jpeg"}});

                const [url] = await file.getSignedUrl({action: "read", expires: "03-01-2500"});
                employeeData.profilePictureUrl = url;
                console.log(`Uploaded photo for ${employeeData.fullName} to ${filePath}`);
              } else {
                console.warn(
                  `Invalid Data URI format for PhotoBlob for employee: ${employeeData.fullName}`
                );
                employeeData.profilePictureUrl = null;
              }
            } else {
              employeeData.profilePictureUrl = null;
            }

            // Image Handling for 'IDProofPhotoBlob'
            if (emp.IDProofPhotoBlob &&
                typeof emp.IDProofPhotoBlob === "string" &&
                emp.IDProofPhotoBlob.startsWith("data:image/")) {
              const matches = emp.IDProofPhotoBlob.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/i);
              if (matches && matches.length === 3) {
                const base64Data = matches[2];
                const imageBuffer = Buffer.from(base64Data, "base64");
                const imageName = `${uuidv4()}.jpg`;
                const filePath = `employee_id_proofs/${safeIdentifier}/${imageName}`;

                const compressedImageBuffer = await sharp(imageBuffer)
                  .resize({width: 1024, height: 1024, fit: "inside", withoutEnlargement: true})
                  .jpeg({quality: 75})
                  .toBuffer();
                const file = bucket.file(filePath);
                await file.save(compressedImageBuffer, {metadata: {contentType: "image/jpeg"}});
                const [url] = await file.getSignedUrl({action: "read", expires: "03-01-2500"});
                employeeData.idProofDocumentUrl = url;
              } else {
                // Fallback to URL if blob invalid and URL is present in CSV
                employeeData.idProofDocumentUrl = emp.IDProofDocumentURL || null;
                console.warn(
                  `Invalid IDProofPhotoBlob format for ${employeeData.fullName}, using IDProofDocumentURL if present.`
                );
              }
            } else {
              // If only URL is provided in CSV and no blob
              employeeData.idProofDocumentUrl = emp.IDProofDocumentURL || null;
            }

            // Image Handling for 'BankPassbookPhotoBlob'
            if (emp.BankPassbookPhotoBlob &&
                typeof emp.BankPassbookPhotoBlob === "string" &&
                emp.BankPassbookPhotoBlob.startsWith("data:image/")) {
              const matches = emp.BankPassbookPhotoBlob.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/i);
              if (matches && matches.length === 3) {
                const base64Data = matches[2];
                const imageBuffer = Buffer.from(base64Data, "base64");
                const imageName = `${uuidv4()}.jpg`;
                const filePath = `employee_bank_documents/${safeIdentifier}/${imageName}`;

                const compressedImageBuffer = await sharp(imageBuffer)
                  .resize({width: 1024, height: 1024, fit: "inside", withoutEnlargement: true})
                  .jpeg({quality: 75})
                  .toBuffer();
                const file = bucket.file(filePath);
                await file.save(compressedImageBuffer, {metadata: {contentType: "image/jpeg"}});
                const [url] = await file.getSignedUrl({action: "read", expires: "03-01-2500"});
                employeeData.bankPassbookStatementUrl = url;
              } else {
                // Fallback to URL if blob invalid and URL is present in CSV
                employeeData.bankPassbookStatementUrl = emp.BankPassbookStatementURL || null;
                console.warn(
                  `Invalid BankPassbookPhotoBlob format for ${employeeData.fullName}, using BankPassbookStatementURL if present.`
                );
              }
            } else {
              // If only URL is provided in CSV and no blob
              employeeData.bankPassbookStatementUrl = emp.BankPassbookStatementURL || null;
            }


            // Generate Employee ID and QR Code URL (data for client-side generation)
            employeeData.employeeId = generateEmployeeId(employeeData.clientName);
            employeeData.qrCodeUrl = await generateQrCodeDataUrl(
              employeeData.employeeId,
              employeeData.fullName,
              employeeData.phoneNumber
            );

            employeeData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            employeeData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            employeeData.status = emp.Status || "Active";

            // Remove blob fields if they existed, as we don't store them in Firestore
            delete employeeData.PhotoBlob;
            delete employeeData.IDProofPhotoBlob;
            delete employeeData.BankPassbookPhotoBlob;

            if (employeeData.fullName && employeeData.phoneNumber) {
              processedEmployeesForFirestore.push(employeeData);
            } else {
              console.warn(`Skipping record due to missing essential data (Name/Phone): ${JSON.stringify(emp)}`);
            }
          } catch (processingError: unknown) { // Changed from 'any' to 'unknown' for better practice
            const message = (processingError instanceof Error) ?
              processingError.message :
              "Unknown error during row processing";
            console.error(`Error processing row data for CSV row ${JSON.stringify(emp)}:`, message);
            // Optionally, collect these errors to report back
          }
        }

        console.log(
          `Finished individual record processing. Attempting to save ${processedEmployeesForFirestore.length} valid records to Firestore.`
        );

        if (processedEmployeesForFirestore.length === 0) {
          if (!res.headersSent) {
            res.status(400).json({
              success: false,
              message: "No valid employee records could be processed from the CSV.",
            });
          }
          return;
        }

        // Firestore Batch Writes
        const batchSize = 400; // Firestore limit is 500 operations per batch
        for (let i = 0; i < processedEmployeesForFirestore.length; i += batchSize) {
          const batch = db.batch();
          const chunk = processedEmployeesForFirestore.slice(i, i + batchSize);
          chunk.forEach((empData) => {
            const docRef = db.collection("employees").doc(); // Auto-generate ID
            batch.set(docRef, empData);
          });
          try {
            await batch.commit();
            recordsProcessedCount += chunk.length;
            console.log(`Batch ${Math.floor(i / batchSize) + 1} committed. Total records committed so far: ${recordsProcessedCount}`);
          } catch (dbError: unknown) { // Changed from 'any' to 'unknown'
            const message = (dbError instanceof Error) ? dbError.message : "Unknown database error";
            console.error("Error committing batch to Firestore:", dbError);
            if (!res.headersSent) {
              // Corrected: Changed single quotes to double quotes
              res.status(500).json({success: false, message: `Error saving data to database: ${message}`});
            }
            return;
          }
        }

        console.log("All batches committed successfully.");
        if (!res.headersSent) {
          // Corrected: Changed single quotes to double quotes
          res.status(200).json({
            success: true,
            message: `Employee data imported successfully. ${recordsProcessedCount} records processed.`,
            recordsProcessed: recordsProcessedCount,
          });
        }
      });

      req.pipe(busboy);
    });
  });
