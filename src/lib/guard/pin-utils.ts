/**
 * PIN utility functions for Guard Self-Service Portal.
 * Uses Web Crypto SHA-256 (works in both Node.js 18+ and browser).
 */

export async function hashPin(pin: string, salt?: string): Promise<string> {
  const actualSalt = salt ?? crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const encoder = new TextEncoder();
  const data = encoder.encode(actualSalt + pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${actualSalt}:${hex}`;
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  if (!storedHash.includes(":")) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const legacyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    if (legacyHash === storedHash) return true;
  }
  const [salt] = storedHash.split(":", 2);
  const newHash = await hashPin(pin, salt);
  return newHash === storedHash;
}

export function validatePinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
