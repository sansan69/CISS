import { describe, expect, it } from "vitest";
import { evaluateWageTemplate } from "./wage-template-evaluator";

describe("evaluateWageTemplate", () => {
  it("calculates per-duty earnings from constants and attendance", () => {
    const result = evaluateWageTemplate({
      constants: [
        { key: "basic_rate", label: "Basic rate", value: 10170, source: "manual" },
        { key: "standard_month_days", label: "Month days", value: 27, source: "manual" },
      ],
      rules: [
        {
          id: "basic",
          originalLabel: "Basic",
          displayLabel: "Basic",
          standardName: "basic",
          category: "earning",
          ruleType: "per_duty_rate",
          formulaSource: "manual",
          expression: "(basic_rate / standard_month_days) * payable_duties",
          dependsOn: [],
          constantKeys: ["basic_rate", "standard_month_days"],
          attendanceKey: "payable_duties",
          summaryOnly: false,
          order: 1,
        },
      ],
      attendance: { payable_duties: 27 },
    });

    expect(result.components.basic).toBe(10170);
  });

  it("calculates summary fields from prior seeded values", () => {
    const result = evaluateWageTemplate({
      constants: [],
      rules: [
        {
          id: "gross",
          originalLabel: "Gross",
          displayLabel: "Gross",
          standardName: "gross",
          category: "summary",
          ruleType: "summary_only",
          formulaSource: "manual",
          expression: "sum(earnings)",
          dependsOn: ["basic", "da"],
          constantKeys: [],
          attendanceKey: null,
          summaryOnly: true,
          order: 3,
        },
      ],
      attendance: {},
      seededComponents: { basic: 10170, da: 3796 },
    });

    expect(result.components.gross).toBe(13966);
  });
});
