import { describe, expect, it } from "vitest";
import {
  ADDRESS_PROOF_TYPES,
  getAddressProofTypesForIdentity,
  IDENTITY_PROOF_TYPES,
  isLngClientName,
} from "./constants";

describe("proof type options", () => {
  it("keeps identity and address proof options purpose-specific", () => {
    expect(IDENTITY_PROOF_TYPES).toEqual([
      "PAN Card",
      "Voter ID",
      "Driving License",
      "Passport",
      "School Certificate",
      "Birth Certificate",
    ]);
    expect(ADDRESS_PROOF_TYPES).toEqual([
      "Voter ID",
      "Passport",
      "Driving License",
    ]);
  });

  it("removes the selected identity proof from address options", () => {
    expect(getAddressProofTypesForIdentity("Voter ID")).toEqual([
      "Passport",
      "Driving License",
    ]);
    expect(getAddressProofTypesForIdentity("PAN Card")).toEqual([
      "Voter ID",
      "Passport",
      "Driving License",
    ]);
  });
});

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
