type AssignedGuardRecord = {
  uid?: string;
  employeeId?: string;
  id?: string;
};

export function isAssignedGuardMatch(
  assignedGuards: unknown,
  employeeDocId: string,
  employeeId: string,
): boolean {
  if (!Array.isArray(assignedGuards) || assignedGuards.length === 0) {
    return false;
  }

  return assignedGuards.some((guard) => {
    if (typeof guard === "string") {
      return guard === employeeDocId || guard === employeeId;
    }

    if (!guard || typeof guard !== "object") {
      return false;
    }

    const record = guard as AssignedGuardRecord;
    return (
      record.uid === employeeDocId ||
      record.uid === employeeId ||
      record.employeeId === employeeId ||
      record.employeeId === employeeDocId ||
      record.id === employeeDocId ||
      record.id === employeeId
    );
  });
}
