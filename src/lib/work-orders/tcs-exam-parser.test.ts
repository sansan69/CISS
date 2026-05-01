import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTcsExamWorkbook } from "./tcs-exam-parser";

function workbookFromRows(rows: unknown[][]): XLSX.WorkBook {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  return workbook;
}

describe("parseTcsExamWorkbook", () => {
  it("parses legacy single-exam sheets with a title row and male/female columns", () => {
    const workbook = workbookFromRows([
      ["Exam Name:- Central Bank of India SO Rect Exam", "16 Apr 2023"],
      ["Sl No", "District", "Site", "Male", "Female"],
      [1, "Kozhikode", "Center A", 2, 1],
      [2, "Kozhikode", "Center B", 4, 0],
    ]);

    const result = parseTcsExamWorkbook(workbook, "Adhoc Security guard requirement.xlsx");

    expect(result.parserMode).toBe("legacy-sheet");
    expect(result.suggestedExamName).toBe("Central Bank of India SO Rect Exam");
    expect(result.suggestedExamCode).toBe("central-bank-of-india-so-rect-exam");
    expect(result.dateRange).toEqual({ from: "2023-04-16", to: "2023-04-16" });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      siteName: "Center A",
      district: "Kozhikode",
      date: "2023-04-16",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
      examName: "Central Bank of India SO Rect Exam",
      examCode: "central-bank-of-india-so-rect-exam",
    });
    expect(result.siteCount).toBe(2);
    expect(result.totalMale).toBe(6);
    expect(result.totalFemale).toBe(1);
  });

  it("parses pivot date sheets with dates in row one and MALE/FEMALE row two", () => {
    const workbook = workbookFromRows([
      ["District", "Site", "15 Apr 2026", "", "16 Apr 2026", ""],
      ["District", "Site", "MALE", "FEMALE", "MALE", "FEMALE"],
      ["Kollam", "Center B", 3, 2, 4, 1],
      ["Kollam", "Center C", 0, 0, 2, 3],
    ]);

    const result = parseTcsExamWorkbook(workbook, "BITSAT Exam on 15 and 16 Apr 2026.xlsx");

    expect(result.parserMode).toBe("pivot-date-sheet");
    expect(result.suggestedExamName).toContain("BITSAT");
    expect(result.suggestedExamCode).toContain("bitsat");
    expect(result.dates).toEqual(["2026-04-15", "2026-04-16"]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      siteName: "Center B",
      district: "Kollam",
      date: "2026-04-15",
      maleGuardsRequired: 3,
      femaleGuardsRequired: 2,
    });
    expect(result.rows[1]).toMatchObject({
      siteName: "Center B",
      district: "Kollam",
      date: "2026-04-16",
      maleGuardsRequired: 4,
      femaleGuardsRequired: 1,
    });
    expect(result.rowCount).toBe(3);
    expect(result.totalMale).toBe(9);
    expect(result.totalFemale).toBe(6);
  });

  it("prefers a cleaned filename exam name when sheet title text is generic", () => {
    const workbook = workbookFromRows([
      ["STATE", "05 Nov 2025"],
      ["Sl No", "District", "Site", "Male", "Female"],
      [1, "South 2", "Center A", 2, 1],
    ]);

    const result = parseTcsExamWorkbook(
      workbook,
      "Adhoc Security Guards Requirment for TCS BPS Hiring on 06 Nov 2025.xlsx",
    );

    expect(result.suggestedExamName).toBe("TCS BPS Hiring");
    expect(result.suggestedExamCode).toBe("tcs-bps-hiring");
    expect(result.rows[0]?.examName).toBe("TCS BPS Hiring");
    expect(result.rows[0]?.examCode).toBe("tcs-bps-hiring");
  });

  it("classifies single-date pivot sheets correctly", () => {
    const workbook = workbookFromRows([
      ["District", "Site", "15 Apr 2026", ""],
      ["District", "Site", "MALE", "FEMALE"],
      ["Kollam", "Center B", 3, 2],
    ]);

    const result = parseTcsExamWorkbook(workbook, "BITSAT Exam on 15 Apr 2026.xlsx");

    expect(result.parserMode).toBe("pivot-date-sheet");
    expect(result.dates).toEqual(["2026-04-15"]);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects invalid calendar dates instead of rolling them over", () => {
    const workbook = workbookFromRows([
      ["Exam Name:- Invalid Date Example", "31/02/2026"],
      ["Sl No", "District", "Site", "Male", "Female"],
      [1, "Kozhikode", "Center A", 2, 1],
    ]);

    const result = parseTcsExamWorkbook(workbook, "Invalid Date Example.xlsx");

    expect(result.dateRange.from).toBe("");
    expect(result.dateRange.to).toBe("");
    expect(result.rows[0]?.date).toBe("");
    expect(result.warnings.some((warning) => warning.code === "missing_date")).toBe(true);
  });

  it("infers the district from address text when TCS sheets have no district column", () => {
    const workbook = workbookFromRows([
      ["STATE", "TC ADDRESS", "ZONE", "Male", "Female", "05 May 2026"],
      [
        "Kerala",
        "TCS iON Digital Zone, Kakkanad, Ernakulam",
        "South 2",
        3,
        1,
        "",
      ],
    ]);

    const result = parseTcsExamWorkbook(workbook, "Adhoc Security guard requirement.xlsx");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      siteName: "TCS iON Digital Zone, Kakkanad, Ernakulam",
      district: "Ernakulam",
      maleGuardsRequired: 3,
      femaleGuardsRequired: 1,
    });
  });

  it("does not treat a Location centre-name column as the district column", () => {
    const workbook = workbookFromRows([
      ["District", "Location", "Male", "Female", "05 May 2026"],
      ["Kozhikode", "TCS Center Location A", 2, 0, ""],
    ]);

    const result = parseTcsExamWorkbook(workbook, "BITSAT Exam on 05 May 2026.xlsx");

    expect(result.rows[0]).toMatchObject({
      siteName: "TCS Center Location A",
      district: "Kozhikode",
    });
  });
});
