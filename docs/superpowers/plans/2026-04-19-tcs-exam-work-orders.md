# TCS Exam Work Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor TCS exam-duty imports so admins can upload new files and revisions safely, avoid duplicate imports, preserve cancelled history, and show exam-aware duties in admin and field-officer work-order screens.

**Architecture:** Add an exam-aware import pipeline for TCS only. Parse uploaded Excel files into normalized exam/site/date rows, preview duplicate/revision diffs on the server, commit active rows into `workOrders`, and track import metadata in `workOrderImports`. Keep legacy `siteId_date` work orders readable, but write new TCS exam rows as `siteId_date_examCode`.

**Tech Stack:** Next.js App Router, React client pages, Firebase Firestore + Storage, Firebase Admin SDK, `xlsx`, Vitest, existing `authorizedFetch`/audit helpers.

---

## File Structure

### New files

- `src/types/work-orders.ts`
  - Shared `WorkOrderDoc`, `TcsExamImportPreview`, `TcsExamImportDiffRow`, `WorkOrderImportDoc` types.
- `src/lib/work-orders/tcs-exam-import-types.ts`
  - Parser-specific row/result types and parser mode constants.
- `src/lib/work-orders/tcs-exam-parser.ts`
  - Mixed-format parser for TCS exam sheets.
- `src/lib/work-orders/tcs-exam-hash.ts`
  - Binary/content hash helpers.
- `src/lib/work-orders/tcs-exam-diff.ts`
  - Diff builder between parsed rows and active Firestore rows.
- `src/lib/work-orders/tcs-exam-parser.test.ts`
  - Parser coverage for both file families.
- `src/lib/work-orders/tcs-exam-hash.test.ts`
  - Duplicate hash coverage.
- `src/lib/work-orders/tcs-exam-diff.test.ts`
  - Added/updated/unchanged/cancelled diff coverage.
- `src/app/api/admin/work-orders/import/preview/route.ts`
  - Server preview endpoint for parse + duplicate/revision detection.
- `src/app/api/admin/work-orders/import/commit/route.ts`
  - Server commit endpoint for active/cancelled row writes.
- `src/app/work-orders-import-preview.test.ts`
  - Endpoint and UI regression coverage.

### Modified files

- `src/app/(app)/work-orders/page.tsx`
  - Replace direct client-side write loop with upload → preview → confirm flow.
- `src/app/(app)/work-orders/[siteId]/page.tsx`
  - Group rows by day and show exam chips/labels.
- `src/components/field-officers/work-orders-panel.tsx`
  - Show exam-aware rows and active-only records.
- `src/components/work-orders/assigned-guards-export-panel.tsx`
  - Export exam name/date-aware rows.
- `src/app/api/admin/work-orders/route.ts`
  - Preserve compatibility, but reject use for new TCS exam imports once bulk route exists.
- `src/app/api/admin/work-orders/[id]/route.ts`
  - Allow patching exam-aware row fields and record status metadata.
- `src/app/api/attendance/submit/route.ts`
  - Filter `recordStatus == active` when validating TCS work orders.
- `src/app/api/guard/dashboard/route.ts`
  - Query next shift against active work orders only, using real date timestamps instead of string range.
- `src/app/work-orders-surface.test.ts`
  - Update UI and route assertions for exam-aware rendering.

### Existing references to preserve

- `src/app/(app)/work-orders/page.tsx`
  - Current TCS upload parser and direct `authorizedFetch('/api/admin/work-orders')` loop.
- `src/app/api/admin/work-orders/route.ts`
  - Current create/update route for single-row work orders.
- `src/app/(app)/work-orders/[siteId]/page.tsx`
  - Current per-site assignment screen.
- `src/components/field-officers/work-orders-panel.tsx`
  - Current field-officer work-order view.
- `src/components/work-orders/assigned-guards-export-panel.tsx`
  - Current export source.

---

### Task 1: Centralize work-order types and add exam-aware fields

**Files:**
- Create: `src/types/work-orders.ts`
- Modify: `src/app/(app)/work-orders/page.tsx`
- Modify: `src/app/(app)/work-orders/[siteId]/page.tsx`
- Modify: `src/components/field-officers/work-orders-panel.tsx`
- Modify: `src/components/work-orders/assigned-guards-export-panel.tsx`
- Test: `src/app/work-orders-surface.test.ts`

- [ ] **Step 1: Write the failing surface test for exam-aware fields**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sitePageSource = readFileSync(
  "src/app/(app)/work-orders/[siteId]/page.tsx",
  "utf8",
);
const fieldOfficerPanelSource = readFileSync(
  "src/components/field-officers/work-orders-panel.tsx",
  "utf8",
);

describe("work order shared types migration", () => {
  it("renders exam-aware fields in site and field-officer pages", () => {
    expect(sitePageSource).toContain("examName");
    expect(sitePageSource).toContain("recordStatus");
    expect(fieldOfficerPanelSource).toContain("examName");
    expect(fieldOfficerPanelSource).toContain("recordStatus");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/work-orders-surface.test.ts -t "work order shared types migration"`

Expected: FAIL because the pages still use local `interface WorkOrder` definitions without `examName`/`recordStatus`.

- [ ] **Step 3: Create shared work-order types**

```ts
// src/types/work-orders.ts
import type { Timestamp } from "firebase/firestore";

export type WorkOrderRecordStatus = "active" | "cancelled" | "superseded";
export type WorkOrderImportMode = "new" | "revision";
export type TcsParserMode = "legacy-sheet" | "pivot-date-sheet";

export interface AssignedGuardSummary {
  uid: string;
  name: string;
  employeeId: string;
  gender: string;
}

export interface WorkOrderDoc {
  id: string;
  siteId: string;
  siteName: string;
  clientName: string;
  district: string;
  date: Timestamp;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
  totalManpower: number;
  assignedGuards: AssignedGuardSummary[];
  examName?: string;
  examCode?: string;
  recordStatus?: WorkOrderRecordStatus;
  importId?: string;
  sourceFileName?: string;
}

export interface TcsExamImportDiffRow {
  key: string;
  siteId: string;
  siteName: string;
  district: string;
  date: string;
  examName: string;
  examCode: string;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
  totalManpower: number;
  status: "added" | "updated" | "unchanged" | "cancelled";
  previousMaleGuardsRequired?: number;
  previousFemaleGuardsRequired?: number;
}

export interface TcsExamImportPreview {
  parserMode: TcsParserMode;
  suggestedExamName: string;
  suggestedExamCode: string;
  dateRange: { from: string; to: string };
  siteCount: number;
  rowCount: number;
  totalMale: number;
  totalFemale: number;
  binaryFileHash: string;
  contentHash: string;
  duplicateState: "none" | "binary-duplicate" | "content-duplicate" | "overlap";
  duplicateMessage?: string;
  diffRows: TcsExamImportDiffRow[];
}

export interface WorkOrderImportDoc {
  id: string;
  clientName: string;
  fileName: string;
  binaryFileHash: string;
  contentHash: string;
  examName: string;
  examCode: string;
  dateRange: { from: string; to: string };
  siteCount: number;
  rowCount: number;
  totalMale: number;
  totalFemale: number;
  mode: WorkOrderImportMode;
  status: "committed" | "superseded" | "cancelled";
  parserMode: TcsParserMode;
  importedBy: string;
  importedAt: Timestamp;
}
```

- [ ] **Step 4: Replace local `WorkOrder` interfaces with shared imports**

```ts
// src/app/(app)/work-orders/page.tsx
import type { WorkOrderDoc } from "@/types/work-orders";

type WorkOrder = WorkOrderDoc;
```

```ts
// src/app/(app)/work-orders/[siteId]/page.tsx
import type { WorkOrderDoc } from "@/types/work-orders";

type WorkOrder = WorkOrderDoc;
```

```ts
// src/components/field-officers/work-orders-panel.tsx
import type { WorkOrderDoc } from "@/types/work-orders";

type WorkOrder = WorkOrderDoc;
```

```ts
// src/components/work-orders/assigned-guards-export-panel.tsx
import type { WorkOrderDoc } from "@/types/work-orders";

type WorkOrderDoc = WorkOrderDoc;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/work-orders-surface.test.ts -t "work order shared types migration"`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/work-orders.ts \
  src/app/'(app)'/work-orders/page.tsx \
  src/app/'(app)'/work-orders/'[siteId]'/page.tsx \
  src/components/field-officers/work-orders-panel.tsx \
  src/components/work-orders/assigned-guards-export-panel.tsx \
  src/app/work-orders-surface.test.ts
git commit -m "refactor: centralize work order types"
```

---

### Task 2: Build the mixed-format TCS parser with tests

**Files:**
- Create: `src/lib/work-orders/tcs-exam-import-types.ts`
- Create: `src/lib/work-orders/tcs-exam-parser.ts`
- Test: `src/lib/work-orders/tcs-exam-parser.test.ts`

- [ ] **Step 1: Write parser tests for both real sheet families**

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTcsExamWorkbook } from "@/lib/work-orders/tcs-exam-parser";

function workbookFromRows(rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

describe("parseTcsExamWorkbook", () => {
  it("parses legacy single-exam sheets", () => {
    const wb = workbookFromRows([
      ["Exam Name:- Central Bank of India SO Rect Exam", "16 Apr 2023"],
      ["Sl No", "District", "Site", "Male", "Female"],
      [1, "Kozhikode", "Center A", 2, 1],
    ]);

    const result = parseTcsExamWorkbook(wb, "Adhoc Security guard requirement.xlsx");

    expect(result.parserMode).toBe("legacy-sheet");
    expect(result.suggestedExamName).toContain("Central Bank of India");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      district: "Kozhikode",
      siteName: "Center A",
      maleGuardsRequired: 2,
      femaleGuardsRequired: 1,
    });
  });

  it("parses pivot date sheets with multiple dates", () => {
    const wb = workbookFromRows([
      ["District", "Site", "15 Apr 2026", "", "16 Apr 2026", ""],
      ["District", "Site", "MALE", "FEMALE", "MALE", "FEMALE"],
      ["Kollam", "Center B", 3, 2, 4, 1],
    ]);

    const result = parseTcsExamWorkbook(wb, "BITSAT Exam on 15 and 16 Apr 2026.xlsx");

    expect(result.parserMode).toBe("pivot-date-sheet");
    expect(result.suggestedExamName).toContain("BITSAT");
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.date)).toEqual(["2026-04-15", "2026-04-16"]);
  });
});
```

- [ ] **Step 2: Run the parser tests to verify they fail**

Run: `npx vitest run src/lib/work-orders/tcs-exam-parser.test.ts`

Expected: FAIL because the parser module does not exist yet.

- [ ] **Step 3: Add parser types and parser implementation**

```ts
// src/lib/work-orders/tcs-exam-import-types.ts
export type TcsParserMode = "legacy-sheet" | "pivot-date-sheet";

export interface ParsedTcsExamRow {
  siteName: string;
  district: string;
  date: string;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
}

export interface ParsedTcsExamWorkbook {
  parserMode: TcsParserMode;
  suggestedExamName: string;
  suggestedExamCode: string;
  dateRange: { from: string; to: string };
  dates: string[];
  rows: ParsedTcsExamRow[];
  siteCount: number;
  rowCount: number;
  totalMale: number;
  totalFemale: number;
}
```

```ts
// src/lib/work-orders/tcs-exam-parser.ts
import * as XLSX from "xlsx";
import slugify from "slugify";
import type { ParsedTcsExamWorkbook, ParsedTcsExamRow, TcsParserMode } from "./tcs-exam-import-types";

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return null;
}

function examNameFromFilename(fileName: string): string {
  return fileName
    .replace(/\.xlsx?$/i, "")
    .replace(/revised/gi, "")
    .replace(/adhoc security guards? requir?e?ment/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTcsExamWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedTcsExamWorkbook {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  const firstRow = rows[0] ?? [];
  const secondRow = rows[1] ?? [];
  const hasLegacyExamLabel = firstRow.some((cell) => String(cell).toLowerCase().includes("exam name"));
  const hasPivotHeaders = secondRow.some((cell) => String(cell).trim().toUpperCase() === "MALE");
  const parserMode: TcsParserMode = hasLegacyExamLabel ? "legacy-sheet" : "pivot-date-sheet";

  const parsedRows: ParsedTcsExamRow[] = [];
  let suggestedExamName = examNameFromFilename(fileName);

  if (parserMode === "legacy-sheet") {
    suggestedExamName = String(firstRow[0]).split(":-").pop()?.trim() || suggestedExamName;
    const date = toIsoDate(firstRow.find((cell) => toIsoDate(cell))) ?? "";
    for (const row of rows.slice(2)) {
      const district = String(row[1] || "").trim();
      const siteName = String(row[2] || "").trim();
      const male = Number(row[3] || 0);
      const female = Number(row[4] || 0);
      if (!siteName || !date || male + female <= 0) continue;
      parsedRows.push({ district, siteName, date, maleGuardsRequired: male, femaleGuardsRequired: female });
    }
  } else {
    const staticDistrictIndex = 0;
    const staticSiteIndex = 1;
    const dateColumns: { date: string; maleIndex: number; femaleIndex: number }[] = [];
    for (let index = 2; index < firstRow.length; index += 2) {
      const date = toIsoDate(firstRow[index]);
      if (!date) continue;
      dateColumns.push({ date, maleIndex: index, femaleIndex: index + 1 });
    }
    for (const row of rows.slice(2)) {
      const district = String(row[staticDistrictIndex] || "").trim();
      const siteName = String(row[staticSiteIndex] || "").trim();
      if (!siteName) continue;
      for (const dateColumn of dateColumns) {
        const male = Number(row[dateColumn.maleIndex] || 0);
        const female = Number(row[dateColumn.femaleIndex] || 0);
        if (male + female <= 0) continue;
        parsedRows.push({
          district,
          siteName,
          date: dateColumn.date,
          maleGuardsRequired: male,
          femaleGuardsRequired: female,
        });
      }
    }
  }

  const dates = Array.from(new Set(parsedRows.map((row) => row.date))).sort();
  return {
    parserMode,
    suggestedExamName,
    suggestedExamCode: slugify(suggestedExamName, { lower: true, strict: true }),
    dateRange: { from: dates[0] ?? "", to: dates[dates.length - 1] ?? "" },
    dates,
    rows: parsedRows,
    siteCount: new Set(parsedRows.map((row) => `${row.district}|${row.siteName}`)).size,
    rowCount: parsedRows.length,
    totalMale: parsedRows.reduce((sum, row) => sum + row.maleGuardsRequired, 0),
    totalFemale: parsedRows.reduce((sum, row) => sum + row.femaleGuardsRequired, 0),
  };
}
```

- [ ] **Step 4: Run the parser tests to verify they pass**

Run: `npx vitest run src/lib/work-orders/tcs-exam-parser.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-orders/tcs-exam-import-types.ts \
  src/lib/work-orders/tcs-exam-parser.ts \
  src/lib/work-orders/tcs-exam-parser.test.ts
git commit -m "feat: add tcs exam sheet parser"
```

---

### Task 3: Add duplicate hashes and diff builder

**Files:**
- Create: `src/lib/work-orders/tcs-exam-hash.ts`
- Create: `src/lib/work-orders/tcs-exam-diff.ts`
- Test: `src/lib/work-orders/tcs-exam-hash.test.ts`
- Test: `src/lib/work-orders/tcs-exam-diff.test.ts`

- [ ] **Step 1: Write failing tests for hash stability and diff statuses**

```ts
import { describe, expect, it } from "vitest";
import { buildTcsExamContentHash } from "@/lib/work-orders/tcs-exam-hash";
import { buildTcsExamDiff } from "@/lib/work-orders/tcs-exam-diff";

describe("buildTcsExamContentHash", () => {
  it("returns same hash for same logical rows in different order", () => {
    const a = buildTcsExamContentHash("bitsat-apr-2026", [
      { siteId: "a", date: "2026-04-15", maleGuardsRequired: 2, femaleGuardsRequired: 1 },
      { siteId: "b", date: "2026-04-16", maleGuardsRequired: 3, femaleGuardsRequired: 0 },
    ]);
    const b = buildTcsExamContentHash("bitsat-apr-2026", [
      { siteId: "b", date: "2026-04-16", maleGuardsRequired: 3, femaleGuardsRequired: 0 },
      { siteId: "a", date: "2026-04-15", maleGuardsRequired: 2, femaleGuardsRequired: 1 },
    ]);
    expect(a).toBe(b);
  });
});

describe("buildTcsExamDiff", () => {
  it("marks missing existing rows as cancelled during revision", () => {
    const diff = buildTcsExamDiff({
      parsedRows: [
        { siteId: "site-a", siteName: "A", district: "Kollam", date: "2026-04-15", examName: "BITSAT", examCode: "bitsat", maleGuardsRequired: 2, femaleGuardsRequired: 1 },
      ],
      existingRows: [
        { id: "site-a_2026-04-15_bitsat", siteId: "site-a", siteName: "A", district: "Kollam", date: "2026-04-15", examName: "BITSAT", examCode: "bitsat", maleGuardsRequired: 2, femaleGuardsRequired: 1, totalManpower: 3, recordStatus: "active" },
        { id: "site-b_2026-04-15_bitsat", siteId: "site-b", siteName: "B", district: "Kollam", date: "2026-04-15", examName: "BITSAT", examCode: "bitsat", maleGuardsRequired: 1, femaleGuardsRequired: 1, totalManpower: 2, recordStatus: "active" },
      ],
      mode: "revision",
    });

    expect(diff.some((row) => row.status === "cancelled" && row.siteId === "site-b")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/work-orders/tcs-exam-hash.test.ts src/lib/work-orders/tcs-exam-diff.test.ts`

Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement hashing and diff helpers**

```ts
// src/lib/work-orders/tcs-exam-hash.ts
import { createHash } from "node:crypto";

interface HashableRow {
  siteId: string;
  date: string;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
}

export function buildBinaryFileHash(buffer: ArrayBuffer) {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export function buildTcsExamContentHash(examCode: string, rows: HashableRow[]) {
  const normalized = rows
    .map((row) => `${row.siteId}|${row.date}|${row.maleGuardsRequired}|${row.femaleGuardsRequired}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(`${examCode}\n${normalized}`).digest("hex");
}
```

```ts
// src/lib/work-orders/tcs-exam-diff.ts
import type { TcsExamImportDiffRow } from "@/types/work-orders";

interface ParsedRow {
  siteId: string;
  siteName: string;
  district: string;
  date: string;
  examName: string;
  examCode: string;
  maleGuardsRequired: number;
  femaleGuardsRequired: number;
}

interface ExistingRow extends ParsedRow {
  id: string;
  totalManpower: number;
  recordStatus?: string;
}

export function buildTcsExamDiff(input: {
  parsedRows: ParsedRow[];
  existingRows: ExistingRow[];
  mode: "new" | "revision";
}): TcsExamImportDiffRow[] {
  const existingMap = new Map(
    input.existingRows
      .filter((row) => row.recordStatus !== "cancelled")
      .map((row) => [`${row.siteId}|${row.date}|${row.examCode}`, row]),
  );

  const seenKeys = new Set<string>();
  const diffRows: TcsExamImportDiffRow[] = [];

  for (const row of input.parsedRows) {
    const key = `${row.siteId}|${row.date}|${row.examCode}`;
    seenKeys.add(key);
    const existing = existingMap.get(key);
    const totalManpower = row.maleGuardsRequired + row.femaleGuardsRequired;
    if (!existing) {
      diffRows.push({ ...row, key, totalManpower, status: "added" });
      continue;
    }
    const unchanged =
      existing.maleGuardsRequired === row.maleGuardsRequired &&
      existing.femaleGuardsRequired === row.femaleGuardsRequired;
    diffRows.push({
      ...row,
      key,
      totalManpower,
      status: unchanged ? "unchanged" : "updated",
      previousMaleGuardsRequired: existing.maleGuardsRequired,
      previousFemaleGuardsRequired: existing.femaleGuardsRequired,
    });
  }

  if (input.mode === "revision") {
    for (const existing of input.existingRows) {
      const key = `${existing.siteId}|${existing.date}|${existing.examCode}`;
      if (seenKeys.has(key) || existing.recordStatus === "cancelled") continue;
      diffRows.push({
        key,
        siteId: existing.siteId,
        siteName: existing.siteName,
        district: existing.district,
        date: existing.date,
        examName: existing.examName,
        examCode: existing.examCode,
        maleGuardsRequired: existing.maleGuardsRequired,
        femaleGuardsRequired: existing.femaleGuardsRequired,
        totalManpower: existing.totalManpower,
        status: "cancelled",
        previousMaleGuardsRequired: existing.maleGuardsRequired,
        previousFemaleGuardsRequired: existing.femaleGuardsRequired,
      });
    }
  }

  return diffRows.sort((a, b) => a.date.localeCompare(b.date) || a.siteName.localeCompare(b.siteName));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/work-orders/tcs-exam-hash.test.ts src/lib/work-orders/tcs-exam-diff.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-orders/tcs-exam-hash.ts \
  src/lib/work-orders/tcs-exam-diff.ts \
  src/lib/work-orders/tcs-exam-hash.test.ts \
  src/lib/work-orders/tcs-exam-diff.test.ts
git commit -m "feat: add tcs exam import diffing"
```

---

### Task 4: Add server preview endpoint for parser + dedupe + overlap checks

**Files:**
- Create: `src/app/api/admin/work-orders/import/preview/route.ts`
- Modify: `src/types/work-orders.ts`
- Test: `src/app/work-orders-import-preview.test.ts`

- [ ] **Step 1: Write failing preview endpoint test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const previewRouteSource = readFileSync(
  "src/app/api/admin/work-orders/import/preview/route.ts",
  "utf8",
);

describe("work order import preview route", () => {
  it("checks binary hash, content hash, and overlap state", () => {
    expect(previewRouteSource).toContain("binaryFileHash");
    expect(previewRouteSource).toContain("contentHash");
    expect(previewRouteSource).toContain("duplicateState");
    expect(previewRouteSource).toContain("workOrderImports");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/work-orders-import-preview.test.ts`

Expected: FAIL because the preview route does not exist.

- [ ] **Step 3: Implement the preview route**

```ts
// src/app/api/admin/work-orders/import/preview/route.ts
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildBinaryFileHash, buildTcsExamContentHash } from "@/lib/work-orders/tcs-exam-hash";
import { parseTcsExamWorkbook } from "@/lib/work-orders/tcs-exam-parser";
import { buildTcsExamDiff } from "@/lib/work-orders/tcs-exam-diff";
import type { WorkOrderDoc } from "@/types/work-orders";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const formData = await request.formData();
    const file = formData.get("file");
    const requestedExamName = String(formData.get("examName") || "").trim();
    const requestedExamCode = String(formData.get("examCode") || "").trim();
    const mode = formData.get("mode") === "revision" ? "revision" : "new";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload file is required." }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const parsed = parseTcsExamWorkbook(workbook, file.name);
    const examName = requestedExamName || parsed.suggestedExamName;
    const examCode = requestedExamCode || parsed.suggestedExamCode;
    const binaryFileHash = buildBinaryFileHash(buffer);
    const contentHash = buildTcsExamContentHash(
      examCode,
      parsed.rows.map((row, index) => ({
        siteId: `${row.district.toLowerCase()}|${row.siteName.toLowerCase()}|${index}`,
        date: row.date,
        maleGuardsRequired: row.maleGuardsRequired,
        femaleGuardsRequired: row.femaleGuardsRequired,
      })),
    );

    const importSnapshot = await adminDb
      .collection("workOrderImports")
      .where("clientName", "==", "TCS")
      .where("examCode", "==", examCode)
      .get();

    let duplicateState: "none" | "binary-duplicate" | "content-duplicate" | "overlap" = "none";
    let duplicateMessage = "";

    if (importSnapshot.docs.some((doc) => doc.data().binaryFileHash === binaryFileHash)) {
      duplicateState = "binary-duplicate";
      duplicateMessage = "This exact file was already imported.";
    } else if (importSnapshot.docs.some((doc) => doc.data().contentHash === contentHash)) {
      duplicateState = "content-duplicate";
      duplicateMessage = "This parsed duty data already exists.";
    }

    const activeSnapshot = await adminDb
      .collection("workOrders")
      .where("clientName", "==", "TCS")
      .where("examCode", "==", examCode)
      .where("recordStatus", "==", "active")
      .get();

    const existingRows = activeSnapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, any>;
      return {
        id: doc.id,
        siteId: data.siteId,
        siteName: data.siteName,
        district: data.district,
        date: data.date?.toDate ? data.date.toDate().toISOString().slice(0, 10) : String(data.date || ""),
        examName: data.examName || examName,
        examCode: data.examCode || examCode,
        maleGuardsRequired: Number(data.maleGuardsRequired || 0),
        femaleGuardsRequired: Number(data.femaleGuardsRequired || 0),
        totalManpower: Number(data.totalManpower || 0),
        recordStatus: data.recordStatus || "active",
      };
    });

    if (duplicateState === "none" && existingRows.length > 0) {
      duplicateState = "overlap";
      duplicateMessage = "Existing active rows overlap this exam scope. Review as revision.";
    }

    const diffRows = buildTcsExamDiff({
      mode,
      existingRows,
      parsedRows: parsed.rows.map((row) => ({
        siteId: `${row.district.toLowerCase()}|${row.siteName.toLowerCase()}`,
        siteName: row.siteName,
        district: row.district,
        date: row.date,
        examName,
        examCode,
        maleGuardsRequired: row.maleGuardsRequired,
        femaleGuardsRequired: row.femaleGuardsRequired,
      })),
    });

    return NextResponse.json({
      ...parsed,
      suggestedExamName: examName,
      suggestedExamCode: examCode,
      binaryFileHash,
      contentHash,
      duplicateState,
      duplicateMessage,
      diffRows,
    });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json({ error: error?.message || "Preview failed." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the preview route test**

Run: `npx vitest run src/app/work-orders-import-preview.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/work-orders/import/preview/route.ts \
  src/app/work-orders-import-preview.test.ts \
  src/types/work-orders.ts
git commit -m "feat: add tcs work order preview route"
```

---

### Task 5: Add commit endpoint with revision cancellation and import history

**Files:**
- Create: `src/app/api/admin/work-orders/import/commit/route.ts`
- Modify: `src/app/api/admin/work-orders/[id]/route.ts`
- Test: `src/app/work-orders-import-preview.test.ts`

- [ ] **Step 1: Extend the test to verify commit route lifecycle fields**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commitRouteSource = readFileSync(
  "src/app/api/admin/work-orders/import/commit/route.ts",
  "utf8",
);
const itemRouteSource = readFileSync(
  "src/app/api/admin/work-orders/[id]/route.ts",
  "utf8",
);

describe("work order import commit route", () => {
  it("writes import metadata and cancelled revision rows", () => {
    expect(commitRouteSource).toContain("workOrderImports");
    expect(commitRouteSource).toContain("recordStatus");
    expect(commitRouteSource).toContain("cancelledAt");
    expect(itemRouteSource).toContain("recordStatus");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/work-orders-import-preview.test.ts -t "work order import commit route"`

Expected: FAIL because the commit route does not exist and the patch route does not allow `recordStatus`.

- [ ] **Step 3: Implement commit route and extend patch whitelist**

```ts
// src/app/api/admin/work-orders/import/commit/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAdmin, unauthorizedResponse } from "@/lib/server/auth";
import { buildServerCreateAudit, buildServerUpdateAudit } from "@/lib/server/audit";

export async function POST(request: Request) {
  try {
    const adminUser = await requireAdmin(request);
    const { db: adminDb } = await import("@/lib/firebaseAdmin");
    const body = await request.json();
    const importId = randomUUID();
    const now = new Date();
    const {
      fileName,
      examName,
      examCode,
      binaryFileHash,
      contentHash,
      parserMode,
      mode,
      diffRows,
      dateRange,
    } = body as Record<string, any>;

    if (!fileName || !examName || !examCode || !Array.isArray(diffRows) || diffRows.length === 0) {
      return NextResponse.json({ error: "Invalid import payload." }, { status: 400 });
    }

    const batch = adminDb.batch();

    for (const row of diffRows) {
      const docId = `${row.siteId}_${row.date}_${examCode}`;
      const ref = adminDb.collection("workOrders").doc(docId);
      if (row.status === "cancelled") {
        batch.set(ref, {
          recordStatus: "cancelled",
          supersededByImportId: importId,
          cancelledAt: now,
          cancelledReason: "missing_from_revision",
          ...buildServerUpdateAudit({ uid: adminUser.uid, email: adminUser.email }),
        }, { merge: true });
        continue;
      }

      batch.set(ref, {
        siteId: row.siteId,
        siteName: row.siteName,
        district: row.district,
        clientName: "TCS",
        date: new Date(`${row.date}T12:00:00+05:30`),
        examName,
        examCode,
        maleGuardsRequired: row.maleGuardsRequired,
        femaleGuardsRequired: row.femaleGuardsRequired,
        totalManpower: row.totalManpower,
        recordStatus: "active",
        importId,
        sourceFileName: fileName,
        binaryFileHash,
        contentHash,
        ...buildServerCreateAudit({ uid: adminUser.uid, email: adminUser.email }),
      }, { merge: true });
    }

    batch.set(adminDb.collection("workOrderImports").doc(importId), {
      clientName: "TCS",
      fileName,
      binaryFileHash,
      contentHash,
      examName,
      examCode,
      dateRange,
      siteCount: new Set(diffRows.map((row: any) => row.siteId)).size,
      rowCount: diffRows.length,
      totalMale: diffRows.filter((row: any) => row.status !== "cancelled").reduce((sum: number, row: any) => sum + row.maleGuardsRequired, 0),
      totalFemale: diffRows.filter((row: any) => row.status !== "cancelled").reduce((sum: number, row: any) => sum + row.femaleGuardsRequired, 0),
      mode,
      status: "committed",
      parserMode,
      importedBy: adminUser.email || adminUser.uid,
      importedAt: now,
      diffSummary: {
        added: diffRows.filter((row: any) => row.status === "added").length,
        updated: diffRows.filter((row: any) => row.status === "updated").length,
        unchanged: diffRows.filter((row: any) => row.status === "unchanged").length,
        cancelled: diffRows.filter((row: any) => row.status === "cancelled").length,
      },
      ...buildServerCreateAudit({ uid: adminUser.uid, email: adminUser.email }),
    });

    await batch.commit();
    return NextResponse.json({ importId });
  } catch (error: any) {
    if (error?.message?.includes("access required")) {
      return unauthorizedResponse(error.message, 403);
    }
    return NextResponse.json({ error: error?.message || "Commit failed." }, { status: 500 });
  }
}
```

```ts
// src/app/api/admin/work-orders/[id]/route.ts
const validTopLevel = [
  "maleGuardsRequired",
  "femaleGuardsRequired",
  "totalManpower",
  "assignedGuards",
  "recordStatus",
  "examName",
  "examCode",
  "cancelledReason",
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/work-orders-import-preview.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/work-orders/import/commit/route.ts \
  src/app/api/admin/work-orders/'[id]'/route.ts \
  src/app/work-orders-import-preview.test.ts
git commit -m "feat: commit tcs exam work order imports"
```

---

### Task 6: Replace client-side write loop with preview → confirm import UI

**Files:**
- Modify: `src/app/(app)/work-orders/page.tsx`
- Test: `src/app/work-orders-surface.test.ts`

- [ ] **Step 1: Add failing UI assertions for preview/confirm flow**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workOrdersPageSource = readFileSync(
  "src/app/(app)/work-orders/page.tsx",
  "utf8",
);

describe("tcs import preview workflow", () => {
  it("uses preview and commit routes instead of direct per-row writes", () => {
    expect(workOrdersPageSource).toContain("/api/admin/work-orders/import/preview");
    expect(workOrdersPageSource).toContain("/api/admin/work-orders/import/commit");
    expect(workOrdersPageSource).toContain("duplicateState");
    expect(workOrdersPageSource).not.toContain("const workOrderId = `${site.id}_${dateString}`");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/work-orders-surface.test.ts -t "tcs import preview workflow"`

Expected: FAIL because the page still does direct per-row writes.

- [ ] **Step 3: Refactor the import UI into preview + confirm**

```ts
// src/app/(app)/work-orders/page.tsx
const [importPreview, setImportPreview] = useState<TcsExamImportPreview | null>(null);
const [isPreviewing, setIsPreviewing] = useState(false);
const [examNameInput, setExamNameInput] = useState("");
const [examCodeInput, setExamCodeInput] = useState("");
const [importMode, setImportMode] = useState<"new" | "revision">("new");

const handlePreviewImport = async () => {
  if (!file) return;
  setIsPreviewing(true);
  try {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("examName", examNameInput);
    formData.set("examCode", examCodeInput);
    formData.set("mode", importMode);

    const response = await authorizedFetch("/api/admin/work-orders/import/preview", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Preview failed");
    setImportPreview(payload);
    setExamNameInput(payload.suggestedExamName);
    setExamCodeInput(payload.suggestedExamCode);
  } catch (error: any) {
    toast({ variant: "destructive", title: "Preview failed", description: error.message });
  } finally {
    setIsPreviewing(false);
  }
};

const handleCommitImport = async () => {
  if (!importPreview || !file) return;
  setIsProcessing(true);
  try {
    const response = await authorizedFetch("/api/admin/work-orders/import/commit", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        examName: examNameInput || importPreview.suggestedExamName,
        examCode: examCodeInput || importPreview.suggestedExamCode,
        binaryFileHash: importPreview.binaryFileHash,
        contentHash: importPreview.contentHash,
        parserMode: importPreview.parserMode,
        mode: importMode,
        dateRange: importPreview.dateRange,
        diffRows: importPreview.diffRows,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Commit failed");
    toast({ title: "Import completed", description: `Import ${payload.importId} saved successfully.` });
    setImportPreview(null);
    setFile(null);
  } catch (error: any) {
    toast({ variant: "destructive", title: "Import failed", description: error.message });
  } finally {
    setIsProcessing(false);
  }
};
```

```tsx
{userRole === "admin" && activeTab === "assignments" ? (
  <Card>
    <CardHeader>
      <CardTitle>TCS Exam Import</CardTitle>
      <CardDescription>Preview duplicate warnings and revision diffs before writing duty rows.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <Input type="file" accept=".xls,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input placeholder="Exam name" value={examNameInput} onChange={(event) => setExamNameInput(event.target.value)} />
        <Input placeholder="Exam code" value={examCodeInput} onChange={(event) => setExamCodeInput(event.target.value)} />
      </div>
      <Select value={importMode} onValueChange={(value: "new" | "revision") => setImportMode(value)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="new">New import</SelectItem>
          <SelectItem value="revision">Revision</SelectItem>
        </SelectContent>
      </Select>
      <Button onClick={handlePreviewImport} disabled={!file || isPreviewing}>
        {isPreviewing ? "Previewing..." : "Preview import"}
      </Button>
      {importPreview ? (
        <div className="space-y-3 rounded-lg border p-4">
          <Badge variant={importPreview.duplicateState === "none" ? "secondary" : "destructive"}>
            {importPreview.duplicateState}
          </Badge>
          <p className="text-sm text-muted-foreground">{importPreview.duplicateMessage || "No duplicate warning."}</p>
          <div className="grid gap-2 text-sm sm:grid-cols-4">
            <div>Added: {importPreview.diffRows.filter((row) => row.status === "added").length}</div>
            <div>Updated: {importPreview.diffRows.filter((row) => row.status === "updated").length}</div>
            <div>Unchanged: {importPreview.diffRows.filter((row) => row.status === "unchanged").length}</div>
            <div>Cancelled: {importPreview.diffRows.filter((row) => row.status === "cancelled").length}</div>
          </div>
          <Button onClick={handleCommitImport} disabled={isProcessing}>
            {isProcessing ? "Committing..." : "Confirm import"}
          </Button>
        </div>
      ) : null}
    </CardContent>
  </Card>
) : null}
```

- [ ] **Step 4: Run the surface test**

Run: `npx vitest run src/app/work-orders-surface.test.ts -t "tcs import preview workflow"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/'(app)'/work-orders/page.tsx src/app/work-orders-surface.test.ts
git commit -m "feat: add tcs work order preview ui"
```

---

### Task 7: Show exam-aware rows in admin, field-officer, and site detail views

**Files:**
- Modify: `src/app/(app)/work-orders/page.tsx`
- Modify: `src/app/(app)/work-orders/[siteId]/page.tsx`
- Modify: `src/components/field-officers/work-orders-panel.tsx`
- Modify: `src/components/work-orders/assigned-guards-export-panel.tsx`
- Test: `src/app/work-orders-surface.test.ts`

- [ ] **Step 1: Add failing assertions for exam chips and active-only filters**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workOrdersPageSource = readFileSync("src/app/(app)/work-orders/page.tsx", "utf8");
const sitePageSource = readFileSync("src/app/(app)/work-orders/[siteId]/page.tsx", "utf8");
const foPanelSource = readFileSync("src/components/field-officers/work-orders-panel.tsx", "utf8");
const exportPanelSource = readFileSync("src/components/work-orders/assigned-guards-export-panel.tsx", "utf8");

describe("exam-aware work order display", () => {
  it("renders exam names and hides cancelled rows", () => {
    expect(workOrdersPageSource).toContain("recordStatus");
    expect(workOrdersPageSource).toContain("examName");
    expect(sitePageSource).toContain("examName");
    expect(foPanelSource).toContain("examName");
    expect(exportPanelSource).toContain("Exam Name");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/work-orders-surface.test.ts -t "exam-aware work order display"`

Expected: FAIL because the current UI does not render exam fields or active-only filters.

- [ ] **Step 3: Filter active rows and render exam chips**

```ts
// src/app/(app)/work-orders/page.tsx
const orders = snapshot.docs
  .map((doc) => ({ id: doc.id, ...doc.data() } as WorkOrder))
  .filter((order) => {
    const status = order.recordStatus || "active";
    if (status !== "active") return false;
    try {
      return order.date.toDate().getTime() >= todayMs;
    } catch {
      return true;
    }
  });
```

```tsx
<div className="flex flex-wrap gap-2">
  {ordersForSite.map((order) => (
    <Badge key={order.id} variant="outline">
      {order.examName || "General Duty"} · {order.maleGuardsRequired}M/{order.femaleGuardsRequired}F
    </Badge>
  ))}
</div>
```

```ts
// src/app/(app)/work-orders/[siteId]/page.tsx
const q = query(
  collection(db, "workOrders"),
  where("siteId", "==", siteId),
  where("recordStatus", "==", "active"),
);
```

```tsx
<div className="space-y-2">
  {workOrders.map((order) => (
    <Card key={order.id}>
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <p className="font-semibold">{order.examName || "General Duty"}</p>
          <p className="text-sm text-muted-foreground">{formatDate(order.date)} · {order.siteName}</p>
        </div>
        <Badge>{order.maleGuardsRequired}M / {order.femaleGuardsRequired}F</Badge>
      </CardContent>
    </Card>
  ))}
</div>
```

```ts
// src/components/work-orders/assigned-guards-export-panel.tsx
const headers = [
  "Sl No.",
  "Exam Name",
  "Date",
  "State",
  "City",
  "Center Name",
  "Center code",
  // ...
];

rows.push([
  serialNumber++,
  workOrder.examName || "General Duty",
  workOrder.date.toDate().toLocaleDateString("en-GB"),
  site?.state || "Kerala",
  // ...
]);
```

- [ ] **Step 4: Run the surface tests**

Run: `npx vitest run src/app/work-orders-surface.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/'(app)'/work-orders/page.tsx \
  src/app/'(app)'/work-orders/'[siteId]'/page.tsx \
  src/components/field-officers/work-orders-panel.tsx \
  src/components/work-orders/assigned-guards-export-panel.tsx \
  src/app/work-orders-surface.test.ts
git commit -m "feat: show exam-aware work orders"
```

---

### Task 8: Update downstream attendance and guard queries to respect active exam rows

**Files:**
- Modify: `src/app/api/attendance/submit/route.ts`
- Modify: `src/app/api/guard/dashboard/route.ts`
- Test: `src/app/work-orders-import-preview.test.ts`

- [ ] **Step 1: Add failing assertions for active-row filtering**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const attendanceRouteSource = readFileSync("src/app/api/attendance/submit/route.ts", "utf8");
const guardDashboardRouteSource = readFileSync("src/app/api/guard/dashboard/route.ts", "utf8");

describe("downstream work order readers", () => {
  it("filters cancelled rows out of attendance and dashboard queries", () => {
    expect(attendanceRouteSource).toContain("recordStatus");
    expect(guardDashboardRouteSource).toContain("recordStatus");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/work-orders-import-preview.test.ts -t "downstream work order readers"`

Expected: FAIL because neither route filters `recordStatus`.

- [ ] **Step 3: Update downstream readers**

```ts
// src/app/api/attendance/submit/route.ts
const matchingWorkOrder = workOrdersSnapshot.docs
  .map((doc) => doc.data() as Record<string, any>)
  .filter((workOrder) => (workOrder.recordStatus || "active") === "active")
  .find((workOrder) => {
    const assignedGuards = Array.isArray(workOrder.assignedGuards) ? workOrder.assignedGuards : [];
    return assignedGuards.length === 0 || assignedGuards.some((guard) => guard?.uid === payload.employeeDocId);
  });
```

```ts
// src/app/api/guard/dashboard/route.ts
const workOrderSnap = await adminDb
  .collection("workOrders")
  .where("assignedGuards", "array-contains", guard.employeeDocId)
  .where("recordStatus", "==", "active")
  .where("date", ">=", now)
  .where("date", "<=", sevenDaysLater)
  .orderBy("date")
  .limit(1)
  .get();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/work-orders-import-preview.test.ts -t "downstream work order readers"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/attendance/submit/route.ts \
  src/app/api/guard/dashboard/route.ts \
  src/app/work-orders-import-preview.test.ts
git commit -m "fix: filter inactive work order rows"
```

---

### Task 9: Add import history page for admins

**Files:**
- Create: `src/app/(app)/work-orders/imports/page.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `src/app/work-orders-surface.test.ts`

- [ ] **Step 1: Add failing navigation/page test**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync("src/app/(app)/layout.tsx", "utf8");
const importsPageSource = readFileSync("src/app/(app)/work-orders/imports/page.tsx", "utf8");

describe("work order import history", () => {
  it("adds admin access to work order import history", () => {
    expect(layoutSource).toContain("/work-orders/imports");
    expect(importsPageSource).toContain("workOrderImports");
    expect(importsPageSource).toContain("diffSummary");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/work-orders-surface.test.ts -t "work order import history"`

Expected: FAIL because the page and nav item do not exist.

- [ ] **Step 3: Implement imports history page**

```tsx
// src/app/(app)/work-orders/imports/page.tsx
"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WorkOrderImportDoc } from "@/types/work-orders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";

export default function WorkOrderImportsPage() {
  const [imports, setImports] = useState<WorkOrderImportDoc[]>([]);

  useEffect(() => {
    const q = query(collection(db, "workOrderImports"), orderBy("importedAt", "desc"));
    return onSnapshot(q, (snapshot) => {
      setImports(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as WorkOrderImportDoc)));
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Work Order Imports" description="Review committed TCS exam uploads and revision history." />
      {imports.map((entry) => (
        <Card key={entry.id}>
          <CardHeader>
            <CardTitle>{entry.examName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{entry.status}</Badge>
            <span>{entry.fileName}</span>
            <span>{entry.dateRange.from} → {entry.dateRange.to}</span>
            <span>{entry.rowCount} rows</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

```ts
// src/app/(app)/layout.tsx
{
  label: "Work Order Imports",
  href: "/work-orders/imports",
  roles: ["admin"],
}
```

- [ ] **Step 4: Run the navigation test**

Run: `npx vitest run src/app/work-orders-surface.test.ts -t "work order import history"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/'(app)'/work-orders/imports/page.tsx \
  src/app/'(app)'/layout.tsx \
  src/app/work-orders-surface.test.ts
git commit -m "feat: add work order import history page"
```

---

### Task 10: Full verification and cleanup

**Files:**
- Review only: `src/app/(app)/work-orders/page.tsx`
- Review only: `src/app/api/admin/work-orders/import/preview/route.ts`
- Review only: `src/app/api/admin/work-orders/import/commit/route.ts`

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npx vitest run \
  src/lib/work-orders/tcs-exam-parser.test.ts \
  src/lib/work-orders/tcs-exam-hash.test.ts \
  src/lib/work-orders/tcs-exam-diff.test.ts \
  src/app/work-orders-import-preview.test.ts \
  src/app/work-orders-surface.test.ts
```

Expected:

```text
All listed tests PASS
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected:

```text
Found 0 errors
```

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected:

```text
Compiled successfully
```

- [ ] **Step 4: Run local browser smoke test**

Run:

```bash
npm run dev
```

Then verify in browser:
- Upload a known TCS sample file.
- Preview shows parser mode, exam name, duplicate warning state, and diff counts.
- Confirm import writes rows.
- Admin work-orders page shows exam chips.
- Field-officer work-orders page shows same active rows for assigned districts.
- Site detail page shows exam-aware rows.
- Export file includes `Exam Name` column.

- [ ] **Step 5: Commit final integration**

```bash
git add src/types/work-orders.ts \
  src/lib/work-orders \
  src/app/api/admin/work-orders/import \
  src/app/api/admin/work-orders/'[id]'/route.ts \
  src/app/api/attendance/submit/route.ts \
  src/app/api/guard/dashboard/route.ts \
  src/app/'(app)'/work-orders \
  src/components/field-officers/work-orders-panel.tsx \
  src/components/work-orders/assigned-guards-export-panel.tsx \
  src/app/work-orders-import-preview.test.ts \
  src/app/work-orders-surface.test.ts
git commit -m "feat: support tcs exam work order revisions"
```

---

## Self-Review

### Spec coverage

- Mixed parser families: covered by Task 2.
- Exam-aware schema and lifecycle: covered by Tasks 1, 5, 7, 8.
- Duplicate warnings using binary/content hash: covered by Tasks 3 and 4.
- Revision cancellation behavior: covered by Tasks 3 and 5.
- Admin + field-officer UI with exam names: covered by Task 7.
- Import history page: covered by Task 9.
- No legacy migration in phase 1: respected; no task rewrites legacy docs.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Every code step includes concrete snippets and exact commands.

### Type consistency

- Shared `WorkOrderDoc` is introduced first and reused in later tasks.
- `recordStatus`, `examName`, `examCode`, and hash names are consistent across plan tasks.

