import { describe, expect, it } from "vitest";
import { buildTcsExamDiff } from "./tcs-exam-diff";

describe("buildTcsExamDiff", () => {
  it("marks added, updated, unchanged, and cancelled rows in revision mode", () => {
    const diff = buildTcsExamDiff({
      parsedRows: [
        {
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
        },
        {
          siteId: "site-b",
          siteName: "Center B",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 4,
          femaleGuardsRequired: 0,
        },
        {
          siteId: "site-d",
          siteName: "Center D",
          district: "Kollam",
          date: "2026-04-16",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 1,
          femaleGuardsRequired: 1,
        },
      ],
      existingRows: [
        {
          id: "site-a_2026-04-15_bitsat",
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
          totalManpower: 3,
          recordStatus: "active",
        },
        {
          id: "site-b_2026-04-15_bitsat",
          siteId: "site-b",
          siteName: "Center B",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 3,
          femaleGuardsRequired: 1,
          totalManpower: 4,
          recordStatus: "active",
        },
        {
          id: "site-c_2026-04-15_bitsat",
          siteId: "site-c",
          siteName: "Center C",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 1,
          femaleGuardsRequired: 1,
          totalManpower: 2,
          recordStatus: "active",
        },
      ],
      mode: "revision",
    });

    const statuses = Object.fromEntries(diff.map((row) => [row.siteId ?? row.siteName, row.status]));

    expect(statuses["site-a"]).toBe("unchanged");
    expect(statuses["site-b"]).toBe("updated");
    expect(statuses["site-d"]).toBe("added");
    expect(statuses["site-c"]).toBe("cancelled");

    const cancelledRow = diff.find((row) => row.status === "cancelled");
    expect(cancelledRow).toMatchObject({
      siteId: "site-c",
      previousTotalManpower: 2,
    });
  });

  it("does not collapse rows with different siteIds when other fields match", () => {
    const diff = buildTcsExamDiff({
      parsedRows: [
        {
          siteId: "site-new",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
        },
      ],
      existingRows: [
        {
          id: "site-old_2026-04-15_bitsat",
          siteId: "site-old",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
          totalManpower: 3,
          recordStatus: "active",
        },
      ],
      mode: "revision",
    });

    expect(diff.some((row) => row.status === "added" && row.siteId === "site-new")).toBe(true);
    expect(diff.some((row) => row.status === "cancelled" && row.siteId === "site-old")).toBe(true);
    expect(diff.some((row) => row.status === "unchanged")).toBe(false);
  });

  it("keeps same siteId rows separate across different dates and exams", () => {
    const diff = buildTcsExamDiff({
      parsedRows: [
        {
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
        },
      ],
      existingRows: [
        {
          id: "site-a_2026-04-15_bitsat",
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
          totalManpower: 3,
          recordStatus: "active",
        },
        {
          id: "site-a_2026-04-16_bitsat",
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-16",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 5,
          femaleGuardsRequired: 0,
          totalManpower: 5,
          recordStatus: "active",
        },
        {
          id: "site-a_2026-04-15_nptel",
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "NPTEL",
          examCode: "nptel",
          maleGuardsRequired: 1,
          femaleGuardsRequired: 1,
          totalManpower: 2,
          recordStatus: "active",
        },
      ],
      mode: "revision",
    });

    expect(diff.some((row) => row.status === "unchanged" && row.date === "2026-04-15" && row.examCode === "bitsat")).toBe(true);
    expect(diff.some((row) => row.status === "cancelled" && row.date === "2026-04-16" && row.examCode === "bitsat")).toBe(true);
    expect(diff.some((row) => row.status === "cancelled" && row.date === "2026-04-15" && row.examCode === "nptel")).toBe(true);
    expect(diff.filter((row) => row.siteId === "site-a" && row.status === "unchanged")).toHaveLength(1);
  });

  it("matches parsed rows with siteId against fallback-only existing rows", () => {
    const diff = buildTcsExamDiff({
      parsedRows: [
        {
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
        },
      ],
      existingRows: [
        {
          id: "fallback_2026-04-15_bitsat",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
          totalManpower: 3,
          recordStatus: "active",
        },
      ],
      mode: "revision",
    });

    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      siteId: "site-a",
      status: "unchanged",
      date: "2026-04-15",
      examCode: "bitsat",
    });
  });

  it("matches parsed fallback rows against existing rows with siteId", () => {
    const diff = buildTcsExamDiff({
      parsedRows: [
        {
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
        },
      ],
      existingRows: [
        {
          id: "site-a_2026-04-15_bitsat",
          siteId: "site-a",
          siteName: "Center A",
          district: "Kollam",
          date: "2026-04-15",
          examName: "BITSAT",
          examCode: "bitsat",
          maleGuardsRequired: 2,
          femaleGuardsRequired: 1,
          totalManpower: 3,
          recordStatus: "active",
        },
      ],
      mode: "revision",
    });

    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      siteId: undefined,
      siteName: "Center A",
      status: "unchanged",
      date: "2026-04-15",
      examCode: "bitsat",
    });
  });
});
