const SAFE_PATH = /^[A-Za-z0-9._-]+$/;

type EnrollmentDocumentContext = {
  bucketName: string;
  flow: "public" | "admin";
  draftId?: string;
  phoneNumber: string;
};

function decodeFirebaseStorageUrl(reference: string, bucketName: string) {
  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "firebasestorage.googleapis.com") return null;
  const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
  if (!match || decodeURIComponent(match[1]!) !== bucketName) return null;
  return decodeURIComponent(match[2]!);
}

export function resolveEnrollmentStoragePath(reference: string, bucketName: string) {
  const trimmed = reference.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("https://")) return decodeFirebaseStorageUrl(trimmed, bucketName);
  return trimmed;
}

export function isAllowedEnrollmentStoragePath(
  path: string,
  folder: string,
  context: EnrollmentDocumentContext,
) {
  const segments = path.split("/");
  if (segments.length !== 4 || segments[2] !== folder || !SAFE_PATH.test(segments[3]!)) return false;
  if (context.flow === "public") {
    return segments[0] === "enrollments" && segments[1] === context.draftId;
  }
  return segments[0] === "employees" && segments[1] === context.phoneNumber;
}

export async function assertEnrollmentStorageFile(
  reference: unknown,
  label: string,
  folder: string,
  context: EnrollmentDocumentContext,
  bucket: { file: (path: string) => { exists: () => Promise<[boolean]> } },
) {
  if (typeof reference !== "string") throw new Error(`${label} is required.`);
  const path = resolveEnrollmentStoragePath(reference, context.bucketName);
  if (!path || !isAllowedEnrollmentStoragePath(path, folder, context)) {
    throw new Error(`${label} must be uploaded through the enrollment form.`);
  }
  const [exists] = await bucket.file(path).exists();
  if (!exists) throw new Error(`${label} could not be found. Upload it again.`);
  return path;
}

export async function assertEnrollmentDocumentReferences(
  payload: Record<string, unknown>,
  context: EnrollmentDocumentContext,
  bucket: { file: (path: string) => { exists: () => Promise<[boolean]> } },
) {
  const required = [
    ["profilePictureUrl", "Profile picture", "profilePictures"],
    ["identityProofUrlFront", "Identity proof front", "idProofs"],
    ["identityProofUrlBack", "Identity proof back", "idProofs"],
    ["addressProofUrlFront", "Address proof front", "addressProofs"],
    ["addressProofUrlBack", "Address proof back", "addressProofs"],
    ["signatureUrl", "Signature", "signatures"],
  ] as const;
  for (const [key, label, folder] of required) {
    await assertEnrollmentStorageFile(payload[key], label, folder, context, bucket);
  }

  const optional = [
    ["serviceBookDocumentUrl", "Service book document", "serviceBooks"],
    ["armsLicenseDocumentUrl", "Arms license document", "armsLicenses"],
    ["passportDocumentUrl", "Passport document", "passports"],
    ["panCardDocumentUrl", "PAN card copy", "panCards"],
    ["bankPassbookStatementUrl", "Bank document", "bankDocuments"],
    ["policeClearanceCertificateUrl", "Police clearance certificate", "policeCertificates"],
  ] as const;
  for (const [key, label, folder] of optional) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") {
      await assertEnrollmentStorageFile(payload[key], label, folder, context, bucket);
    }
  }
}
