import type { AppDecodedToken } from "@/lib/server/auth";

export function requireRecentAuthentication(token: AppDecodedToken, maxAgeSeconds = 5 * 60) {
  const authenticatedAt = Number(token.auth_time || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authenticatedAt || nowSeconds - authenticatedAt > maxAgeSeconds) {
    throw new Error("Recent authentication required.");
  }
  return token;
}

export async function findEmployeeById(
  db: FirebaseFirestore.Firestore,
  id: string,
) {
  const normalized = id.trim();
  if (!/^[A-Za-z0-9_\-/]{1,128}$/.test(normalized)) {
    throw new Error("Invalid employee ID.");
  }
  // Employee codes may contain slashes, but Firestore document IDs in this
  // collection may not be resolved through an attacker-controlled nested path.
  if (/^[A-Za-z0-9_-]+$/.test(normalized)) {
    const direct = await db.collection("employees").doc(normalized).get();
    if (direct.exists) return direct;
  }
  for (const field of ["employeeId", "employeeCode", "guardId"] as const) {
    const result = await db.collection("employees").where(field, "==", normalized).limit(1).get();
    if (!result.empty) return result.docs[0]!;
  }
  return null;
}
