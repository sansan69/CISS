export async function hashOtp(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(otp);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyOtp(
  inputOtp: string,
  storedHash?: string | null,
  storedPlaintext?: string | null
): Promise<boolean> {
  if (storedHash) {
    const inputHash = await hashOtp(inputOtp);
    return inputHash === storedHash;
  }
  if (storedPlaintext) {
    return inputOtp === storedPlaintext;
  }
  return false;
}
