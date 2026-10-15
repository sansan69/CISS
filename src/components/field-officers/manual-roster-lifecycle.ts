export type ManualRosterLifecycleState = {
  isSaving: boolean;
  isUnconfirmed: boolean;
  isLoadingRoster: boolean;
  hasAuthoritativeRoster: boolean;
};

export function canDismissManualRoster(state: ManualRosterLifecycleState): boolean {
  return !state.isSaving && !state.isUnconfirmed;
}

export function isManualRosterSelectionLocked(state: ManualRosterLifecycleState): boolean {
  return (
    state.isSaving ||
    state.isUnconfirmed ||
    state.isLoadingRoster ||
    !state.hasAuthoritativeRoster
  );
}

export function isCurrentRosterRead(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId;
}
