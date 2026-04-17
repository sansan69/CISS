# Wage Sheet Client Template Design

## Goal
Build a reusable wage-sheet template system inside `Wage Configuration` so admins can upload one sample wage sheet per client, review detected components and formulas, save reusable rules, and later generate monthly payroll using attendance data plus the saved template.

This system must support the real client wage-sheet families found in `/Users/mymac/Documents/Sample Wagesheets`.

## Real sample-sheet families observed

### 1. Flat payroll register
Examples:
- `CORROHEALTH KOCHI-MAR2026.xls`
- `CORROHEALTH KOZHIKODE- MAR 2026.xls`
- `QUBE EKM- MAR 26.xls`
- `JAMMU & KASHMIR -MAR 2026.xls`

Characteristics:
- Actual header row starts immediately in row 1.
- Mostly numeric values already calculated.
- Typical columns include:
  - `Basic`
  - `DA`
  - `Reliver Charges`
  - `Duty Allowance`
  - `Gross`
  - `PF`
  - `ESI`
  - `Adv`
  - `Tot Ded`
  - `Net Wages`

### 2. Title rows + later header row + formula columns
Examples:
- `KSE LTD - MAR 26.xlsx`
- `LOGIWARE - MAR 26.xlsx`
- `CSIR KOCHI - MAR 26xlsx.xlsx`

Characteristics:
- Sheet contains title rows before actual header row.
- Header starts later (for example row 4 or row 5).
- Many columns are formula-driven.
- Typical columns include:
  - `BASIC&DA`
  - `EXTRA 4 HRS`
  - `W.ALL`
  - `Reliver Charges`
  - `BONUS(8.33%)`
  - `LEAVE(6.73%)`
  - `Uniform`
  - `GROSS`
  - `P.F.`
  - `ESI`

### 3. Formula-heavy component sheets
Examples:
- `LNG- MAR 2026.xlsx`
- `GEODIS PVT LTD- MAR 2026.xlsx`
- `TCS PERMANENT GUARDS-MAR 26.xlsx`

Characteristics:
- Both header text and cell formulas reveal payroll logic.
- Component calculations are embedded in Excel formulas.
- Header labels often include percentages, caps, or business meaning.
- Typical columns include:
  - `Basic + VDA`
  - `HRA(16% of Basic + DA...)`
  - `Uniform Outfit Allowance (5%)`
  - `Uniform Washing Allowance (3%)`
  - `Field Duty Allowance (25%)`
  - `Bonus (8.33%)`
  - `EPF (12% capped at 15,000)`
  - `EDLI`
  - `Admin Charges`
  - `Wash Allow`
  - `Leave salary`

## Product decision
This system will create a reusable client template.

It will **not** treat the uploaded sheet as the monthly payroll source of truth. Instead:
- admin uploads one sample sheet per client
- the system extracts reusable payroll structure
- the admin reviews and saves rules
- later payroll runs use attendance plus saved rules

## Design decisions confirmed
- If both header meaning and cell formula exist, the UI shows both and the admin chooses which one to keep.
- Raw client labels should map to standard internal names, but original sheet labels should still be preserved and visible.
- Attendance-linked values should auto-bind to attendance by default, but the admin can override them during payroll review.
- Hard-coded numeric bases found in formulas should be stored in a shared client constants table rather than buried only in raw formula text.
- The system should use deterministic sheet parsing and rule building. AI language and AI confidence metadata should be removed from this feature surface.

## Upload flow inside Wage Configuration

### Stage 1. Upload
Admin selects a client and uploads one sample `.xls` or `.xlsx` wage sheet.

The parser must detect:
- workbook sheet name
- active sheet being parsed
- actual header row even if title rows exist above it
- sheet family
  - flat register
  - title-row register
  - formula-heavy register
- detected columns
- sample values
- sample Excel formulas
- likely summary columns

### Stage 2. Upload review
The upload result screen should show:
- detected header row
- selected worksheet
- detected sheet family
- scanned columns
- 3 to 5 sample values per column
- formula evidence from cell formulas when present
- formula meaning from header text when present
- whether a column looks like:
  - meta field
  - attendance field
  - earning
  - deduction
  - employer contribution
  - summary field

The admin can move to `Template Builder` from here.

## Template Builder UX
Each scanned field becomes a review row or card.

Each row shows:
- original sheet label
- standard mapped internal name
- category
  - meta
  - attendance
  - earning
  - deduction
  - employer contribution
  - summary only
- formula source
  - header text
  - cell formula
  - both
- constants used
- attendance binding flag
- keep or ignore state
- sample values

The admin can:
- keep a field
- ignore a field
- rename the display label
- change the standard mapping
- choose between header-derived and cell-derived rule meaning
- edit constants used by the rule
- move the field to a different category
- reorder fields

### Columns hidden by default
The builder should default-summary columns to ignored or summary-only because they should usually be derived rather than treated as primary input rules.

Examples:
- `Gross`
- `Net Wages`
- `Tot Ded`
- `Salary Payable`
- `Total Employee Contribution`
- `Total Employer Contribution`

The admin can still include them as summary-only fields if needed.

## Classification model
The parser should split scanned columns into these buckets.

### Attendance or meta
Examples:
- employee name
- employee code
- district
- branch
- rank
- duties
- WF / W/0
- ED
- HD
- TOTAL
- NO.OF DUTIES
- No. of Additional Duties

These are not normal wage components.

### Earnings
Examples observed in sample files:
- Basic
- DA
- Basic + VDA
- HRA
- Bonus
- Wash Allow
- W.ALL
- Uniform
- Uniform Outfit Allowance
- Uniform Washing Allowance
- Reliver Charges
- Duty Allowance
- Extra 4 Hrs
- Leave Salary
- Field Duty Allowance
- Arrear columns

### Deductions
Examples observed in sample files:
- PF
- ESI
- PT
- Advance / Adv
- LWF
- TDS
- Total Deduction

### Employer contributions
Examples observed in sample files:
- EDLI
- Admin Charges
- employer-side PF or ESI columns

### Summary or output-only fields
Examples observed in sample files:
- Gross
- Net Wages
- Salary Payable
- Total Employee Contribution
- Total Employer Contribution

## Formula understanding model
For every kept field, the system should preserve enough evidence for audit and review.

Each field should carry:
- original label
- standard internal name
- detected category
- sample values
- sample cell formulas
- formula meaning inferred from header text
- whether it depends on attendance values
- whether it depends on shared constants
- whether it depends on other components
- final admin-approved rule source

If header text and cell formula disagree or imply different logic, the field should be flagged for admin review.

## Saved template data model
The saved client wage template should have four layers.

### 1. Sheet schema
Stores what was scanned from the uploaded sample sheet.

Suggested fields:
- sheet name
- header row index
- detected sheet family
- detected columns
- original labels
- sample formulas
- sample values
- parser version metadata

### 2. Standard field map
Maps raw client sheet labels to stable internal meaning.

Examples:
- `P.F.` -> `pf_employee`
- `W.ALL` -> `wash_allowance`
- `Reliver Charges` -> `reliever_charges`
- `BASIC&DA` -> `basic_da_combined` or split decision if supported later

The original label remains visible, but payroll evaluation uses the standard internal name.

### 3. Client constants table
Shared numeric values extracted from formulas and edited by the admin.

Examples:
- `basic_rate`
- `da_rate`
- `wash_allowance_rate`
- `uniform_rate`
- `extra_4_hours_rate`
- `field_duty_allowance_rate`
- `epf_cap`
- `epf_percent`
- `esi_percent`
- `hra_percent`
- `bonus_percent`
- `standard_month_days`

These constants are client-specific and reusable.

### 4. Component rules
Each kept component stores:
- original label
- standard name
- category
- chosen formula source
- rule type
- dependencies
- constant keys used
- attendance binding metadata
- summary-only flag
- display order

## Rule model
The evaluator should support at least these rule types:
- `attendance_bound`
- `fixed_amount`
- `per_duty_rate`
- `percentage_of_component`
- `sum_of_components`
- `formula_expression`
- `summary_only`
- `deduction_rule`
- `employer_contribution_rule`

This is richer than the current narrow calculation type list and should either extend or replace that model for template-backed payroll.

## Examples of normalized rule behavior

### Basic
- category: earning
- rule type: `per_duty_rate`
- expression concept: `(basic_rate / standard_month_days) * payable_duties`

### DA
- category: earning
- rule type: `per_duty_rate`
- expression concept: `(da_rate / standard_month_days) * payable_duties`

### PF
- category: deduction
- rule type: `formula_expression`
- expression concept: `min(epf_base, epf_cap) * epf_percent`

### Gross
- category: summary-only
- rule type: `summary_only`
- expression concept: `sum(all earning components)`

### Total Deduction
- category: summary-only
- rule type: `summary_only`
- expression concept: `sum(all deduction components)`

### Net Wages
- category: summary-only
- rule type: `summary_only`
- expression concept: `gross - total_deduction`

## Special formula cases the parser must handle
- title rows above the actual header row
- combined fields like `BASIC&DA`
- formulas expressed in header labels
- formulas expressed in Excel cells
- percentage-based calculations
- capped calculations such as EPF cap at 15000
- per-duty calculations
- extra-duty or overtime calculations
- derived summary columns
- constants repeated across many rows
- different labels for the same concept across clients

## Payroll generation behavior
During monthly payroll generation:
1. system loads the saved client wage template
2. system reads monthly attendance data for each employee
3. system auto-fills attendance-bound values
   - duties
   - WF / W/0
   - ED
   - HD
   - totals or payable duties
4. system evaluates component rules in dependency order
5. system computes earnings, deductions, employer contributions, and summary outputs
6. system presents a review screen before finalization

## Override behavior
Attendance-linked fields should be auto-bound by default, but the admin may override them during payroll review.

Each override should store:
- field changed
- old value
- new value
- reason
- changed by
- changed at

This supports operational correction without losing auditability.

## Validation and safety requirements
The system should catch and surface these before saving or generating payroll:
- no header row detected
- no usable component columns found
- conflicting formula interpretations from header vs cell formula
- summary field incorrectly marked as earning or deduction
- missing constants required by chosen rules
- circular dependencies between components
- attendance-bound fields misconfigured as fixed components
- combined fields mapped inconsistently
- unsupported formula patterns that need manual confirmation

## Testing targets
The system should be verified against the real sample families.

### Flat register family
- `CORROHEALTH`
- `QUBE`
- `JAMMU & KASHMIR`

### Title-row register family
- `KSE`
- `LOGIWARE`
- `CSIR`

### Formula-heavy family
- `LNG`
- `GEODIS`
- `TCS`

## Success criteria
This feature is complete when:
- sample wage sheets upload successfully in Wage Configuration
- header detection works across all three observed families
- the parser displays components and formula evidence correctly
- admin can review and save a reusable client wage template
- monthly payroll can use attendance plus saved template rules
- AI wording and AI confidence metadata are removed from the wage-template UX

## Non-goals for this phase
- using uploaded monthly wage sheets as the primary payroll input each month
- full auto-finalization with zero admin review
- supporting arbitrary spreadsheet formula functions beyond the supported rule model
- solving unrelated payroll UI cleanup outside the wage-template feature
