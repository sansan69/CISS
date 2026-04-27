#!/usr/bin/env node

import { config as loadEnv } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import QRCode from "qrcode";
import XLSX from "xlsx";

const LNG_CLIENT_NAME = "LNG Petronet";
const CSV_PATH = "/Users/mymac/Downloads/LNG Petronet Enrollment Form - Form Responses 1.csv";
const BUCKET_NAME = "ciss-workforce.firebasestorage.app";
const REGION_CODE = "KL";
const FALLBACK_DISTRICT = "Ernakulam";
const CLIENT_DOC_ID = "lng-petronet";
const KERALA_DISTRICTS = [
  "Thiruvananthapuram",
  "Kollam",
  "Pathanamthitta",
  "Alappuzha",
  "Kottayam",
  "Idukki",
  "Ernakulam",
  "Thrissur",
  "Palakkad",
  "Malappuram",
  "Kozhikode",
  "Wayanad",
  "Kannur",
  "Kasaragod",
  "Lakshadweep",
];

const DISTRICT_ALIASES = new Map([
  ["trivandrum", "Thiruvananthapuram"],
  ["thiruvananthapuram", "Thiruvananthapuram"],
  ["kollam", "Kollam"],
  ["quilon", "Kollam"],
  ["pathanamthitta", "Pathanamthitta"],
  ["alappuzha", "Alappuzha"],
  ["alleppey", "Alappuzha"],
  ["kottayam", "Kottayam"],
  ["idukki", "Idukki"],
  ["ernakulam", "Ernakulam"],
  ["kochi", "Ernakulam"],
  ["cochin", "Ernakulam"],
  ["thrissur", "Thrissur"],
  ["trichur", "Thrissur"],
  ["palakkad", "Palakkad"],
  ["palghat", "Palakkad"],
  ["malappuram", "Malappuram"],
  ["kozhikode", "Kozhikode"],
  ["calicut", "Kozhikode"],
  ["wayanad", "Wayanad"],
  ["kannur", "Kannur"],
  ["cannanore", "Kannur"],
  ["kasaragod", "Kasaragod"],
  ["kasargod", "Kasaragod"],
  ["lakshadweep", "Lakshadweep"],
]);

const COLUMN = {
  timestamp: 0,
  name: 1,
  gender: 2,
  fatherName: 3,
  motherName: 4,
  dateOfBirth: 5,
  serviceBookNumberA: 6,
  serviceBookDocA: 7,
  serviceBookNumberB: 8,
  serviceBookDocB: 9,
  status: 10,
  serviceBookNumberC: 11,
  serviceBookDocC: 12,
  armsLicenseNumber: 13,
  armsLicenseDoc: 14,
  spouseName: 17,
  maritalStatus: 18,
  permanentAddress: 19,
  educationalQualification: 20,
  identificationMark: 21,
  heightCm: 22,
  weightKg: 23,
  jobDesignation: 24,
  nationality: 25,
  bankAccountNumber: 26,
  bankIfscCode: 27,
  bankName: 28,
  branchName: 29,
  passbookCopy: 30,
  mobileNumber: 31,
  epfoUanNumber: 32,
  aadharNumber: 33,
  aadharCopy: 34,
  panCardNumber: 35,
  panCardCopy: 36,
  passportPhoto: 37,
  signature: 38,
  uniqueId: 40,
};

function loadEnvironment() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    loadEnv({ path: envPath });
  } else {
    loadEnv();
  }
}

function initializeAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ciss-workforce";

  if (process.env.FIREBASE_ADMIN_PREFER_APPLICATION_DEFAULT === "true") {
    return initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      storageBucket: BUCKET_NAME,
    });
  }

  if (process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64, "base64").toString("utf8");
    return initializeApp({
      credential: cert(JSON.parse(decoded)),
      projectId: JSON.parse(decoded).project_id,
      storageBucket: BUCKET_NAME,
    });
  }

  throw new Error("Firebase Admin credentials are not configured.");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/\D/g, "").slice(-10);
}

function normalizeAadhar(value) {
  return normalizeText(value).replace(/\D/g, "").slice(0, 12);
}

function normalizePan(value) {
  return normalizeText(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeIfsc(value) {
  return normalizeText(value).replace(/\s+/g, "").toUpperCase();
}

function normalizeUniqueId(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function buildLngFallbackEmail(uniqueId, phoneNumber) {
  const token = (uniqueId || phoneNumber || randomUUID())
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return `${token}@lng-petronet.cisskerala.app`;
}

function splitFullName(rawFullName) {
  const parts = normalizeText(rawFullName)
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function parseTimestamp(value) {
  const text = normalizeText(value);
  if (!text) return new Date(0);
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function parseDate(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMetric(value) {
  const text = normalizeText(value);
  if (!text) return undefined;
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const number = Number.parseFloat(match[0]);
  return Number.isFinite(number) ? number : undefined;
}

function deriveDistrict(address) {
  const haystack = normalizeText(address).toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (const [alias, district] of DISTRICT_ALIASES.entries()) {
    if (haystack.includes(alias)) {
      return district;
    }
  }
  return FALLBACK_DISTRICT;
}

function mapGender(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === "female") return "Female";
  if (text === "other") return "Other";
  return "Male";
}

function mapMaritalStatus(value) {
  return normalizeText(value).toLowerCase() === "married" ? "Married" : "Unmarried";
}

function pickFirstNonEmpty(...values) {
  return values.map(normalizeText).find(Boolean) || "";
}

function driveFileIdFromUrl(url) {
  const text = normalizeText(url);
  if (!text) return null;
  const patterns = [
    /[?&]id=([^&]+)/,
    /\/d\/([^/]+)/,
    /\/file\/d\/([^/]+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function normalizeDriveDownloadUrl(url) {
  const fileId = driveFileIdFromUrl(url);
  return fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : "";
}

async function fetchDriveFile(url) {
  const downloadUrl = normalizeDriveDownloadUrl(url);
  if (!downloadUrl) return null;

  const response = await fetch(downloadUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 Codex LNG Import",
    },
  });

  if (!response.ok) {
    throw new Error(`Drive download failed (${response.status}) for ${downloadUrl}`);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = guessFileExtension(contentType, downloadUrl);
  return { buffer, contentType, extension };
}

function guessFileExtension(contentType, url) {
  const known = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (known[contentType]) return known[contentType];

  const pathname = new URL(url).pathname;
  const ext = extname(pathname).replace(".", "").toLowerCase();
  return ext || "bin";
}

function buildDownloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function uploadDriveDocument(bucket, sourceUrl, targetPathBase) {
  const file = await fetchDriveFile(sourceUrl);
  if (!file) return undefined;

  const token = randomUUID();
  const fullPath = `${targetPathBase}.${file.extension}`;
  await bucket.file(fullPath).save(file.buffer, {
    resumable: false,
    metadata: {
      contentType: file.contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });
  return buildDownloadUrl(bucket.name, fullPath, token);
}

async function safeUploadDriveDocument(bucket, sourceUrl, targetPathBase, label, employeeId) {
  if (!sourceUrl) return undefined;
  try {
    return await uploadDriveDocument(bucket, sourceUrl, targetPathBase);
  } catch (error) {
    console.warn(`[upload-skip] ${employeeId} · ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function buildSearchableFields(firstName, lastName, employeeId, phoneNumber) {
  const nameParts = `${firstName} ${lastName}`
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  return Array.from(new Set([...nameParts, firstName.toUpperCase(), lastName.toUpperCase(), employeeId.toUpperCase(), phoneNumber]));
}

async function generateQrCodeDataUrl(employeeId, fullName, phoneNumber) {
  return QRCode.toDataURL(`Employee ID: ${employeeId}\nName: ${fullName}\nPhone: ${phoneNumber}`, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 256,
    type: "image/png",
  });
}

function dedupeRows(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const uniqueId = normalizeUniqueId(row[COLUMN.uniqueId]);
    const aadhar = normalizeAadhar(row[COLUMN.aadharNumber]);
    const phone = normalizePhone(row[COLUMN.mobileNumber]);
    const key = aadhar || phone || uniqueId;
    if (!key) continue;

    const current = byKey.get(key);
    const candidateDate = parseTimestamp(row[COLUMN.timestamp]);
    if (!current || candidateDate >= current.timestamp) {
      byKey.set(key, { row, timestamp: candidateDate });
    }
  }

  return Array.from(byKey.values()).map((item) => item.row);
}

function mapRowToEmployee(row, sequenceNumber) {
  const legacyUniqueId = normalizeUniqueId(row[COLUMN.uniqueId]) || undefined;
  const fallbackEmployeeId = `KL/LNG/2024-26/IMPORT-${String(sequenceNumber).padStart(3, "0")}`;
  const phoneNumber = normalizePhone(row[COLUMN.mobileNumber]);
  const fullNameInput = normalizeText(row[COLUMN.name]);
  const nameParts = splitFullName(fullNameInput);
  const fullName = `${nameParts.firstName.toUpperCase()} ${nameParts.lastName.toUpperCase()}`.trim();
  const district = deriveDistrict(row[COLUMN.permanentAddress]);
  const serviceBookNumber = pickFirstNonEmpty(
    row[COLUMN.serviceBookNumberA],
    row[COLUMN.serviceBookNumberB],
    row[COLUMN.serviceBookNumberC],
  );
  const serviceBookSourceUrl = pickFirstNonEmpty(
    row[COLUMN.serviceBookDocA],
    row[COLUMN.serviceBookDocB],
    row[COLUMN.serviceBookDocC],
  );

  return {
    legacyUniqueId,
    fallbackEmployeeId,
    fullNameInput,
    firstName: nameParts.firstName.toUpperCase(),
    lastName: nameParts.lastName.toUpperCase(),
    fullName,
    phoneNumber,
    clientName: LNG_CLIENT_NAME,
    fatherName: normalizeUpper(row[COLUMN.fatherName]),
    motherName: normalizeUpper(row[COLUMN.motherName]),
    spouseName: normalizeText(row[COLUMN.spouseName]) ? normalizeUpper(row[COLUMN.spouseName]) : undefined,
    dateOfBirth: parseDate(row[COLUMN.dateOfBirth]),
    gender: mapGender(row[COLUMN.gender]),
    maritalStatus: mapMaritalStatus(row[COLUMN.maritalStatus]),
    educationalQualification: normalizeText(row[COLUMN.educationalQualification]) || undefined,
    district,
    fullAddress: normalizeUpper(row[COLUMN.permanentAddress]),
    bankAccountNumber: normalizeText(row[COLUMN.bankAccountNumber]) || undefined,
    ifscCode: normalizeIfsc(row[COLUMN.bankIfscCode]) || undefined,
    bankName: normalizeUpper(row[COLUMN.bankName]) || undefined,
    branchName: normalizeUpper(row[COLUMN.branchName]) || undefined,
    panNumber: normalizePan(row[COLUMN.panCardNumber]) || undefined,
    aadharNumber: normalizeAadhar(row[COLUMN.aadharNumber]) || undefined,
    nationality: normalizeUpper(row[COLUMN.nationality]) || "INDIAN",
    identificationMark: normalizeUpper(row[COLUMN.identificationMark]) || undefined,
    heightCm: parseMetric(row[COLUMN.heightCm]),
    weightKg: parseMetric(row[COLUMN.weightKg]),
    jobDesignation: normalizeText(row[COLUMN.jobDesignation]) || undefined,
    lngJobDesignation: normalizeText(row[COLUMN.jobDesignation]) || undefined,
    serviceBookNumber: serviceBookNumber || undefined,
    serviceBookSourceUrl: serviceBookSourceUrl || undefined,
    armsLicenseNumber: normalizeText(row[COLUMN.armsLicenseNumber]) || undefined,
    armsLicenseSourceUrl: normalizeText(row[COLUMN.armsLicenseDoc]) || undefined,
    epfUanNumber: normalizeText(row[COLUMN.epfoUanNumber]) || undefined,
    identityProofType: "Aadhar Card",
    identityProofNumber: normalizeAadhar(row[COLUMN.aadharNumber]) || "",
    addressProofType: "PAN Card",
    addressProofNumber: normalizePan(row[COLUMN.panCardNumber]) || "",
    sourceTimestamp: parseTimestamp(row[COLUMN.timestamp]),
    sourceStatus: normalizeText(row[COLUMN.status]) || undefined,
    sourceHash: createHash("sha1").update(JSON.stringify(row)).digest("hex"),
    driveUrls: {
      profilePicture: normalizeText(row[COLUMN.passportPhoto]) || undefined,
      signature: normalizeText(row[COLUMN.signature]) || undefined,
      aadharCopy: normalizeText(row[COLUMN.aadharCopy]) || undefined,
      panCopy: normalizeText(row[COLUMN.panCardCopy]) || undefined,
      passbookCopy: normalizeText(row[COLUMN.passbookCopy]) || undefined,
      serviceBook: serviceBookSourceUrl || undefined,
      armsLicense: normalizeText(row[COLUMN.armsLicenseDoc]) || undefined,
    },
  };
}

async function ensureClient(db) {
  const ref = db.collection("clients").doc(CLIENT_DOC_ID);
  const existing = await ref.get();
  const payload = {
    name: LNG_CLIENT_NAME,
    enrollmentProfile: "lng-petronet",
    supportsPublicEnrollment: true,
    jobDesignations: [
      "Ex Servicemen Security Guard - Military",
      "Ex Servicemen Security Guard - Paramilitary",
      "Supervisor",
      "Console Operator",
      "Armed Guard (Gunman) - Paramilitary",
      "Lady Security Guard",
      "Armed Guard (Gunman) - Military",
    ],
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };
  await ref.set(payload, { merge: true });
  return ref.id;
}

async function findExistingEmployeeDoc(db, employeeId, phoneNumber, emailAddress) {
  const employeeById = await db.collection("employees").where("employeeId", "==", employeeId).limit(1).get();
  if (!employeeById.empty) return employeeById.docs[0];

  const employeeByPhone = await db.collection("employees").where("phoneNumber", "==", phoneNumber).limit(1).get();
  if (!employeeByPhone.empty) return employeeByPhone.docs[0];

  const employeeByEmail = await db.collection("employees").where("emailAddress", "==", emailAddress).limit(1).get();
  if (!employeeByEmail.empty) return employeeByEmail.docs[0];

  return null;
}

async function importEmployees({ dryRun = false, limit = null }) {
  loadEnvironment();
  initializeAdmin();

  const db = getFirestore();
  const bucket = getStorage().bucket(BUCKET_NAME);

  const workbook = XLSX.readFile(CSV_PATH, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const dataRows = rows.slice(1);
  const dedupedRows = dedupeRows(dataRows);
  const targetRows = limit ? dedupedRows.slice(0, limit) : dedupedRows;
  const mappedRows = targetRows.map((row, index) => mapRowToEmployee(row, index + 1));
  const legacyIdCounts = mappedRows.reduce((acc, row) => {
    if (row.legacyUniqueId) {
      acc.set(row.legacyUniqueId, (acc.get(row.legacyUniqueId) || 0) + 1);
    }
    return acc;
  }, new Map());

  console.log(`Raw rows: ${dataRows.length}`);
  console.log(`Deduped employees: ${dedupedRows.length}`);
  console.log(`Importing: ${mappedRows.length}${dryRun ? " (dry run)" : ""}`);

  const clientId = await ensureClient(db);
  console.log(`Client ready: ${clientId} (${LNG_CLIENT_NAME})`);

  let created = 0;
  let updated = 0;

  async function processEmployee(mapped, index) {
    const duplicateLegacyIdCount = mapped.legacyUniqueId ? legacyIdCounts.get(mapped.legacyUniqueId) || 0 : 0;
    const employeeId = duplicateLegacyIdCount > 1
      ? `${mapped.legacyUniqueId}-${(mapped.phoneNumber || mapped.aadharNumber || String(index + 1)).slice(-4)}`
      : mapped.legacyUniqueId || mapped.fallbackEmployeeId;
    const emailAddress = buildLngFallbackEmail(employeeId, mapped.phoneNumber);
    const existing = await findExistingEmployeeDoc(db, employeeId, mapped.phoneNumber, emailAddress);
    const docRef = existing ? existing.ref : db.collection("employees").doc();

    let documentUrls = {
      profilePictureUrl: existing?.get("profilePictureUrl"),
      signatureUrl: existing?.get("signatureUrl"),
      identityProofUrlFront: existing?.get("identityProofUrlFront"),
      addressProofUrlFront: existing?.get("addressProofUrlFront"),
      bankPassbookStatementUrl: existing?.get("bankPassbookStatementUrl"),
      serviceBookDocumentUrl: existing?.get("serviceBookDocumentUrl"),
      armsLicenseDocumentUrl: existing?.get("armsLicenseDocumentUrl"),
    };

    if (!dryRun) {
      const employeeKey = mapped.phoneNumber || employeeId.replace(/[^A-Za-z0-9_-]/g, "_");
      const uploadedEntries = await Promise.all([
        mapped.driveUrls.profilePicture && !documentUrls.profilePictureUrl
          ? safeUploadDriveDocument(bucket, mapped.driveUrls.profilePicture, `employees/${employeeKey}/profilePictures/profile`, "profilePicture", employeeId)
          : Promise.resolve(documentUrls.profilePictureUrl),
        mapped.driveUrls.signature && !documentUrls.signatureUrl
          ? safeUploadDriveDocument(bucket, mapped.driveUrls.signature, `employees/${employeeKey}/signatures/signature`, "signature", employeeId)
          : Promise.resolve(documentUrls.signatureUrl),
        mapped.driveUrls.aadharCopy && !documentUrls.identityProofUrlFront
          ? safeUploadDriveDocument(bucket, mapped.driveUrls.aadharCopy, `employees/${employeeKey}/idProofs/aadhar-front`, "aadharCopy", employeeId)
          : Promise.resolve(documentUrls.identityProofUrlFront),
        mapped.driveUrls.panCopy && !documentUrls.addressProofUrlFront
          ? safeUploadDriveDocument(bucket, mapped.driveUrls.panCopy, `employees/${employeeKey}/addressProofs/pan-front`, "panCopy", employeeId)
          : Promise.resolve(documentUrls.addressProofUrlFront),
        mapped.driveUrls.passbookCopy && !documentUrls.bankPassbookStatementUrl
          ? safeUploadDriveDocument(bucket, mapped.driveUrls.passbookCopy, `employees/${employeeKey}/bankDocuments/passbook`, "passbookCopy", employeeId)
          : Promise.resolve(documentUrls.bankPassbookStatementUrl),
        mapped.driveUrls.serviceBook && !documentUrls.serviceBookDocumentUrl
          ? safeUploadDriveDocument(bucket, mapped.driveUrls.serviceBook, `employees/${employeeKey}/serviceBooks/service-book`, "serviceBook", employeeId)
          : Promise.resolve(documentUrls.serviceBookDocumentUrl),
        mapped.driveUrls.armsLicense && !documentUrls.armsLicenseDocumentUrl
          ? safeUploadDriveDocument(bucket, mapped.driveUrls.armsLicense, `employees/${employeeKey}/armsLicenses/arms-license`, "armsLicense", employeeId)
          : Promise.resolve(documentUrls.armsLicenseDocumentUrl),
      ]);

      documentUrls = {
        profilePictureUrl: uploadedEntries[0],
        signatureUrl: uploadedEntries[1],
        identityProofUrlFront: uploadedEntries[2],
        addressProofUrlFront: uploadedEntries[3],
        bankPassbookStatementUrl: uploadedEntries[4],
        serviceBookDocumentUrl: uploadedEntries[5],
        armsLicenseDocumentUrl: uploadedEntries[6],
      };
    }

    const now = Timestamp.now();
    const qrCodeUrl = dryRun
      ? existing?.get("qrCodeUrl") || ""
      : await generateQrCodeDataUrl(employeeId, mapped.fullName, mapped.phoneNumber);

    const payload = {
      employeeId,
      legacyUniqueId: mapped.legacyUniqueId || FieldValue.delete(),
      clientName: LNG_CLIENT_NAME,
      clientId,
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      fullName: mapped.fullName,
      fatherName: mapped.fatherName,
      motherName: mapped.motherName,
      ...(mapped.spouseName ? { spouseName: mapped.spouseName } : {}),
      dateOfBirth: mapped.dateOfBirth ? Timestamp.fromDate(mapped.dateOfBirth) : null,
      joiningDate: existing?.get("joiningDate") || now,
      gender: mapped.gender,
      maritalStatus: mapped.maritalStatus,
      educationalQualification: mapped.educationalQualification,
      district: mapped.district,
      fullAddress: mapped.fullAddress,
      emailAddress,
      phoneNumber: mapped.phoneNumber,
      status: "Active",
      stateCode: REGION_CODE,
      bankAccountNumber: mapped.bankAccountNumber || FieldValue.delete(),
      ifscCode: mapped.ifscCode || FieldValue.delete(),
      bankName: mapped.bankName || FieldValue.delete(),
      branchName: mapped.branchName || FieldValue.delete(),
      panNumber: mapped.panNumber || FieldValue.delete(),
      aadharNumber: mapped.aadharNumber || FieldValue.delete(),
      nationality: mapped.nationality || FieldValue.delete(),
      identificationMark: mapped.identificationMark || FieldValue.delete(),
      heightCm: mapped.heightCm ?? FieldValue.delete(),
      weightKg: mapped.weightKg ?? FieldValue.delete(),
      jobDesignation: mapped.jobDesignation || FieldValue.delete(),
      lngJobDesignation: mapped.lngJobDesignation || FieldValue.delete(),
      serviceBookNumber: mapped.serviceBookNumber || FieldValue.delete(),
      armsLicenseNumber: mapped.armsLicenseNumber || FieldValue.delete(),
      epfUanNumber: mapped.epfUanNumber || FieldValue.delete(),
      identityProofType: mapped.identityProofType,
      identityProofNumber: mapped.identityProofNumber,
      addressProofType: mapped.addressProofType,
      addressProofNumber: mapped.addressProofNumber,
      qrCodeUrl,
      searchableFields: buildSearchableFields(mapped.firstName, mapped.lastName, employeeId, mapped.phoneNumber),
      publicProfile: {
        fullName: mapped.fullName,
        employeeId,
        clientName: LNG_CLIENT_NAME,
        profilePictureUrl: documentUrls.profilePictureUrl || "",
        status: "Active",
      },
      importSource: "lng-petronet-google-form",
      importUpdatedAt: now,
      importRowHash: mapped.sourceHash,
      importStatus: mapped.sourceStatus || null,
      sourceTimestamp: Timestamp.fromDate(mapped.sourceTimestamp),
      updatedAt: now,
      ...(existing ? {} : { createdAt: now }),
      ...(documentUrls.profilePictureUrl ? { profilePictureUrl: documentUrls.profilePictureUrl } : {}),
      ...(documentUrls.signatureUrl ? { signatureUrl: documentUrls.signatureUrl } : {}),
      ...(documentUrls.identityProofUrlFront ? { identityProofUrlFront: documentUrls.identityProofUrlFront } : {}),
      ...(documentUrls.addressProofUrlFront ? { addressProofUrlFront: documentUrls.addressProofUrlFront } : {}),
      ...(documentUrls.bankPassbookStatementUrl ? { bankPassbookStatementUrl: documentUrls.bankPassbookStatementUrl } : {}),
      ...(documentUrls.serviceBookDocumentUrl ? { serviceBookDocumentUrl: documentUrls.serviceBookDocumentUrl } : {}),
      ...(documentUrls.armsLicenseDocumentUrl ? { armsLicenseDocumentUrl: documentUrls.armsLicenseDocumentUrl } : {}),
    };

    if (dryRun) {
      console.log(`${existing ? "UPDATE" : "CREATE"} ${employeeId} · ${mapped.fullName} · ${mapped.phoneNumber}`);
    } else {
      await docRef.set(payload, { merge: true });
    }

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }

    if ((index + 1) % 10 === 0 || index === mappedRows.length - 1) {
      console.log(`Progress: ${index + 1}/${mappedRows.length}`);
    }
  }

  const CONCURRENCY = 4;
  for (let start = 0; start < mappedRows.length; start += CONCURRENCY) {
    const chunk = mappedRows.slice(start, start + CONCURRENCY);
    await Promise.all(chunk.map((row, offset) => processEmployee(row, start + offset)));
  }

  console.log(`Completed. Created: ${created}, Updated: ${updated}`);
}

const dryRun = process.argv.includes("--dry-run");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : null;

importEmployees({ dryRun, limit: Number.isFinite(limit) ? limit : null }).catch((error) => {
  console.error("LNG import failed:", error);
  process.exit(1);
});
