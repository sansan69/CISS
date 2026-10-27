import type { Firestore } from "firebase-admin/firestore";

/**
 * Guard PIN material is being moved off the broadly readable `employees`
 * document into a server-only collection. Phase 1 (this change) mirrors every
 * write, so the new store is complete before any reader is switched:
 *
 *   1. mirror + migration  — both stores hold the hash (current step)
 *   2. flip readers        — login/change/setup verify from `guardCredentials`
 *   3. remove the fields   — drop `guardPin`/`guardPinSetAt` from `employees`
 *
 * Doing it in this order keeps guard login working across the deployment and
 * makes the removal reversible by re-running the migration.
 */
const GUARD_CREDENTIALS_COLLECTION = "guardCredentials";

export async function mirrorGuardPin(
  firestore: Firestore,
  employeeDocId: string,
  guardPin: string,
  guardPinSetAt: Date = new Date(),
): Promise<boolean> {
  try {
    await firestore
      .collection(GUARD_CREDENTIALS_COLLECTION)
      .doc(employeeDocId)
      .set(
        {
          guardPin,
          guardPinSetAt,
          updatedAt: new Date(),
        },
        { merge: true },
      );
    return true;
  } catch (error) {
    // Never fail the user-facing PIN flow because the mirror write failed: the
    // employee document remains authoritative until phase 2.
    console.error(
      "[guard-credentials] mirror write failed",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
