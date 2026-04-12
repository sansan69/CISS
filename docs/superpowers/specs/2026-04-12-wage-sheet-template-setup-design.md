# Wage-Sheet Template Setup For Client Payroll

## Summary

Refactor client wage configuration into a deterministic `payroll template setup` flow driven by uploaded wage-sheet headings.

For each client:

1. Admin uploads one representative wage sheet.
2. The system scans the first usable header row and shows every detected heading.
3. Admin decides which scanned fields matter for payroll and how each one behaves.
4. The saved template is reused for monthly payroll generation.
5. Monthly payroll derives employee identity from employee records and duties/payable days from attendance, then applies the saved client rules.

This replaces the current partially generic, partially inferred wage configuration model with a clearer admin-controlled setup flow.

## Why This Change

The current wage-config surface already uploads sheets and detects columns, but it still has three problems:

- it pushes admins toward generic formula types before they have reviewed the scanned sheet structure
- it stores AI-style metadata such as `confidence` and `aiDetected`, even though the logic is deterministic and the admin is the final authority
- it does not model the workflow the user wants, where each scanned field can be kept, edited, deleted, treated as permanent, linked to another field, or driven by attendance

The target behavior is not “infer everything automatically.” It is:

- scan everything
- show everything
- let the admin decide how each field should behave
- remember those decisions for payroll generation

## Goals

- Parse wage-sheet headings into reviewable field definitions.
- Show all scanned headings to the admin before saving any template.
- Allow each scanned field to be:
  - kept
  - deleted
  - renamed
  - recategorized
  - assigned a value source
  - assigned a formula
- Split payroll fields into:
  - meta fields
  - earnings
  - deductions
- Store client-specific payroll rules without AI-specific metadata.
- Use attendance as the source of duties/payable days during payroll generation.
- Preserve admin review and edit before payroll finalization.

## Non-Goals

- Reproducing the uploaded spreadsheet layout pixel-for-pixel.
- Evaluating arbitrary Excel formulas from uploaded files.
- Using AI to classify payroll fields.
- Importing employee-wise monthly wages from the uploaded sheet.

## Key Product Decision

The uploaded wage sheet is treated as a reusable client template, not as a monthly employee payroll source.

That means:

- employee names and employee codes come from employee records
- duties and payable-day inputs come from attendance and approved leave
- the uploaded wage sheet is only used to define payroll components and calculation rules

## Admin Workflow

### 1. Upload Sheet

Admin opens client wage configuration and uploads a wage sheet.

The system:

- finds the most likely header row
- reads all headings from that row
- samples values from the rows below it
- creates a scanned field list

### 2. Review Scanned Fields

Every scanned heading is shown as a field card.

Each card shows:

- original heading name
- detected sample values
- suggested category:
  - meta
  - earning
  - deduction
- suggested behavior
- suggested formula or source, if one can be determined deterministically

Nothing is hidden automatically. Even columns likely to be summaries should remain visible so the admin can explicitly ignore them.

### 3. Configure Field Behavior

For each scanned field, the admin can choose one behavior.

#### `Permanent Value`

Use a saved constant or base value for the component.

Examples:

- Basic
- fixed washing allowance
- fixed employer contribution

The system should:

- prefill the detected value if a sample amount exists
- let the admin accept or edit it

#### `Formula Based`

The component depends on another field or fields.

Examples:

- DA depends on Basic
- HRA depends on Basic
- PF depends on Basic + DA

The system should:

- show a detected formula if one can be inferred deterministically
- allow the admin to fully edit the formula
- store the referenced fields explicitly

#### `Manual Editable`

The component stays in the template, but its value is entered or overridden directly during setup or review.

This is useful for fields that are real payroll components but do not have stable deterministic rules.

#### `Attendance Driven`

The value comes from attendance/payroll-period inputs rather than a fixed amount in the template.

Examples:

- duties
- payable days
- LOP-driven effects
- per-duty calculations

These are special-source fields, not ordinary earnings/deductions.

#### `Ignore`

The field is removed from the active payroll template.

Examples:

- summary columns
- gross/net totals from the uploaded sample
- remarks/reference columns

### 4. Save Template

Once reviewed, the client template stores only the admin-approved fields and their rules.

The saved template becomes the source of truth for future payroll runs for that client.

## Field Categories

### Meta Fields

These are not earnings or deductions. They describe identity or payroll inputs.

Examples:

- employee name
- employee code
- UAN
- ESI number
- district
- duties
- working days
- payable days

Important rule:

- `employee name` and `employee code` should map to employee data, not to wage components
- `duties` and similar attendance inputs should map to attendance-derived values, not to uploaded row values

### Earnings

Examples:

- Basic
- DA
- HRA
- Special Allowance
- Washing Allowance
- Bonus

### Deductions

Examples:

- PF
- ESI
- PT
- TDS
- Advance
- Uniform deduction

## Formula Model

The system should support deterministic component formulas without exposing spreadsheet complexity.

Recommended supported rule shapes:

- fixed value
- percentage of another component
- percentage of sum of selected components
- per-duty multiplier
- per-payable-day multiplier
- balancing value
- manual value

Suggested conceptual structure:

```ts
type ComponentValueSource =
  | { kind: "fixed"; amount: number }
  | { kind: "formula"; expression: string; dependsOn: string[] }
  | { kind: "manual"; defaultValue: number | null }
  | { kind: "attendance"; metric: "duties" | "workingDays" | "payableDays" | "lopDays" }
  | { kind: "per_duty"; rate: number }
  | { kind: "per_payable_day"; rate: number }
  | { kind: "balancing" };
```

The stored expression format should be simple, deterministic, and safe to evaluate in application code.

Recommended examples:

- `BASIC * 0.12`
- `(BASIC + DA) * 0.12`
- `PAYABLE_DAYS * 500`

## Data Model Changes

### Replace AI-style component metadata

Remove payroll-template metadata that suggests AI ownership:

- `confidence`
- `aiDetected`
- parser labels that imply AI classification

Replace with deterministic scan metadata such as:

- `scanSource`
- `sampleValues`
- `originalHeading`
- `suggestedCategory`
- `suggestedValueSource`

### Expand client wage config

`ClientWageConfig` should evolve into a richer client payroll template document.

Suggested conceptual shape:

```ts
type ClientPayrollTemplateField = {
  id: string;
  originalHeading: string;
  label: string;
  category: "meta" | "earning" | "deduction";
  enabled: boolean;
  sourceType: "fixed" | "formula" | "manual" | "attendance" | "per_duty" | "per_payable_day" | "balancing";
  sampleValues: string[];
  fixedValue?: number | null;
  formulaExpression?: string | null;
  dependsOn?: string[];
  attendanceMetric?: "duties" | "workingDays" | "payableDays" | "lopDays" | null;
  order: number;
};

type ClientPayrollTemplate = {
  clientId: string;
  clientName: string;
  uploadedFromExcel: boolean;
  sheetName: string;
  headerRowIndex: number;
  scannedFields: ClientPayrollTemplateField[];
  lastImportSummary?: {
    parsedAt: string;
    parsedFields: number;
    selectedFields: number;
  };
  lastUpdatedAt: Timestamp;
  lastUpdatedBy: string;
};
```

Implementation names can differ, but the structure should support:

- all scanned fields
- admin-approved subset
- explicit value-source behavior
- formula dependencies

## Upload Parser Changes

The upload route should be simplified around sheet scanning and deterministic suggestions.

It should:

- scan all headings
- classify likely meta/earning/deduction fields
- capture sample values
- infer safe suggestions only where obvious

It should not:

- finalize component formulas automatically
- store AI metadata
- silently drop columns from the review flow

## Wage Config UI Changes

The wage-config page should shift from a three-step formula-first wizard into a scan-and-configure payroll-template builder.

Recommended stages:

1. Select client
2. Upload wage sheet
3. Review scanned fields
4. Configure each kept field
5. Save template

Each field card should allow:

- rename label
- change category
- choose behavior
- accept or edit detected value
- accept or edit detected formula
- delete/ignore field

The page should clearly separate:

- Meta Fields
- Earnings
- Deductions

## Payroll Run Changes

When admin generates payroll for a month:

1. Load the saved client payroll template.
2. Aggregate attendance for the employee for the selected month.
3. Derive attendance metrics:
   - working days
   - present days
   - payable days
   - LOP days
   - overtime if available
4. Resolve meta fields.
5. Resolve earnings and deductions in dependency order.
6. Create draft payroll entries.
7. Allow manual review/edit before finalization.

Important payroll rule:

- name and employee code come from employee records
- duties/payable days come from attendance, not from uploaded sample rows

## Dependency Resolution

Formula-based fields should be resolved in a deterministic order.

Implementation should:

- build a dependency graph
- detect missing references
- detect circular references
- surface validation errors in wage-config UI before save

If a formula references a deleted or disabled field, save should fail until corrected.

## Error Handling

### Upload

- if no usable header row is found, show a clear upload error
- if the sheet is empty, show a clear upload error
- if duplicate headings exist, auto-disambiguate labels while preserving originals

### Template Save

- fail if a kept field has no label
- fail if a formula-based field has no valid expression
- fail if a dependency reference is missing
- fail on circular references

### Payroll Generation

- if a client has no saved template, skip payroll generation for that client and surface a clear reason
- if a required attendance-driven field cannot be resolved, mark the payroll entry for review rather than finalizing silently

## Testing Strategy

### Parser tests

- detects all headings from the chosen header row
- preserves likely summary/meta columns in scan results
- classifies headings into meta/earning/deduction suggestions
- extracts sample values correctly

### Template validation tests

- saves fixed-value components
- saves formula-based components with dependencies
- rejects circular references
- rejects formulas with missing references

### Payroll calculation tests

- uses attendance-derived duties/payable days
- resolves fixed + formula + attendance-driven fields correctly
- derives PF-like formulas from dependent components
- generates draft payroll entries from client template rules

### UI tests

- shows all scanned fields after upload
- allows keep/edit/delete of scanned fields
- allows changing a field between earning/deduction/meta
- persists edited values and formulas

## Implementation Sequence

1. Remove AI-style payroll-template metadata from types and UI language.
2. Refactor upload parser to return scan-first field definitions.
3. Refactor wage-config page into field review + field behavior setup.
4. Add template validation for formulas and dependencies.
5. Refactor payroll calculation utilities to resolve the richer field model.
6. Update payroll run route to use attendance-driven metrics and the saved client template.
7. Add tests for parser, template validation, and payroll calculation.

## Risks

- Formula editing can become too flexible if not constrained to a safe expression model.
- Existing client wage configs may need a migration path if their shape changes.
- Some clients may have headings that blur meta fields and payroll fields; the admin review layer must remain mandatory.

## Recommendation

Proceed with a deterministic, admin-controlled payroll template builder.

The important product principle is:

- the system may suggest
- the admin decides
- the template remembers
- attendance drives monthly duties

That matches the operational workflow much better than AI-labeled component setup or generic salary-rule screens.
