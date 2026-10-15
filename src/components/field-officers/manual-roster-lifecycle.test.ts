import { describe, expect, it } from "vitest";
import {
  canDismissManualRoster,
  isCurrentRosterRead,
  isManualRosterSelectionLocked,
} from "./manual-roster-lifecycle";

const ready = {
  isSaving: false,
  isUnconfirmed: false,
  isLoadingRoster: false,
  hasAuthoritativeRoster: true,
};

describe("manual roster dialog lifecycle", () => {
  it("keeps every dismissal route closed while a request is saving or unconfirmed", () => {
    expect(canDismissManualRoster({ ...ready, isSaving: true })).toBe(false);
    expect(canDismissManualRoster({ ...ready, isUnconfirmed: true })).toBe(false);
    expect(canDismissManualRoster(ready)).toBe(true);
  });

  it("locks selector and removal controls until the authoritative roster is ready", () => {
    expect(isManualRosterSelectionLocked({ ...ready, isLoadingRoster: true })).toBe(true);
    expect(isManualRosterSelectionLocked({ ...ready, hasAuthoritativeRoster: false })).toBe(true);
    expect(isManualRosterSelectionLocked(ready)).toBe(false);
    expect(isManualRosterSelectionLocked({ ...ready, isUnconfirmed: true })).toBe(true);
  });

  it("only accepts the newest overlapping roster read", () => {
    expect(isCurrentRosterRead(2, 2)).toBe(true);
    expect(isCurrentRosterRead(1, 2)).toBe(false);
  });
});
