import { describe, expect, it } from "vitest";

import {
  countGuardAssignments,
  getGuardAssignmentCapacityIssue,
} from "./guard-assignment-capacity";

describe("guard assignment capacity", () => {
  it("counts gender values without depending on capitalization", () => {
    expect(
      countGuardAssignments([
        { gender: "Male" },
        { gender: " male " },
        { gender: "FEMALE" },
      ]),
    ).toEqual({ male: 2, female: 1 });
  });

  it("prevents selecting more guards than the work-order requirement", () => {
    expect(
      getGuardAssignmentCapacityIssue(
        [{ gender: "Male" }],
        "male",
        { maleGuardsRequired: 1, femaleGuardsRequired: 2 },
      ),
    ).toEqual(
      expect.objectContaining({
        title: "Male requirement already filled",
      }),
    );
  });

  it("allows a guard while capacity remains", () => {
    expect(
      getGuardAssignmentCapacityIssue(
        [{ gender: "Female" }],
        "female",
        { maleGuardsRequired: 1, femaleGuardsRequired: 2 },
      ),
    ).toBeNull();
  });

  it("requires a usable gender before assignment", () => {
    expect(
      getGuardAssignmentCapacityIssue([], "", {
        maleGuardsRequired: 1,
        femaleGuardsRequired: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        title: "Gender information required",
      }),
    );
  });
});
