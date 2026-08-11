import { describe, expect, it } from "vitest";
import { isClientPortalEnabled } from "./client-options";

describe("client enrollment availability", () => {
  it("keeps clients enabled when the flag is absent for legacy records", () => {
    expect(isClientPortalEnabled({})).toBe(true);
    expect(isClientPortalEnabled({ portalEnabled: true })).toBe(true);
  });

  it("hides clients explicitly disabled by the admin", () => {
    expect(isClientPortalEnabled({ portalEnabled: false })).toBe(false);
  });
});
