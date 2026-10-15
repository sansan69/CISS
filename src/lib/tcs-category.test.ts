import { describe, expect, it } from "vitest";
import { parseTcsCategory, withTcsCategoryClientCleanup } from "./tcs-category";
import { serializeGuardProfileView, serializeFieldOfficerGuardProfileView } from "./server/guard-profile-view";

describe("effective TCS category", () => {
  it.each([
    ["TCS", "adhoc", "adhoc"], [" tCs ", "permanent", "permanent"],
    ["TCS", undefined, null], ["TCS", null, null], ["TCS", "invalid", null],
    ["TCS", "ADHOC", null], ["LNG Petronet", "adhoc", null], [null, "permanent", null],
  ])("parses %s / %s without classifying legacy records", (client, category, expected) => {
    expect(parseTcsCategory(client, category)).toBe(expected);
  });
  it.each([serializeGuardProfileView, serializeFieldOfficerGuardProfileView])("exposes only effective category in safe profiles", (serialize) => {
    expect(serialize("guard-1", { clientName: "TCS", tcsCategory: "permanent" })).toHaveProperty("tcsCategory", "permanent");
    expect(serialize("guard-1", { clientName: "TCS" })).toHaveProperty("tcsCategory", null);
    expect(serialize("guard-1", { clientName: "Other", tcsCategory: "permanent" })).toHaveProperty("tcsCategory", null);
  });
});

describe("general employee client reassignment payload", () => {
  it("removes stale category when reassigning TCS to another client and preserves general edits", () => {
    const deletion = { operation: "delete-field" };
    expect(withTcsCategoryClientCleanup(" tCs ", { clientName: "LNG Petronet", fullName: "GUARD UPDATED", status: "Active" }, deletion)).toEqual({
      clientName: "LNG Petronet", fullName: "GUARD UPDATED", status: "Active", tcsCategory: deletion,
    });
  });
  it.each([["TCS", {}], ["TCS", { clientName: " tCs " }], ["LNG Petronet", { clientName: "TCS" }], ["Other", { clientName: "LNG Petronet" }]])("does not curate category on %s edits", (previous, update) => {
    expect(withTcsCategoryClientCleanup(previous, { ...update, fullName: "UPDATED" }, "delete-field")).toEqual({ ...update, fullName: "UPDATED" });
  });
});
