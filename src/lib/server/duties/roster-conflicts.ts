import { isAssignedGuardMatch } from "@/lib/work-orders/assignment-match";

/**
 * A guard may hold one exam duty per date. Enforcing that rule needs the rosters
 * of the other duties on the same date — but reading `where("date", "==", …)`
 * *through* the transaction makes Firestore lock every duty on that date, so two
 * supervisors saving different centres at the same time abort each other with
 * "ABORTED: Transaction lock timeout" and the save fails.
 *
 * Instead the day's duties are read as a plain (unlocked) query, and only the
 * duties that already mention one of the guards being assigned are re-read inside
 * the transaction. The transaction then locks just the rosters that can actually
 * conflict, which keeps the rule atomic without serialising the whole date.
 */

export type RosterGuardIdentity = {
  uid: string;
  employeeId?: string;
};

export type DutySnapshotLike = {
  id: string;
  data: () => Record<string, unknown>;
};

/** Guards from [guards] that [assignedGuards] already contains, if any. */
export function findRosterConflictGuard<T extends RosterGuardIdentity>(
  assignedGuards: unknown,
  guards: T[],
): T | null {
  for (const guard of guards) {
    if (isAssignedGuardMatch(assignedGuards, guard.uid, guard.employeeId ?? "")) {
      return guard;
    }
  }
  return null;
}

/**
 * Ids of the other same-date duties that could conflict with [guards]. Only these
 * are re-read (and therefore locked) inside the assignment transaction.
 */
export function pickSameDateConflictCandidateIds<T extends RosterGuardIdentity>(
  sameDateDuties: DutySnapshotLike[],
  selfId: string,
  guards: T[],
): string[] {
  if (!guards.length) return [];
  return sameDateDuties
    .filter((duty) => duty.id !== selfId)
    .filter((duty) => findRosterConflictGuard(duty.data()?.assignedGuards, guards) !== null)
    .map((duty) => duty.id);
}
