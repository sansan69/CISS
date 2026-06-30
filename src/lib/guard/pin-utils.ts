import { createHash, randomUUID } from "crypto";

export function hashPin(pin: string, salt?: string): string {
  const actualSalt = salt ?? randomUUID().replace(/-/g, "").slice(0, 16);
  const hash = createHash("sha256").update(actualSalt + pin).digest("hex");
  return `${actualSalt}:${hash}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  if (!storedHash.includes(":")) {
    const legacyHash = createHash("sha256").update(pin).digest("hex");
    if (legacyHash === storedHash) return true;
  }
  const [salt] = storedHash.split(":", 2);
  const newHash = hashPin(pin, salt);
  return newHash === storedHash;
}

export function validatePinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
