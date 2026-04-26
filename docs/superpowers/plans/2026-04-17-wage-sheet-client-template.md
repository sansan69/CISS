# Wage Sheet Client Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable wage-sheet client template flow in `Wage Configuration` that parses sample wage sheets, surfaces detected components and formulas for admin review, saves reusable rules and constants, and later powers payroll generation from attendance plus saved rules.

**Architecture:** Extend the current wage upload parser into a deterministic template parser that produces richer field evidence, standard mappings, constants, and rule types. Replace the narrow upload-review UI with a template-builder UI that lets admins confirm header-vs-cell formulas, edit constants, classify fields, and save a reusable client template. Keep payroll generation backward-compatible while adding a new template-aware evaluation path.

**Tech Stack:** Next.js App Router, TypeScript, Firebase Firestore, existing wage-config API routes, Vitest, XLS/XLSX parsing already used by upload route.

---

## File map

### Existing files to modify
- `src/types/payroll.ts`
  - Expand wage-template types, remove AI-specific template metadata from wage-config UX types, add template schema/constant/rule types.
- `src/app/api/admin/clients/[id]/wage-config/upload/route.ts`
  - Replace current column-only analysis with template-field analysis that understands headers, formulas, attendance fields, constants, and summary fields.
- `src/app/(app)/settings/wage-config/page.tsx`
  - Replace column-picking flow with upload review + template builder + constants editor + save payload update.
- `src/lib/payroll/calculate.ts`
  - Add template-aware rule evaluation helpers for constants, attendance-bound fields, summary fields, and formula expressions while preserving old paths.
- `firestore.rules` (only if client wage config payload shape requires rule comment updates; avoid behavior changes unless needed).

### New files to create
- `src/lib/payroll/wage-template-parser.ts`
  - Deterministic parser for sample sheets and field evidence extraction.
- `src/lib/payroll/wage-template-parser.test.ts`
  - Tests for flat, title-row, and formula-heavy families based on representative mock samples.
- `src/lib/payroll/wage-template-evaluator.ts`
  - Evaluate saved template rules using attendance-bound values and constants.
- `src/lib/payroll/wage-template-evaluator.test.ts`
  - Unit tests for constants, formula-source selection, attendance binding, and summary rule evaluation.
- `src/components/payroll/wage-template-builder.tsx`
  - Focused UI component for field review/editing, mapping, rule-source selection, and constants editing.
- `src/components/payroll/wage-template-builder.test.tsx` (only if repo already uses component tests comfortably; otherwise keep tests at parser/evaluator level).

### Existing files to inspect while implementing
- `src/lib/payroll/attendance-aggregator.ts`
- `src/app/api/admin/clients/[id]/wage-config/route.ts`
- `src/app/api/admin/payroll/run/route.ts`
- `src/types/attendance.ts`

---

### Task 1: Lock the parser behavior with failing tests

**Files:**
- Create: `src/lib/payroll/wage-template-parser.test.ts`
- Inspect: `src/app/api/admin/clients/[id]/wage-config/upload/route.ts`
- Inspect: `docs/superpowers/specs/2026-04-17-wage-sheet-client-template-design.md`

- [ ] **Step 1: Write failing tests for detected field families and formula evidence**

```ts
import { describe, expect, it } from 'vitest';
import {
  detectHeaderRow,
  inferSheetFamily,
  analyzeTemplateFields,
} from '@/lib/payroll/wage-template-parser';

describe('wage-template parser', () => {
  it('detects flat register headers from first row', () => {
    const rows = [
      ['Sl No', 'Name of the guard', 'DUTIES', 'Basic', 'DA', 'Gross', 'PF', 'ESI', 'Net Wages'],
      ['1', 'ANIL', '27', '10170', '4160', '14330', '1800', '108', '12422'],
    ];

    expect(detectHeaderRow(rows)).toBe(0);
    expect(inferSheetFamily(rows, 0)).toBe('flat_register');
  });

  it('detects title-row sheet header below title rows', () => {
    const rows = [
      ['CISS SERVICES LTD'],
      ['LOGIWARE SYSTEMS AND SOLUTIONS'],
      ['SALARY REGISTER FOR THE MONTH OF MAR-2026'],
      [],
      ['SL.NO', 'NAME', 'DUTIES', 'W/0', 'ED', 'WD', 'BASIC&DA', 'EXTRA 4 HRS', 'W.ALL', 'GROSS', 'P.F.', 'ESI'],
      ['1', 'JAYAKUMAR V', '1', '', '', '=K6+M6', '=SUM(14746/27*N6)', '=SUM(3834/27)*N6', '', '=SUM(O6:V6)', '=SUM(15000/27*K6*12/100)', '=(O6+P6+Q6)*0.75%'],
    ];

    expect(detectHeaderRow(rows)).toBe(4);
    expect(inferSheetFamily(rows, 4)).toBe('title_row_register');
  });

  it('captures both header meaning and cell formula evidence', () => {
    const rows = [
      ['SL NO.', 'NAME', 'NO.OF DUTIES', 'BASIC+VDA (1187.69)', 'HRA(16% of Basic + DA)', 'EPF (12% of Basic + VDA capped at 15,000)'],
      ['1', 'ARAVINDAKSHAN', '23', '=E2*1187.69', '=SUM(D2*16/100)', '=69.23*E2'],
    ];

    const fields = analyzeTemplateFields(rows, 0);
    const hra = fields.find((field) => field.originalLabel.includes('HRA'));
    const epf = fields.find((field) => field.originalLabel.startsWith('EPF'));

    expect(hra?.formulaSources).toContain('header');
    expect(hra?.formulaSources).toContain('cell');
    expect(epf?.ruleHint).toMatch(/cap|15000/i);
  });
});
```

- [ ] **Step 2: Run parser test file to verify it fails**

Run:
```bash
npx vitest run src/lib/payroll/wage-template-parser.test.ts
```

Expected:
- FAIL because `wage-template-parser.ts` does not exist yet or exported functions are missing.

- [ ] **Step 3: Commit the red test scaffold**

```bash
git add src/lib/payroll/wage-template-parser.test.ts
git commit -m "test: define wage template parser behavior"
```

### Task 2: Implement deterministic wage-template parser

**Files:**
- Create: `src/lib/payroll/wage-template-parser.ts`
- Modify: `src/app/api/admin/clients/[id]/wage-config/upload/route.ts`
- Test: `src/lib/payroll/wage-template-parser.test.ts`

- [ ] **Step 1: Implement parser helpers and types**

```ts
export type WageSheetFamily = 'flat_register' | 'title_row_register' | 'formula_heavy_register';
export type TemplateFieldCategory =
  | 'meta'
  | 'attendance'
  | 'earning'
  | 'deduction'
  | 'employer_contribution'
  | 'summary';

export type FormulaSource = 'header' | 'cell';

export interface TemplateFieldAnalysis {
  columnIndex: number;
  originalLabel: string;
  normalizedLabel: string;
  standardName: string;
  category: TemplateFieldCategory;
  sampleValues: string[];
  sampleCellFormulas: string[];
  formulaSources: FormulaSource[];
  headerFormulaHint: string | null;
  ruleHint: string;
  attendanceBound: boolean;
  likelyIgnored: boolean;
  detectedConstants: Array<{ key: string; value: number; source: 'header' | 'cell' }>;
}
```

Core helper responsibilities:
- `detectHeaderRow(rows)` picks first dense text row with payroll-like headers.
- `inferSheetFamily(rows, headerRowIndex)` distinguishes family by title rows and formula density.
- `analyzeTemplateFields(rows, headerRowIndex)` returns `TemplateFieldAnalysis[]`.
- `extractConstants()` pulls numeric constants such as `10170`, `3796`, `1187.69`, `15000`, `12`, `0.75`, `8.33`, `6.73` from header/cell formulas.
- `inferStandardName()` maps raw labels to stable internal names.
- `inferCategory()` classifies attendance/meta/earning/deduction/employer/summary fields.

- [ ] **Step 2: Wire the upload route to use the new parser**

Update the upload response to return:

```ts
return NextResponse.json({
  sheetNames,
  selectedSheet,
  sheetIndex,
  headers,
  rows: previewRows,
  totalRows: dataRows.length,
  headerRowIndex,
  detectedSheetFamily,
  templateFields,
  parserSummary: {
    detectedFields: templateFields.length,
    attendanceFields: templateFields.filter((f) => f.category === 'attendance').length,
    earningFields: templateFields.filter((f) => f.category === 'earning').length,
    deductionFields: templateFields.filter((f) => f.category === 'deduction').length,
  },
});
```

Keep old `columnAnalysis` only if the page still needs a compatibility bridge during migration; otherwise remove it cleanly.

- [ ] **Step 3: Run parser tests and route-adjacent typecheck**

Run:
```bash
npx vitest run src/lib/payroll/wage-template-parser.test.ts
npm run typecheck
```

Expected:
- parser tests PASS
- typecheck may still fail elsewhere; if so, note exact failures before continuing.

- [ ] **Step 4: Commit parser implementation**

```bash
git add src/lib/payroll/wage-template-parser.ts src/app/api/admin/clients/[id]/wage-config/upload/route.ts src/lib/payroll/wage-template-parser.test.ts
git commit -m "feat: parse wage sheet templates"
```

### Task 3: Expand wage-config and template types

**Files:**
- Modify: `src/types/payroll.ts`
- Test: `src/lib/payroll/wage-template-parser.test.ts`

- [ ] **Step 1: Add template schema, constants, and rule types**

Add new types near the existing payroll model:

```ts
export type WageTemplateFieldCategory =
  | 'meta'
  | 'attendance'
  | 'earning'
  | 'deduction'
  | 'employer_contribution'
  | 'summary';

export type WageTemplateRuleType =
  | 'attendance_bound'
  | 'fixed_amount'
  | 'per_duty_rate'
  | 'percentage_of_component'
  | 'sum_of_components'
  | 'formula_expression'
  | 'summary_only'
  | 'deduction_rule'
  | 'employer_contribution_rule';

export interface WageTemplateConstant {
  key: string;
  label: string;
  value: number;
  source: 'header' | 'cell' | 'manual';
}

export interface WageTemplateRule {
  id: string;
  originalLabel: string;
  displayLabel: string;
  standardName: string;
  category: WageTemplateFieldCategory;
  ruleType: WageTemplateRuleType;
  formulaSource: 'header' | 'cell' | 'manual';
  expression: string | null;
  dependsOn: string[];
  constantKeys: string[];
  attendanceKey: string | null;
  summaryOnly: boolean;
  order: number;
}

export interface ClientWageTemplateSchema {
  sheetName: string;
  headerRowIndex: number;
  sheetFamily: 'flat_register' | 'title_row_register' | 'formula_heavy_register';
  detectedHeaders: string[];
}
```

Update `ClientWageConfig` to include:
- `templateSchema?: ClientWageTemplateSchema`
- `templateConstants?: WageTemplateConstant[]`
- `templateRules?: WageTemplateRule[]`
- `templateVersion?: number`

Remove AI-facing properties from wage config usage going forward:
- `confidence`
- `aiDetected`
- `lastImportSummary.parserSource = "template" | "deterministic"` can remain only if renamed to non-AI parser metadata.

- [ ] **Step 2: Make type usage compile in touched files**

Update references where needed so `WageComponent` continues to support legacy payroll data while the template fields ride alongside it.

- [ ] **Step 3: Run typecheck**

Run:
```bash
npm run typecheck
```

Expected:
- Either PASS or fail only in files not yet migrated in later tasks.

- [ ] **Step 4: Commit type model changes**

```bash
git add src/types/payroll.ts
git commit -m "feat: add wage template rule types"
```

### Task 4: Lock template evaluation with failing tests

**Files:**
- Create: `src/lib/payroll/wage-template-evaluator.test.ts`
- Create later: `src/lib/payroll/wage-template-evaluator.ts`

- [ ] **Step 1: Write failing evaluator tests**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateWageTemplate } from '@/lib/payroll/wage-template-evaluator';

describe('evaluateWageTemplate', () => {
  it('calculates per-duty earnings from constants and attendance', () => {
    const result = evaluateWageTemplate({
      constants: [
        { key: 'basic_rate', label: 'Basic rate', value: 10170, source: 'manual' },
        { key: 'standard_month_days', label: 'Month days', value: 27, source: 'manual' },
      ],
      rules: [
        {
          id: 'basic',
          originalLabel: 'Basic',
          displayLabel: 'Basic',
          standardName: 'basic',
          category: 'earning',
          ruleType: 'per_duty_rate',
          formulaSource: 'manual',
          expression: '(basic_rate / standard_month_days) * payable_duties',
          dependsOn: [],
          constantKeys: ['basic_rate', 'standard_month_days'],
          attendanceKey: 'payable_duties',
          summaryOnly: false,
          order: 1,
        },
      ],
      attendance: { payable_duties: 27 },
    });

    expect(result.components.basic).toBe(10170);
  });

  it('calculates summary fields from prior earnings and deductions', () => {
    const result = evaluateWageTemplate({
      constants: [],
      attendance: {},
      rules: [
        {
          id: 'gross',
          originalLabel: 'Gross',
          displayLabel: 'Gross',
          standardName: 'gross',
          category: 'summary',
          ruleType: 'summary_only',
          formulaSource: 'manual',
          expression: 'sum(earnings)',
          dependsOn: ['basic', 'da'],
          constantKeys: [],
          attendanceKey: null,
          summaryOnly: true,
          order: 3,
        },
      ],
      seededComponents: { basic: 10170, da: 3796 },
    });

    expect(result.components.gross).toBe(13966);
  });
});
```

- [ ] **Step 2: Run evaluator test file to verify it fails**

Run:
```bash
npx vitest run src/lib/payroll/wage-template-evaluator.test.ts
```

Expected:
- FAIL because evaluator file does not exist yet.

- [ ] **Step 3: Commit red evaluator tests**

```bash
git add src/lib/payroll/wage-template-evaluator.test.ts
git commit -m "test: define wage template evaluator behavior"
```

### Task 5: Implement template evaluator and bridge payroll calculation

**Files:**
- Create: `src/lib/payroll/wage-template-evaluator.ts`
- Modify: `src/lib/payroll/calculate.ts`
- Test: `src/lib/payroll/wage-template-evaluator.test.ts`

- [ ] **Step 1: Implement minimal evaluator**

Core contract:

```ts
export function evaluateWageTemplate(input: {
  constants: WageTemplateConstant[];
  rules: WageTemplateRule[];
  attendance: Record<string, number>;
  seededComponents?: Record<string, number>;
}): { components: Record<string, number> } {
  // resolve constants
  // seed attendance-bound values
  // evaluate rules in order
  // support minimal expression helpers first:
  // - arithmetic expressions using constants and dependencies
  // - sum(earnings)
  // - sum(deductions)
  // - min(a, b)
}
```

Keep first implementation small and deterministic. Avoid a full general-purpose spreadsheet engine. Support only the rule patterns the spec requires.

- [ ] **Step 2: Add bridge helper in `calculate.ts`**

Add a helper such as:

```ts
export function applySavedWageTemplate(input: {
  rules: WageTemplateRule[];
  constants: WageTemplateConstant[];
  attendance: Record<string, number>;
}) {
  return evaluateWageTemplate({
    rules: input.rules,
    constants: input.constants,
    attendance: input.attendance,
  });
}
```

Do not remove the legacy calculation helpers yet. Keep existing payroll path working while the new template path is integrated.

- [ ] **Step 3: Run evaluator tests and focused payroll tests**

Run:
```bash
npx vitest run src/lib/payroll/wage-template-evaluator.test.ts src/lib/payroll/calculate.test.ts
```

Expected:
- New evaluator tests PASS
- Existing payroll tests either stay green or reveal exact compatibility gaps to fix now.

- [ ] **Step 4: Commit evaluator implementation**

```bash
git add src/lib/payroll/wage-template-evaluator.ts src/lib/payroll/calculate.ts src/lib/payroll/wage-template-evaluator.test.ts
git commit -m "feat: add wage template evaluator"
```

### Task 6: Rebuild Wage Configuration page around the template builder

**Files:**
- Create: `src/components/payroll/wage-template-builder.tsx`
- Modify: `src/app/(app)/settings/wage-config/page.tsx`
- Modify if needed: `src/app/api/admin/clients/[id]/wage-config/route.ts`

- [ ] **Step 1: Extract focused template-builder UI component**

The component should accept:

```ts
interface WageTemplateBuilderProps {
  fields: TemplateFieldAnalysis[];
  initialConstants: WageTemplateConstant[];
  initialRules: WageTemplateRule[];
  onChange: (next: {
    constants: WageTemplateConstant[];
    rules: WageTemplateRule[];
  }) => void;
}
```

UI sections:
- upload summary card
- field review table/list
- constant editor panel
- ignored fields panel
- summary of kept earnings/deductions/attendance fields

Each field row needs controls for:
- keep / ignore
- category select
- display label edit
- standard mapping select or input
- formula source choice (`header`, `cell`, `manual`)
- rule type select
- constant chips / dependency chips
- attendance binding select

- [ ] **Step 2: Replace current stage flow in wage-config page**

Update page state to something like:

```ts
type Stage = 'upload' | 'review' | 'configure';
```

Replace `columnAnalysis`-based selection with `templateFields`-based review.

Page behavior:
- upload sample sheet
- show detected header row + family + field counts
- move to template builder
- save `templateSchema`, `templateConstants`, `templateRules`
- preserve existing saved config loading path, but migrate old records gracefully by displaying legacy components if no template exists yet

- [ ] **Step 3: Update save payload**

When saving:

```ts
body: JSON.stringify({
  clientName,
  components: legacyComponentsFallback,
  uploadedFromExcel: true,
  templateMode: 'client_template',
  templateSchema,
  templateConstants,
  templateRules,
  templateVersion: 1,
})
```

Legacy `components` can remain populated as a compatibility subset for existing payroll consumers until payroll run fully switches.

- [ ] **Step 4: Run typecheck and a focused page test/build check**

Run:
```bash
npm run typecheck
npm run build
```

Expected:
- typecheck PASS
- build PASS, or else exact compilation issues isolated to touched files.

- [ ] **Step 5: Commit Wage Configuration UI changes**

```bash
git add src/components/payroll/wage-template-builder.tsx src/app/(app)/settings/wage-config/page.tsx src/app/api/admin/clients/[id]/wage-config/route.ts
git commit -m "feat: add wage template builder ui"
```

### Task 7: Hook payroll generation to saved templates when present

**Files:**
- Modify: `src/app/api/admin/payroll/run/route.ts`
- Inspect: `src/lib/payroll/attendance-aggregator.ts`
- Test: existing payroll tests plus any new focused route/unit tests if available

- [ ] **Step 1: Build attendance input map for template evaluation**

When a client wage config contains `templateRules` and `templateConstants`, build an attendance map such as:

```ts
const attendanceInputs = {
  payable_duties: payableDays,
  duties: presentDays,
  wf: approvedPaidLeaveDays,
  ed: approvedUnpaidLeaveDays,
  hd: overtimeHours,
  total: payableDays,
};
```

Map exact keys conservatively based on saved `attendanceKey` values.

- [ ] **Step 2: Prefer template evaluation when available**

Pseudo-flow:

```ts
if (wageConfig.templateRules?.length && wageConfig.templateConstants?.length) {
  const evaluated = applySavedWageTemplate({
    rules: wageConfig.templateRules,
    constants: wageConfig.templateConstants,
    attendance: attendanceInputs,
  });
  // derive earnings/deductions/employer contributions/gross/net from evaluated components
} else {
  // existing legacy path
}
```

Keep admin override path intact for review stage later; at this stage just make generation deterministic.

- [ ] **Step 3: Run payroll tests and full build**

Run:
```bash
npx vitest run src/lib/payroll/calculate.test.ts src/lib/payroll/wage-template-parser.test.ts src/lib/payroll/wage-template-evaluator.test.ts
npm run build
```

Expected:
- payroll-related tests PASS
- build PASS

- [ ] **Step 4: Commit payroll integration**

```bash
git add src/app/api/admin/payroll/run/route.ts src/lib/payroll/calculate.ts
git commit -m "feat: use wage templates in payroll"
```

### Task 8: Final verification against representative sample formats

**Files:**
- Verify: `src/app/api/admin/clients/[id]/wage-config/upload/route.ts`
- Verify: `src/app/(app)/settings/wage-config/page.tsx`
- Verify: `src/lib/payroll/wage-template-parser.ts`
- Optional script if needed: `tmp/wage-template-fixture-check.ts` then delete after use

- [ ] **Step 1: Run parser against fixtures matching observed sheet families**

If direct sample-file tests are practical in this repo, use them. Otherwise mirror representative rows from:
- flat register family (`CORROHEALTH`, `QUBE`, `J&K`)
- title-row family (`KSE`, `LOGIWARE`, `CSIR`)
- formula-heavy family (`LNG`, `GEODIS`, `TCS`)

Verify the parser produces:
- correct header row index
- correct sheet family
- expected category split
- formula-source evidence for header/cell cases
- extracted constants like `10170`, `3796`, `1187.69`, `15000`, `12`, `0.75`, `8.33`, `6.73`

- [ ] **Step 2: Run full verification set**

Run:
```bash
npx vitest run src/lib/payroll/wage-template-parser.test.ts src/lib/payroll/wage-template-evaluator.test.ts src/lib/payroll/calculate.test.ts
npm run typecheck
npm run build
```

Expected:
- all listed tests PASS
- typecheck PASS
- build PASS

- [ ] **Step 3: Update docs if behavior/terminology changed materially**

If the final UX removes AI wording or changes wage-config semantics, update:
- `docs/app-context.md`
- `MEMORY.md`

Only add concise entries tied to the completed feature.

- [ ] **Step 4: Commit final verification and docs adjustments**

```bash
git add docs/app-context.md MEMORY.md
git commit -m "docs: record wage template system"
```

---

## Self-review

### Spec coverage check
- Upload sample sheet parsing: covered in Tasks 1-2.
- Template-builder review UX: covered in Task 6.
- Header-vs-cell formula selection: covered in Tasks 1, 2, and 6.
- Standard internal name mapping with original label preservation: covered in Tasks 2, 3, and 6.
- Attendance-bound fields with later overrides: covered in Tasks 3, 6, and 7.
- Shared client constants table: covered in Tasks 2, 3, 5, and 6.
- Payroll generation from attendance + saved rules: covered in Tasks 5 and 7.
- Validation/safety and family coverage: covered in Tasks 1, 2, and 8.
- AI wording removal from wage-template UX: covered in Tasks 3 and 6.

### Placeholder scan
- No `TBD`, `TODO`, or implied “implement later” placeholders remain.
- Commands and target files are explicit.

### Type consistency check
- Uses `TemplateFieldAnalysis`, `WageTemplateConstant`, `WageTemplateRule`, and `evaluateWageTemplate` consistently.
- Uses sheet families `flat_register`, `title_row_register`, `formula_heavy_register` consistently.

