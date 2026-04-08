# Payroll From Client Wage Sheets And Attendance

## Summary

Replace the current compliance-settings-driven payroll flow with a client wage-sheet-template workflow.

For each client, the uploaded wage sheet becomes the payroll template. Monthly payroll is then recalculated from:

- the selected payroll period
- recorded employee attendance for that month
- approved leave for that month
- the client's uploaded wage-sheet-derived component rules

This design removes Compliance Settings from the active admin workflow and makes payroll behave like the real wage sheets currently used by operations.

## Why This Change

The current system splits payroll logic across:

- a Compliance Settings page for EPF, ESIC, PT, TDS, bonus, gratuity
- client wage configuration
- employee salary structures
- attendance aggregation

That does not match how the business currently works. The real source of truth is the client wage sheet.

Review of the February 2026 wage sheets shared by the user shows that:

- payroll is attendance-driven
- clients use different component sets and column layouts
- several sheets encode client-specific earnings and deductions directly
- some workbooks contain multiple zones or sub-sheets for the same client
- some sheets include billing columns in the same workbook, but payroll still starts from duties and employee-wise wage rows

Because of that, separate compliance configuration should not be the primary workflow driver for payroll.

## Goals

- Make uploaded client wage sheets the primary payroll template source.
- Generate monthly payroll from actual attendance records and approved leave.
- Preserve client-specific payroll structures instead of forcing one global statutory model.
- Support multi-sheet client workbooks in a predictable way.
- Keep admin review and override capability before payroll is finalized.
- Keep worksheet export aligned with wage-sheet style and terminology.

## Non-Goals

- Rebuilding every uploaded workbook pixel-for-pixel.
- Supporting every possible arbitrary spreadsheet formula in the first version.
- Removing all statutory calculations from code on day one if they are still needed as derived helpers.
- Replacing billing or invoicing workflows in this change.

## User-Facing Outcome

After this change:

- admins will no longer maintain Compliance Settings as part of regular payroll setup
- admins will upload wage-sheet templates per client
- payroll runs will calculate per-employee salary from monthly attendance and the client template
- payroll review pages will show values that align more closely with the user's real wage sheets
- the system will remain editable for exceptions and manual corrections

## Sample Wage-Sheet Findings

The reviewed samples show consistent business patterns, even when workbook layouts differ.

Common row-level drivers:

- employee identity columns such as name, UAN, ESIC, branch, district
- attendance or duty columns such as duties, WD, WF, ED, HD, total work hours
- earnings columns such as basic, DA, wash allowance, bonus, leave salary, gratuity, extra duty or reliever charges
- deduction columns such as PF, ESI, LWF, uniform, advance, total deduction
- result columns such as gross, net wages or net pay

Important implications:

- attendance count is a first-class input
- different clients use different named components
- some clients appear to derive wages from monthly duties, some from hours, and some from mixed duty-plus-extra columns
- one client may have multiple sheets representing zones, branches, or business units

## Recommended Approach

Use a template-based attendance payroll engine.

For each client:

1. Upload one or more wage sheets.
2. Parse each sheet into a structured template definition.
3. Store how the sheet maps payroll inputs to payroll outputs.
4. During payroll run, aggregate attendance for the month.
5. Apply the stored template logic to each employee's monthly attendance.
6. Generate draft payroll entries and a payroll worksheet for admin review.

This is intentionally not a raw workbook replay system. It is a structured payroll engine that uses wage sheets as the source template.

## Product Changes

### 1. Settings And Navigation

Compliance Settings should be removed from the main admin workflow.

Expected UI changes:

- remove the Compliance Settings entry from Settings navigation
- remove Compliance Settings cards and descriptions from Settings landing pages
- remove references that suggest admins must maintain statutory settings before payroll can run
- keep Wage Config, but rename and reposition it conceptually as client payroll template setup

The existing page may remain temporarily as a legacy/internal page behind a direct route, but it should not be part of the normal workflow once the new payroll engine is active.

### 2. Wage Config Becomes Payroll Template Setup

The current Wage Config page should evolve from generic component entry into a richer template setup page.

New responsibilities:

- upload a client wage sheet workbook
- parse one or more sheets
- identify the payroll-relevant sheets within the workbook
- detect the attendance driver model for each template:
  - duty-count based
  - working-days based
  - hours based
  - mixed
- map payroll columns into normalized concepts such as:
  - attendance inputs
  - earnings components
  - deductions
  - net pay
- let admin confirm or correct the detected template

### 3. Payroll Run Uses Attendance As Primary Input

The payroll run flow should continue to ask for:

- month
- year
- optional client filter

But the backend behavior changes.

Instead of loading global compliance settings and generic salary math first, the payroll run should:

- fetch the employee's client template
- fetch attendance summary for the selected month
- fetch approved leave summary for the selected month
- compute payable attendance according to the client template
- derive earnings and deductions using template-defined logic
- produce a payroll entry in draft/review state

### 4. Payroll Review Remains Mandatory

Because client sheets vary and real payroll can include exceptions, payroll entries should still be created in a reviewable state.

Review pages should support:

- seeing attendance inputs used in the calculation
- seeing the resolved template variant or sheet name used
- seeing component-by-component output
- manual adjustment of individual entries
- worksheet export before finalization

## Data Model Changes

### Client Wage Config

`ClientWageConfig` should be expanded from a flat component list into a richer payroll template document.

Additions should include:

- source workbook metadata
- list of template variants per workbook
- selected active template variant per client or per branch/unit if needed
- attendance input model:
  - `duties`
  - `working_days`
  - `hours`
  - `mixed`
- mappings from source columns to normalized payroll concepts
- component calculation rules derived from the uploaded sheet
- parse confidence and unresolved fields needing admin review

Suggested conceptual shape:

```ts
type ClientPayrollTemplate = {
  clientId: string;
  clientName: string;
  workbookName: string;
  templates: Array<{
    id: string;
    sheetName: string;
    label: string;
    attendanceModel: "duties" | "working_days" | "hours" | "mixed";
    employeeIdentifierColumns: string[];
    attendanceColumns: {
      duties?: string;
      workingDays?: string;
      wf?: string;
      ed?: string;
      hd?: string;
      totalHours?: string;
    };
    earningRules: Array<...>;
    deductionRules: Array<...>;
    outputColumns: {
      gross?: string;
      totalDeduction?: string;
      netPay?: string;
    };
  }>;
  activeTemplateId?: string;
}
```

Exact field names may differ, but the model must support multiple template variants per client workbook.

### Payroll Entry

`PayrollEntry` should gain enough metadata to explain how it was calculated.

Additions should include:

- `templateId`
- `templateSheetName`
- `attendanceInput`
- `payrollComputationMode`
- richer component breakdown for both earnings and deductions

Example conceptual additions:

```ts
{
  templateId: string;
  templateSheetName: string;
  attendanceInput: {
    model: "duties" | "working_days" | "hours" | "mixed";
    duties?: number;
    payableDays?: number;
    totalHours?: number;
  };
  earnings: {
    ...;
    componentBreakdown: Record<string, number>;
  };
  deductions: {
    ...;
    componentBreakdown?: Record<string, number>;
  };
}
```

### Compliance Settings

`ComplianceSettings` should no longer be treated as a required payroll dependency.

Transitional handling:

- keep the type and backend document temporarily if parts of the code still use it
- stop requiring admins to maintain it through the UI
- progressively replace hard dependency on `complianceSettings/global` in payroll run logic

## Calculation Model

### Payroll Driver

The primary monthly driver should be attendance.

The engine should use:

- aggregated attendance logs for the month
- approved leave data for the month
- template-specific attendance interpretation

Examples:

- TCS/Federal-like templates may use duty counts and working days
- Lulu-like templates may use duties plus total work hours and extra hours
- some templates may need a mixed calculation with both attendance and fixed monthly components

### Rule Types

The existing `WageComponent` model can still be reused, but it should be extended to support attendance-aware calculations.

New rule categories likely needed:

- fixed monthly component
- amount per duty
- amount per payable day
- amount per hour
- prorated monthly component
- direct sheet-derived formula group
- deduction linked to another component or gross

The current calculation model is too centered on generic CTC percentages. The new model should support direct operational payroll math from wage sheets.

### Statutory Deductions

Statutory values such as PF and ESI should come from the client template first, not from a separately maintained settings page.

Implementation guidance:

- if a client template clearly defines PF/ESI behavior, use the template-derived rule
- if a client template lacks enough detail, allow a temporary fallback helper
- do not force admin to maintain separate statutory slabs for normal payroll processing

This preserves business alignment while allowing staged migration away from global compliance dependency.

## Parsing Strategy

### Phase 1 Parsing

The parser should remain practical and admin-reviewable.

It should:

- detect header rows
- detect payroll-relevant sheets
- normalize column labels
- extract component names and likely rule types
- identify likely attendance columns
- identify likely gross and net columns
- flag ambiguous columns for admin confirmation

The parser does not need to fully reverse-engineer every formula in the first release.

### Admin Confirmation

After upload, the admin should confirm:

- which sheet or sheets are payroll templates
- which attendance model applies
- which columns represent duties, hours, gross, deductions, and net
- any client-specific special components

### Multi-Sheet Support

Some client workbooks contain multiple payroll sheets.

The system should support:

- one client with multiple template variants
- selecting the default active template
- future branching by unit, zone, branch, or designation if required

## Export Behavior

The exported worksheet should resemble operational wage sheets without promising an exact clone.

Exports should include:

- employee identifiers
- attendance inputs
- earnings columns
- deductions columns
- gross, total deduction, and net pay
- client and template metadata

If possible, exports should preserve familiar column labels from the client template to reduce admin friction.

## Migration Plan

### Phase 1

- hide Compliance Settings from normal admin navigation
- stop promoting it as required setup
- keep existing payroll working while template model is introduced

### Phase 2

- expand Wage Config into Client Payroll Template setup
- add template metadata and attendance-model support
- allow admin confirmation after upload

### Phase 3

- switch payroll run to template-plus-attendance calculation
- reduce or remove dependency on `complianceSettings/global`

### Phase 4

- improve worksheet export fidelity
- support more complex multi-sheet client mappings

## Affected Code Areas

Likely primary files:

- `src/app/(app)/settings/page.tsx`
- `src/app/(app)/settings/compliance-settings/page.tsx`
- `src/app/(app)/settings/wage-config/page.tsx`
- `src/app/(app)/payroll/run/page.tsx`
- `src/app/api/admin/payroll/run/route.ts`
- `src/app/api/admin/clients/[id]/wage-config/upload/route.ts`
- `src/lib/payroll/calculate.ts`
- `src/lib/payroll/attendance-aggregator.ts`
- `src/types/payroll.ts`

Likely new helpers:

- attendance-aware payroll rule interpreter
- client payroll template normalizer
- template sheet selector and validator

## Testing Strategy

### Unit Tests

- template parsing from representative wage-sheet headers
- attendance-driven component calculations
- duty-based, day-based, and hours-based rule handling
- payroll fallback behavior when template data is incomplete

### Integration Tests

- upload client wage sheet and save template
- run payroll for a period with recorded attendance
- verify generated payroll entries match expected component totals
- verify worksheet export contains expected columns and totals

### Regression Samples

Use the shared February 2026 sheets as reference fixtures when possible, especially:

- TCS
- Federal Bank
- Lulu
- Jammu & Kashmir

## Risks

- wage sheets vary significantly between clients
- some templates mix payroll and billing in one workbook
- employee matching between sheet rows and app employees may be inconsistent
- some historic client sheets may rely on manual adjustments not represented structurally

## Risk Mitigations

- require admin confirmation after parsing
- keep payroll runs in review state first
- preserve manual edit capability
- store source workbook metadata for traceability
- support template variants instead of assuming one sheet per client

## Decision

The system will use client wage sheets as payroll templates and calculate monthly payroll from recorded attendance and approved leave.

Compliance Settings will no longer be part of the primary admin payroll workflow.
