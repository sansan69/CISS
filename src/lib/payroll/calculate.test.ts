import { describe, expect, it } from "vitest";

import {
  applyWageComponents,
  derivePayrollTemplateFromWageConfig,
} from "./calculate";
import type { WageComponent } from "../../types/payroll";

const baseComponents: WageComponent[] = [
  {
    id: "basic",
    name: "Basic",
    type: "earning",
    calculationType: "fixed_amount",
    value: 9000,
    isStatutory: false,
    statutoryType: null,
    isTaxable: true,
    epfApplicable: true,
    order: 1,
  },
  {
    id: "hra",
    name: "HRA",
    type: "earning",
    calculationType: "pct_of_basic",
    value: 20,
    isStatutory: false,
    statutoryType: null,
    isTaxable: true,
    epfApplicable: false,
    order: 2,
  },
  {
    id: "special_allowance",
    name: "Special Allowance",
    type: "earning",
    calculationType: "fixed_amount",
    value: 3000,
    isStatutory: false,
    statutoryType: null,
    isTaxable: true,
    epfApplicable: false,
    order: 3,
  },
  {
    id: "epf",
    name: "EPF",
    type: "deduction",
    calculationType: "pct_of_epf_base",
    value: 12,
    isStatutory: true,
    statutoryType: "epf",
    isTaxable: false,
    epfApplicable: false,
    order: 4,
  },
];

describe("derivePayrollTemplateFromWageConfig", () => {
  it("derives a monthly gross and component breakdown from wage-config earnings", () => {
    const result = derivePayrollTemplateFromWageConfig(baseComponents);

    expect(result).not.toBeNull();
    expect(result?.grossMonthly).toBe(13800);
    expect(result?.componentAmounts).toEqual({
      basic: 9000,
      hra: 1800,
      special_allowance: 3000,
    });
  });

  it("returns null when no earning components can produce a monthly gross", () => {
    const noEarnings = baseComponents.map((component) => ({
      ...component,
      type: "deduction" as const,
    }));

    expect(derivePayrollTemplateFromWageConfig(noEarnings)).toBeNull();
  });

  it("keeps applyWageComponents behavior intact for explicit gross calculations", () => {
    const components: WageComponent[] = [
      baseComponents[0],
      {
        ...baseComponents[1],
        calculationType: "pct_of_basic",
        value: 40,
      },
      {
        ...baseComponents[2],
        calculationType: "balancing",
        value: null,
      },
    ];

    expect(applyWageComponents(15000, components)).toEqual({
      basic: 9000,
      hra: 3600,
      special_allowance: 2400,
    });
  });
});
