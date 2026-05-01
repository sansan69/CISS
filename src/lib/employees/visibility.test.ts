import { describe, expect, it } from "vitest";
import {
  employeeMatchesAnyDistrict,
  resolveEmployeeDistrict,
} from "./visibility";

describe("employee visibility district resolution", () => {
  it("uses legacy districtName when older employee docs do not have district", () => {
    expect(
      employeeMatchesAnyDistrict(
        { districtName: "Trivandrum District" },
        ["Thiruvananthapuram"],
      ),
    ).toBe(true);
  });

  it("infers district from legacy address-only employee docs", () => {
    expect(
      resolveEmployeeDistrict({
        fullAddress: "House 12, Kakkanad, Kerala",
      }),
    ).toBe("Ernakulam");
  });

  it("canonicalizes aliases before exposing the employee district", () => {
    expect(resolveEmployeeDistrict({ district: "Cochin" })).toBe("Ernakulam");
  });
});
