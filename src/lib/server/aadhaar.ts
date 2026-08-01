import crypto from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { adminApp, storage } from "@/lib/firebaseAdmin";
import {
  AADHAAR_CONSENT_TEXT,
  AADHAAR_CONSENT_VERSION,
} from "@/lib/aadhaar-policy";

export { AADHAAR_CONSENT_TEXT, AADHAAR_CONSENT_VERSION };
export const AADHAAR_CONSENT_TEXT_HASH = crypto
  .createHash("sha256")
  .update(AADHAAR_CONSENT_TEXT, "utf8")
  .digest("hex");

const MAX_AADHAAR_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/pdf", "pdf"],
]);

type KmsEnvelope = {
  aadhaarNumberEncrypted: string;
  encryptionIv: string;
  encryptionTag: string;
  encryptedDataKey: string;
  encryptionKeyVersion: string;
};

type KmsApiResponse = {
  ciphertext?: string;
  plaintext?: string;
  name?: string;
  error?: { message?: string };
};

function kmsKeyName() {
  const value = process.env.AADHAAR_KMS_KEY_NAME?.trim();
  if (!value || !/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(value)) {
    throw new Error("AADHAAR_KMS_KEY_NAME is not configured correctly.");
  }
  return value;
}

async function kmsRequest(operation: "encrypt" | "decrypt", body: Record<string, string>) {
  const credential = adminApp().options.credential;
  if (!credential) throw new Error("Google credentials are unavailable for Aadhaar encryption.");
  const accessToken = await credential.getAccessToken();
  const keyName = kmsKeyName();
  const response = await fetch(
    `https://cloudkms.googleapis.com/v1/${keyName}:${operation}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as KmsApiResponse;
  if (!response.ok) {
    // Keep provider details out of API responses and logs that may be visible to users.
    throw new Error("Cloud KMS operation failed.");
  }
  return { payload, keyName };
}

export function validateAadhaarNumber(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (!/^\d{12}$/.test(normalized)) {
    throw new Error("Aadhaar number must contain exactly 12 digits.");
  }
  return normalized;
}

export function isAadhaarInfrastructureError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /AADHAAR_KMS|Cloud KMS|Google credentials|key material|KMS operation/i.test(message);
}

export async function encryptAadhaarNumber(value: string): Promise<KmsEnvelope> {
  const normalized = validateAadhaarNumber(value);
  const dataKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  try {
    const { payload, keyName } = await kmsRequest("encrypt", {
      plaintext: dataKey.toString("base64"),
    });
    if (!payload.ciphertext) throw new Error("Cloud KMS did not return encrypted key material.");
    return {
      aadhaarNumberEncrypted: encrypted.toString("base64"),
      encryptionIv: iv.toString("base64"),
      encryptionTag: tag.toString("base64"),
      encryptedDataKey: payload.ciphertext,
      encryptionKeyVersion: payload.name || keyName,
    };
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptAadhaarNumber(record: KmsEnvelope) {
  const { payload } = await kmsRequest("decrypt", {
    ciphertext: record.encryptedDataKey,
  });
  if (!payload.plaintext) throw new Error("Cloud KMS did not return key material.");
  const dataKey = Buffer.from(payload.plaintext, "base64");
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      dataKey,
      Buffer.from(record.encryptionIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(record.encryptionTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(record.aadhaarNumberEncrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return validateAadhaarNumber(decrypted);
  } finally {
    dataKey.fill(0);
  }
}

async function validateAadhaarFile(buffer: Buffer) {
  if (buffer.length === 0 || buffer.length > MAX_AADHAAR_FILE_BYTES) {
    throw new Error("Aadhaar copy must be a non-empty file no larger than 5 MB.");
  }
  const detected = await fileTypeFromBuffer(buffer);
  const extension = detected && ALLOWED_FILE_TYPES.get(detected.mime);
  if (!detected || !extension) {
    throw new Error("Aadhaar copy must be a JPEG, PNG, or PDF file.");
  }
  return { contentType: detected.mime, extension };
}

function resolveSameBucketPath(source: string) {
  const trimmed = source.trim();
  if (
    /^(enrollments|employees)\/[A-Za-z0-9_-]+\/aadharCards\/[A-Za-z0-9._-]+$/.test(trimmed) ||
    /^restrictedAadhaarStaging\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(trimmed)
  ) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Invalid Aadhaar source reference.");
  }
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") {
    throw new Error("Aadhaar source must belong to the configured Firebase Storage bucket.");
  }
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match) throw new Error("Invalid Firebase Storage Aadhaar reference.");
  const bucket = storage.bucket();
  if (decodeURIComponent(match[1]!) !== bucket.name) {
    throw new Error("Aadhaar source belongs to a different storage bucket.");
  }
  const path = decodeURIComponent(match[2]!);
  if (
    !/^(enrollments|employees)\/[A-Za-z0-9_-]+\/aadharCards\/[A-Za-z0-9._-]+$/.test(path) &&
    !/^restrictedAadhaarStaging\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(path)
  ) {
    throw new Error("Aadhaar source path is not allowed.");
  }
  return path;
}

export async function saveAadhaarStagingBuffer(args: {
  uploaderUid: string;
  buffer: Buffer;
}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(args.uploaderUid)) {
    throw new Error("Invalid uploader ID.");
  }
  const validated = await validateAadhaarFile(args.buffer);
  const storagePath = `restrictedAadhaarStaging/${args.uploaderUid}/${crypto.randomUUID()}.${validated.extension}`;
  await storage.bucket().file(storagePath).save(args.buffer, {
    resumable: false,
    metadata: {
      contentType: validated.contentType,
      cacheControl: "no-store, private, max-age=0",
      metadata: {},
    },
  });
  return storagePath;
}

export async function saveRestrictedAadhaarBuffer(args: {
  employeeDocId: string;
  buffer: Buffer;
  originalFileName: string;
}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(args.employeeDocId)) {
    throw new Error("Invalid employee document ID.");
  }
  const validated = await validateAadhaarFile(args.buffer);
  const documentId = crypto.randomUUID();
  const storagePath = `restrictedEmployeeAadhaar/${args.employeeDocId}/${documentId}.${validated.extension}`;
  await storage.bucket().file(storagePath).save(args.buffer, {
    resumable: false,
    metadata: {
      contentType: validated.contentType,
      cacheControl: "no-store, private, max-age=0",
      metadata: {},
    },
  });
  return {
    documentStoragePath: storagePath,
    originalFileName: args.originalFileName.slice(0, 255),
    contentType: validated.contentType,
  };
}

export async function moveAadhaarSourceToRestrictedStorage(args: {
  employeeDocId: string;
  source: string;
}) {
  const sourcePath = resolveSameBucketPath(args.source);
  const sourceFile = storage.bucket().file(sourcePath);
  const [exists] = await sourceFile.exists();
  if (!exists) throw new Error("Uploaded Aadhaar copy could not be found.");
  const [metadata] = await sourceFile.getMetadata();
  const [buffer] = await sourceFile.download();
  const saved = await saveRestrictedAadhaarBuffer({
    employeeDocId: args.employeeDocId,
    buffer,
    originalFileName: sourcePath.split("/").pop() || "aadhaar",
  });
  return {
    ...saved,
    sourcePath,
    sourceContentType: metadata.contentType,
  };
}

export async function deleteStorageObjectIfPresent(path: string) {
  await storage.bucket().file(path).delete({ ignoreNotFound: true });
}

export function restrictedAadhaarPaths(
  record: Record<string, unknown> | undefined,
  employeeDocId: string,
) {
  const documents = [
    record,
    ...(Array.isArray(record?.additionalDocuments)
      ? record.additionalDocuments.filter(
          (value): value is Record<string, unknown> =>
            !!value && typeof value === "object",
        )
      : []),
  ];
  const prefix = `restrictedEmployeeAadhaar/${employeeDocId}/`;
  return Array.from(new Set(documents.flatMap((document) => {
    const path = document?.documentStoragePath;
    return typeof path === "string" && path.startsWith(prefix) ? [path] : [];
  })));
}

export function documentCompletionFromEmployee(
  employee: Record<string, unknown>,
  hasRestrictedAadhaar: boolean,
) {
  const hasString = (...values: unknown[]) =>
    values.some((value) => typeof value === "string" && value.trim().length > 0);
  const aadhaar =
    hasRestrictedAadhaar || hasString(employee.aadharCardDocumentUrl, employee.aadhaarCardDocumentUrl);
  const identity = hasString(
    employee.identityProofUrlFront,
    employee.idProofFrontUrl,
    employee.idProofDocumentUrlFront,
    employee.idProofDocumentUrl,
  );
  const address = hasString(
    employee.addressProofUrlFront,
    employee.addressProofFrontUrl,
    employee.addressProofDocumentUrlFront,
  );
  return {
    aadhaar: aadhaar ? "complete" : "missing",
    identity: identity ? "complete" : "missing",
    address: address ? "complete" : "missing",
  } as const;
}
