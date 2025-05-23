
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as csvParser from 'csv-parser';
import * as sharp from 'sharp';
import * as Busboy from 'busboy';
import { v4 as uuidv4 } from 'uuid';
import * as corsLib from 'cors';
import { Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK (do this once, will use the project's environment)
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket(); // Default bucket for the project

// Configure CORS middleware.
// Important: For production, restrict origins to your actual app domains.
// Example: const cors = corsLib({ origin: ["https://your-app-domain.com", "https://cisskerala.vercel.app"] });
const cors = corsLib({ origin: true }); // Allows all for development ease, tighten later.

const runtimeOpts: functions.RuntimeOptions = {
  timeoutSeconds: 540, // 9 minutes (maximum for HTTP functions)
  memory: '1GB',       // Start with 1GB. Increase to '2GB' if processing many large images.
};

// Helper to generate Employee ID
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
  
const generateEmployeeId = (clientName: string = "UNKNOWNCLIENT"): string => {
    const financialYear = getCurrentFinancialYear();
    const randomNumber = Math.floor(Math.random() * 1000) + 1; // 1-1000
    const sanitizedClientName = (clientName || "UNKNOWNCLIENT").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return `${sanitizedClientName}/${financialYear}/${randomNumber.toString().padStart(3, '0')}`;
};

const generateQrCodeData = (employeeId: string, fullName: string, phoneNumber: string): string => {
    // This will store the data string that the client-side qrcode library can use to generate the QR image.
    // Storing the full data URL from the server can lead to very large strings in Firestore.
    // The client-side enrollment already generates a data URL from a similar string.
    return `Employee ID: ${employeeId}\nName: ${fullName}\nPhone: ${phoneNumber}`;
};


export const processEmployeeCSV = functions
  .runWith(runtimeOpts)
  .https.onRequest((req, res) => {
    cors(req, res, async () => {
      if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method Not Allowed' });
      }

      const busboy = Busboy({ headers: req.headers });
      const employeesToProcess: any[] = [];
      let fileProcessingError: Error | null = null;

      busboy.on('file', (_fieldname, fileStream, MimeInfo) => {
        console.log(`Processing file: ${MimeInfo.filename}, MimeType: ${MimeInfo.mimeType}`);
        fileStream
          .pipe(csvParser({
            mapHeaders: ({ header }) => header.trim(), // Trim header whitespace
            mapValues: ({ value }) => typeof value === 'string' ? value.trim() : value 
          }))
          .on('data', (row: any) => {
            employeesToProcess.push(row);
          })
          .on('end', () => {
            console.log(`CSV file [${MimeInfo.filename}] parsed. ${employeesToProcess.length} rows found.`);
          })
          .on('error', (error: Error) => {
            console.error('Error parsing CSV stream:', error);
            fileProcessingError = error;
          });
      });

      busboy.on('finish', async () => {
        if (fileProcessingError) {
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: `Error parsing CSV: ${fileProcessingError.message}` });
          }
          return;
        }

        if (employeesToProcess.length === 0) {
          console.log('No data rows found in CSV or file was not processed.');
          if (!res.headersSent) {
            res.status(400).json({ success: false, message: 'CSV contains no data rows or was not processed correctly.' });
          }
          return;
        }

        console.log(`Processing ${employeesToProcess.length} employee records from CSV...`);
        let recordsProcessedCount = 0;
        const processedEmployeesForFirestore = [];

        for (const emp of employeesToProcess) {
          try {
            const employeeData: any = {};
            
            employeeData.firstName = emp.FirstName || '';
            employeeData.lastName = emp.LastName || '';
            employeeData.fullName = `${employeeData.firstName} ${employeeData.lastName}`.trim();
            employeeData.phoneNumber = (emp.PhoneNumber || '').replace(/\D/g, '');
            employeeData.emailAddress = emp.EmailAddress || '';
            employeeData.clientName = emp.ClientName || 'Unassigned';
            
            if (emp.JoiningDate && !isNaN(new Date(emp.JoiningDate).getTime())) {
                employeeData.joiningDate = Timestamp.fromDate(new Date(emp.JoiningDate));
            } else {
                console.warn(`Invalid or missing JoiningDate for ${employeeData.fullName || emp.PhoneNumber}, using current date as fallback.`);
                employeeData.joiningDate = Timestamp.now(); // Fallback or skip
            }
            if (emp.DateOfBirth && !isNaN(new Date(emp.DateOfBirth).getTime())) {
                employeeData.dateOfBirth = Timestamp.fromDate(new Date(emp.DateOfBirth));
            } else {
                console.warn(`Invalid or missing DateOfBirth for ${employeeData.fullName || emp.PhoneNumber}`);
                employeeData.dateOfBirth = null; // Or handle as error
            }

            employeeData.gender = emp.Gender || 'Other';
            employeeData.fatherName = emp.FatherName || '';
            employeeData.motherName = emp.MotherName || '';
            employeeData.maritalStatus = emp.MaritalStatus || 'Unmarried';
            employeeData.spouseName = emp.SpouseName || ''; // Will be empty if not provided
            employeeData.district = emp.District || '';
            employeeData.idProofType = emp.IDProofType || '';
            employeeData.idProofNumber = emp.IDProofNumber || '';
            employeeData.bankAccountNumber = emp.BankAccountNumber || '';
            employeeData.ifscCode = emp.IFSCCode || '';
            employeeData.bankName = emp.BankName || '';
            employeeData.fullAddress = emp.FullAddress || '';
            
            employeeData.panNumber = emp.PANNumber || '';
            employeeData.epfUanNumber = emp.EPFUANNumber || '';
            employeeData.esicNumber = emp.ESICNumber || '';
            employeeData.resourceIdNumber = emp.ResourceIDNumber || '';

            // Image Handling for 'PhotoBlob' (Profile Picture)
            if (emp.PhotoBlob && typeof emp.PhotoBlob === 'string' && emp.PhotoBlob.startsWith('data:image/')) {
              const matches = emp.PhotoBlob.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/i);
              if (matches && matches.length === 3) {
                const base64Data = matches[2];
                const imageBuffer = Buffer.from(base64Data, 'base64');
                const imageName = `${uuidv4()}.jpg`; // Compress to JPEG
                const filePath = `employee_photos/${employeeData.phoneNumber || uuidv4()}/${imageName}`;
                
                const compressedImageBuffer = await sharp(imageBuffer)
                  .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
                  .jpeg({ quality: 75 })
                  .toBuffer();

                const file = bucket.file(filePath);
                await file.save(compressedImageBuffer, { metadata: { contentType: 'image/jpeg' } });
                const [url] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' }); 
                employeeData.profilePictureUrl = url;
                console.log(`Uploaded photo for ${employeeData.fullName} to ${filePath}`);
              } else {
                console.warn(`Invalid Data URI format for PhotoBlob for employee: ${employeeData.fullName}`);
                employeeData.profilePictureUrl = null;
              }
            } else {
                employeeData.profilePictureUrl = null;
            }

            // Assuming IDProofDocumentURL and BankPassbookStatementURL are direct URLs if provided in CSV
            // If they were base64 blobs, you'd handle them similarly to PhotoBlob
            employeeData.idProofDocumentUrl = emp.IDProofDocumentURL || null;
            employeeData.bankPassbookStatementUrl = emp.BankPassbookStatementURL || null;

            employeeData.employeeId = generateEmployeeId(employeeData.clientName);
            // Store the data string for the QR code. The client-side 'qrcode' library can use this.
            employeeData.qrCodeUrl = generateQrCodeData(employeeData.employeeId, employeeData.fullName, employeeData.phoneNumber);


            employeeData.createdAt = admin.firestore.FieldValue.serverTimestamp();
            employeeData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            employeeData.status = emp.Status || 'Active';

            // Add only if essential fields are present (e.g., name and phone)
            if (employeeData.fullName && employeeData.phoneNumber) {
                 processedEmployeesForFirestore.push(employeeData);
            } else {
                console.warn(`Skipping record due to missing essential data (Name/Phone): ${JSON.stringify(emp)}`);
            }

          } catch (processingError: any) {
            console.error(`Error processing row data for CSV row ${JSON.stringify(emp)}:`, processingError.message);
          }
        }
        
        console.log(`Finished individual record processing. Attempting to save ${processedEmployeesForFirestore.length} valid records to Firestore.`);

        if (processedEmployeesForFirestore.length === 0) {
            if (!res.headersSent) {
                res.status(400).json({ success: false, message: 'No valid employee records could be processed from the CSV.' });
            }
            return;
        }
        
        const batchSize = 400; // Firestore limit is 500 operations per batch
        for (let i = 0; i < processedEmployeesForFirestore.length; i += batchSize) {
          const batch = db.batch();
          const chunk = processedEmployeesForFirestore.slice(i, i + batchSize);
          chunk.forEach((empData) => {
            const docRef = db.collection('employees').doc(); // Auto-generate ID
            batch.set(docRef, empData);
          });
          try {
            await batch.commit();
            recordsProcessedCount += chunk.length;
            console.log(`Batch ${Math.floor(i / batchSize) + 1} committed. Total records committed so far: ${recordsProcessedCount}`);
          } catch (dbError: any) {
            console.error('Error committing batch to Firestore:', dbError);
            if (!res.headersSent) {
              res.status(500).json({ success: false, message: `Error saving data to database: ${dbError.message}` });
            }
            return; 
          }
        }

        console.log("All batches committed successfully.");
        if (!res.headersSent) {
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

