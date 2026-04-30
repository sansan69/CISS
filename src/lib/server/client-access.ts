import type FirebaseFirestore from "@google-cloud/firestore";

import type { AppDecodedToken } from "@/lib/server/auth";

export type ResolvedClientScope = {
  clientId: string;
  clientName: string;
  stateCode: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeClientKey(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeClientMatch(value: unknown) {
  return normalizeText(value).toLowerCase();
}

export function matchesClientScope(
  record: Record<string, unknown>,
  scope: ResolvedClientScope,
) {
  const recordClientId = normalizeText(record.clientId);
  if (recordClientId && recordClientId === scope.clientId) {
    return true;
  }

  const recordClientName = normalizeClientMatch(record.clientName);
  if (recordClientName === normalizeClientMatch(scope.clientName)) {
    return true;
  }

  return normalizeClientKey(record.clientName) === normalizeClientKey(scope.clientName);
}

export async function resolveClientScope(
  adminDb: FirebaseFirestore.Firestore,
  decoded: AppDecodedToken,
): Promise<ResolvedClientScope | null> {
  const claimClientId = normalizeText(decoded.clientId);
  const claimClientName = normalizeText(decoded.clientName);
  const claimStateCode = normalizeText(decoded.stateCode) || null;

  if (claimClientId && claimClientName) {
    return {
      clientId: claimClientId,
      clientName: claimClientName,
      stateCode: claimStateCode,
    };
  }

  const mappingSnapshot = await adminDb
    .collection("clientUsersByUid")
    .doc(decoded.uid)
    .get();

  if (!mappingSnapshot.exists) {
    return null;
  }

  const data = mappingSnapshot.data() ?? {};
  const clientId = normalizeText(data.clientId);
  const clientName = normalizeText(data.clientName);
  const stateCode = normalizeText(data.stateCode) || claimStateCode;

  if (!clientId || !clientName) {
    return null;
  }

  return {
    clientId,
    clientName,
    stateCode,
  };
}
