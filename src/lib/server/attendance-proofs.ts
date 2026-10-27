import type { AttendanceVerificationTokenPayload } from "@/lib/server/attendance-verification-token";

/**
 * Single-use store for attendance identity proofs.
 *
 * A proof token is a bearer credential: whoever holds it can submit one
 * attendance event for the named guard. The token already expires after ten
 * minutes; this store additionally makes each nonce usable exactly once, so a
 * captured token cannot create a second event or be replayed by another
 * submission path.
 *
 * Documents are server-only (no client rule) and carry `expireAt` for a
 * Firestore TTL policy; used proofs are deleted immediately on consumption.
 */
const PROOFS_COLLECTION = "attendanceVerificationProofs";

export async function registerAttendanceProof(
  payload: AttendanceVerificationTokenPayload,
): Promise<boolean> {
  try {
    const { db } = await import("@/lib/firebaseAdmin");
    const { Timestamp } = await import("firebase-admin/firestore");
    await db.collection(PROOFS_COLLECTION).doc(payload.nonce).set({
      employeeDocId: payload.employeeDocId,
      method: payload.method,
      actorUid: payload.actorUid ?? null,
      createdAt: Timestamp.now(),
      expireAt: Timestamp.fromMillis(payload.exp * 1000),
    });
    return true;
  } catch (error) {
    console.error(
      "[attendance-proofs] Could not register proof",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Validate and burn a proof nonce. The identity binding (subject + actor) must
 * match the submission; a mismatch is treated as an invalid proof and the entry
 * is removed so it cannot be retried.
 */
/**
 * Consume a proof inside an existing Firestore transaction.
 *
 * Reads must happen before any writes in the caller's transaction; the boolean
 * is false when the proof is absent or bound to another actor/subject. A caller
 * should throw on false so the whole transaction aborts and no attendance is
 * written.
 */
export async function consumeAttendanceProofInTransaction(
  transaction: FirebaseFirestore.Transaction,
  input: {
    nonce: string;
    employeeDocId: string;
    actorUid: string | null;
  },
): Promise<boolean> {
  const { db } = await import("@/lib/firebaseAdmin");
  const ref = db.collection(PROOFS_COLLECTION).doc(input.nonce);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) return false;

  const data = snapshot.data() as Record<string, unknown>;
  const boundEmployee =
    typeof data.employeeDocId === "string" ? data.employeeDocId : "";
  const boundActor =
    typeof data.actorUid === "string" && data.actorUid ? data.actorUid : null;
  if (boundEmployee !== input.employeeDocId || boundActor !== input.actorUid) {
    transaction.delete(ref);
    return false;
  }

  transaction.delete(ref);
  return true;
}

export async function consumeAttendanceProof(input: {
  nonce: string;
  employeeDocId: string;
  actorUid: string | null;
}): Promise<boolean> {
  try {
    const { db } = await import("@/lib/firebaseAdmin");
    const ref = db.collection(PROOFS_COLLECTION).doc(input.nonce);

    return await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;

      const data = snapshot.data() as Record<string, unknown>;
      const boundEmployee = typeof data.employeeDocId === "string" ? data.employeeDocId : "";
      const boundActor =
        typeof data.actorUid === "string" && data.actorUid ? data.actorUid : null;

      if (boundEmployee !== input.employeeDocId || boundActor !== input.actorUid) {
        transaction.delete(ref);
        return false;
      }

      transaction.delete(ref);
      return true;
    });
  } catch (error) {
    console.error(
      "[attendance-proofs] Could not consume proof",
      error instanceof Error ? error.message : error,
    );
    // Fail closed: an unverifiable proof must not authorize a write.
    return false;
  }
}
