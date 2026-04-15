import crypto from "crypto";

import type { Firestore } from "firebase-admin/firestore";

import { buildServerUpdateAudit } from "@/lib/server/audit";
import type { RegionCredentialInput } from "@/types/region";

const REGION_CONNECTIONS_COLLECTION = "regionConnections";

// WARNING: The encryption key is derived from REGION_CONNECTIONS_SECRET if set,
// otherwise falls back to FIREBASE_ADMIN_SDK_CONFIG_BASE64 or FIREBASE_ADMIN_PRIVATE_KEY.
// Rotating the fallback env var will make previously encrypted region connections undecryptable.
// Set REGION_CONNECTIONS_SECRET explicitly to decouple encryption from Firebase credential rotation.
function getRegionConnectionsSecret() {
  const secret =
    process.env.REGION_CONNECTIONS_SECRET ||
    process.env.FIREBASE_ADMIN_SDK_CONFIG_BASE64 ||
    process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (!secret) {
    throw new Error(
      "Region connection secret is not configured. Set REGION_CONNECTIONS_SECRET to enable persistent cross-region access.",
    );
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plainText: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getRegionConnectionsSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    cipherText: encrypted.toString("base64"),
  };
}

function decrypt(payload: { iv: string; authTag: string; cipherText: string }) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getRegionConnectionsSecret(),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.cipherText, "base64")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function normalizeServiceAccountPayload(input: Pick<RegionCredentialInput, "serviceAccountJson" | "serviceAccountBase64">) {
  const base64 = input.serviceAccountBase64?.trim();
  if (base64) {
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    return JSON.stringify(JSON.parse(decoded));
  }

  const json = input.serviceAccountJson?.trim();
  if (json) {
    return JSON.stringify(JSON.parse(json));
  }

  return null;
}

export async function saveRegionConnection(
  adminDb: Firestore,
  input: {
    regionCode: string;
    firebaseProjectId: string;
    storageBucket?: string | null;
    serviceAccountJson?: string;
    serviceAccountBase64?: string;
  },
  actor?: { uid?: string | null; email?: string | null },
) {
  const normalizedJson = normalizeServiceAccountPayload(input);
  if (!normalizedJson) {
    return null;
  }

  const encrypted = encrypt(normalizedJson);

  await adminDb.collection(REGION_CONNECTIONS_COLLECTION).doc(input.regionCode).set(
    {
      regionCode: input.regionCode,
      firebaseProjectId: input.firebaseProjectId,
      storageBucket: input.storageBucket ?? null,
      encryptedServiceAccount: encrypted,
      ...buildServerUpdateAudit(actor),
    },
    { merge: true },
  );

  return true;
}

export async function getRegionConnection(
  adminDb: Firestore,
  regionCode: string,
) {
  const snap = await adminDb.collection(REGION_CONNECTIONS_COLLECTION).doc(regionCode).get();
  if (!snap.exists) {
    return null;
  }

  const data = snap.data() as {
    firebaseProjectId: string;
    storageBucket?: string | null;
    encryptedServiceAccount?: {
      iv: string;
      authTag: string;
      cipherText: string;
    };
  };

  if (!data?.encryptedServiceAccount) {
    return null;
  }

  return {
    firebaseProjectId: data.firebaseProjectId,
    storageBucket: data.storageBucket ?? null,
    serviceAccountJson: decrypt(data.encryptedServiceAccount),
  };
}
