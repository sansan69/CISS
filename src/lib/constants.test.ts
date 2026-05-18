import { describe, expect, it } from "vitest";
import { isLngClientName } from "./constants";

describe("isLngClientName", () => {
  it.each([
    "LNG Petronet",
    "Petronet LNG",
    "Petronet LNG Limited",
    "LNG Petronet Limited",
    "Petronet LNG Ltd",
    "Petronet LNG Ltd.",
    "LNG Petronet Ltd",
    "LNG Petronet Ltd.",
  ])("recognizes LNG Petronet alias %s", (clientName) => {
    expect(isLngClientName(clientName)).toBe(true);
  });

  it("does not classify unrelated clients as LNG Petronet", () => {
    expect(isLngClientName("TCS")).toBe(false);
  });
});
