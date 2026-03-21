/**
 * PIN utility functions for Guard Self-Service Portal.
 * Uses Web Crypto SHA-256 (works in both Node.js 18+ and browser).
 */

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const pinHash = await hashPin(pin);
  return pinHash === hash;
}

export function validatePinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
