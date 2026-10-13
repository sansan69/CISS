import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const PIN_HASH_VERSION = "scrypt-v1";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 32 * 1024 * 1024;
const SCRYPT_SALT_LENGTH = 16;
const BASE64_URL = /^[A-Za-z0-9_-]+$/;

export type PinVerificationResult = {
  valid: boolean;
  needsMigration: boolean;
  performedMemoryHardWork: boolean;
};

function deriveScrypt(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      pin,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(derivedKey));
      },
    );
  });
}

function constantTimeEquals(actual: Buffer, expected: Buffer): boolean {
  if (actual.length !== expected.length) {
    timingSafeEqual(actual, Buffer.alloc(actual.length));
    return false;
  }

  return timingSafeEqual(actual, expected);
}

function verifyLegacySha256(pin: string, storedHash: string): boolean {
  const hash = createHash("sha256").update(pin).digest("hex");
  return constantTimeEquals(Buffer.from(hash, "utf8"), Buffer.from(storedHash, "utf8"));
}

function verifyLegacySaltedSha256(pin: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2 || !parts[0] || !/^[a-f0-9]{64}$/i.test(parts[1])) {
    return false;
  }

  const hash = createHash("sha256").update(parts[0] + pin).digest("hex");
  return constantTimeEquals(Buffer.from(hash, "utf8"), Buffer.from(parts[1], "utf8"));
}

function parseScryptHash(storedHash: string) {
  const parts = storedHash.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== PIN_HASH_VERSION ||
    parts[1] !== String(SCRYPT_N) ||
    parts[2] !== String(SCRYPT_R) ||
    parts[3] !== String(SCRYPT_P) ||
    !BASE64_URL.test(parts[4]) ||
    !BASE64_URL.test(parts[5])
  ) {
    return null;
  }

  const salt = Buffer.from(parts[4], "base64url");
  const hash = Buffer.from(parts[5], "base64url");
  if (salt.length !== SCRYPT_SALT_LENGTH || hash.length !== SCRYPT_KEY_LENGTH) {
    return null;
  }

  return { salt, hash };
}

/** Create the current versioned, memory-hard PIN hash. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const hash = await deriveScrypt(pin, salt);
  return `${PIN_HASH_VERSION}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Verify a current or supported legacy PIN hash without exposing its format. */
export async function verifyPinWithMetadata(
  pin: string,
  storedHash: string,
): Promise<PinVerificationResult> {
  const parsedScrypt = parseScryptHash(storedHash);
  if (parsedScrypt) {
    const actual = await deriveScrypt(pin, parsedScrypt.salt);
    return {
      valid: constantTimeEquals(actual, parsedScrypt.hash),
      needsMigration: false,
      performedMemoryHardWork: true,
    };
  }

  const valid = storedHash.includes(":")
    ? verifyLegacySaltedSha256(pin, storedHash)
    : /^[a-f0-9]{64}$/i.test(storedHash) && verifyLegacySha256(pin, storedHash);

  return {
    valid,
    needsMigration: valid,
    performedMemoryHardWork: false,
  };
}

/** Compatibility wrapper for callers that only need a yes/no answer. */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  return (await verifyPinWithMetadata(pin, storedHash)).valid;
}

/**
 * Spend the same memory-hard KDF work when no usable PIN is available. This
 * narrows timing differences between unknown, inactive, unconfigured, and
 * locked accounts without revealing a stored hash.
 */
export async function verifyDummyPin(pin: string): Promise<void> {
  const derived = await deriveScrypt(
    pin,
    Buffer.from("guard-pin-dummy!", "utf8"),
  );
  constantTimeEquals(derived, Buffer.alloc(SCRYPT_KEY_LENGTH));
}

export function validatePinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
