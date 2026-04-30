import { describe, expect, it } from "vitest";
import { siteBelongsToClient, sortSitesByName } from "./site-directory";

describe("site directory helpers", () => {
  it("matches by clientId", () => {
    expect(
      siteBelongsToClient({ clientId: "abc", clientName: "TCS" }, "abc", "Other"),
    ).toBe(true);
  });

  it("falls back to clientName when clientId is missing", () => {
    expect(
      siteBelongsToClient({ clientName: "TCS" }, "missing", "TCS"),
    ).toBe(true);
  });

  it("matches client names across punctuation differences", () => {
    expect(
      siteBelongsToClient({ clientName: "Anil's" }, undefined, "Anil"),
    ).toBe(true);
  });

  it("sorts sites by name", () => {
    expect(
      sortSitesByName([{ siteName: "Zulu" }, { siteName: "Alpha" } as any]).map((site) => site.siteName),
    ).toEqual(["Alpha", "Zulu"]);
  });
});
