import { describe, expect, it } from "vitest";
import {
  analyzeTemplateFields,
  detectHeaderRow,
  inferSheetFamily,
} from "./wage-template-parser";

describe("wage-template parser", () => {
  it("detects flat register headers from first row", () => {
    const rows = [
      ["Sl No", "Name of the guard", "DUTIES", "Basic", "DA", "Gross", "PF", "ESI", "Net Wages"],
      ["1", "ANIL", "27", "10170", "4160", "14330", "1800", "108", "12422"],
    ];

    expect(detectHeaderRow(rows)).toBe(0);
    expect(inferSheetFamily(rows, 0)).toBe("flat_register");
  });

  it("detects title-row sheet header below title rows", () => {
    const rows = [
      ["CISS SERVICES LTD"],
      ["LOGIWARE SYSTEMS AND SOLUTIONS"],
      ["SALARY REGISTER FOR THE MONTH OF MAR-2026"],
      [],
      ["SL.NO", "NAME", "DUTIES", "W/0", "ED", "WD", "BASIC&DA", "EXTRA 4 HRS", "W.ALL", "GROSS", "P.F.", "ESI"],
      ["1", "JAYAKUMAR V", "1", "", "", "=K6+M6", "=SUM(14746/27*N6)", "=SUM(3834/27)*N6", "", "=SUM(O6:V6)", "=SUM(15000/27*K6*12/100)", "=(O6+P6+Q6)*0.75%"],
    ];

    expect(detectHeaderRow(rows)).toBe(4);
    expect(inferSheetFamily(rows, 4)).toBe("title_row_register");
  });

  it("captures both header meaning and cell formula evidence", () => {
    const rows = [
      ["SL NO.", "NAME", "NO.OF DUTIES", "BASIC+VDA (1187.69)", "HRA(16% of Basic + DA)", "EPF (12% of Basic + VDA capped at 15,000)"],
      ["1", "ARAVINDAKSHAN", "23", "=E2*1187.69", "=SUM(D2*16/100)", "=69.23*E2"],
    ];

    const fields = analyzeTemplateFields(rows, 0);
    const hra = fields.find((field) => field.originalLabel.includes("HRA"));
    const epf = fields.find((field) => field.originalLabel.startsWith("EPF"));
    const duties = fields.find((field) => field.originalLabel === "NO.OF DUTIES");

    expect(inferSheetFamily(rows, 0)).toBe("formula_heavy_register");
    expect(hra?.formulaSources).toContain("header");
    expect(hra?.formulaSources).toContain("cell");
    expect(epf?.ruleHint).toMatch(/cap|15000/i);
    expect(epf?.detectedConstants.some((constant) => constant.value === 15000)).toBe(true);
    expect(duties?.category).toBe("attendance");
    expect(duties?.attendanceBound).toBe(true);
  });
});
