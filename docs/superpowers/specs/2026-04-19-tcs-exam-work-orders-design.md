# TCS Exam Work Orders Refactor Design

Date: 2026-04-19
Project: CISS Workforce
Scope: TCS exam-duty work order import, revision handling, duplicate prevention, and admin/field-officer visibility

## Goal

Refactor the TCS work-order upload flow so admins can upload fresh exam duty files, revisions to previous files, and repeated files without creating duplicate or stale work orders.

The system should:

- support the real TCS exam-duty Excel formats currently used in the shared folder
- track exam-specific work orders, not just site/day totals
- prevent double-importing the same content
- safely handle revised exam duty files
- show exam names in admin and field-officer pages
- keep cancelled rows in history but hide them from active duty views

This feature applies only to TCS exam duties.

It does not change the non-exam regular-duty model for other clients or any permanent deployment logic outside exam-specific TCS imports.

## Current Problem

Today the app stores TCS exam uploads in `workOrders/{siteId}_{date}` style documents and merges manpower into a single site-day row.

That causes three operational problems:

1. Multiple exams on the same site and same day cannot be represented separately.
2. Re-uploading the same file or a revised file can silently double-count manpower or leave stale rows active.
3. Admin and field-officer pages cannot show which exam is driving a site's duty demand.

## Real File Findings

The provided TCS folder contains mixed file families, not one standard layout.

### Family A: legacy single-exam sheet

Examples from older files:

- exam name often appears in row 1 (`Exam Name:- ...`)
- date may appear in row 1
- row 2 contains site columns and one `Male/Female` pair
- data starts below those rows

### Family B: date-pivoted exam sheet

Examples from newer files:

- row 1 contains one or more exam dates
- row 2 contains paired `MALE/FEMALE` columns under each date
- rows contain sites and manpower counts
- exam name is often clearer in filename than inside sheet

### Consequence

The importer must support both parser families.

The system must not rely only on filename, and must not assume all files are date-pivoted.

## Non-Goals

- No migration of all legacy non-exam work orders in phase 1.
- No new rollup collection for daily site totals.
- No change to non-TCS work order behavior.
- No removal of historical cancelled rows.
- No forced global exam master registry in phase 1.

## Proposed Data Model

### 1. Exam-aware work order rows

TCS exam imports should create one row per:

- site
- date
- exam

Recommended doc id:

`{siteId}_{YYYY-MM-DD}_{examCode}`

Each document stores:

- `siteId`
- `siteName`
- `clientName: "TCS"`
- `district`
- `date`
- `examName`
- `examCode`
- `examCategory` optional
- `maleGuardsRequired`
- `femaleGuardsRequired`
- `totalManpower`
- `assignedGuards`
- `recordStatus`
- `importId`
- `sourceFileName`
- `contentHash`
- `binaryFileHash`
- `createdAt`
- `updatedAt`
- `importHistory`
- `supersededByImportId` optional
- `cancelledAt` optional
- `cancelledReason` optional

### 2. Work order import history collection

New collection:

`workOrderImports/{importId}`

Fields:

- `clientName`
- `fileName`
- `binaryFileHash`
- `contentHash`
- `examName`
- `examCode`
- `dateRange`
- `siteCount`
- `rowCount`
- `totalMale`
- `totalFemale`
- `mode` (`new` or `revision`)
- `status` (`committed`, `superseded`, `cancelled`)
- `importedBy`
- `importedAt`
- `parserMode`
- `diffSummary`

### 3. Record lifecycle

`recordStatus` values:

- `active`
- `cancelled`
- `superseded`

Active admin and field-officer views only show `active`.

History views can show all statuses.

## Exam Name and Exam Code Rules

### Exam name source priority

The importer should determine exam name using this order:

1. explicit sheet-level exam name when clearly present
2. filename-derived exam name
3. admin-edited name before confirm

Filename is a suggestion, not the only source of truth.

### Exam code

Exam code should be a normalized slug generated from the final exam name, but editable before confirm.

Examples:

- `bitsat-apr-2026`
- `sbi-ja-prelims-sep-2025`
- `nqt-npt-sep-2025`

This should be unique enough to distinguish meaningful exam scopes while remaining understandable to admins.

## Duplicate Detection Strategy

Use two hashes:

### 1. `binaryFileHash`

Hash of the original uploaded file bytes.

Used to detect exact same file re-uploaded.

### 2. `contentHash`

Hash of normalized parsed content:

- examCode
- site/date rows
- male/female values

Used to detect same effective data even if file name changed.

### Duplicate warning cases

#### Exact duplicate

If `binaryFileHash` already exists:

- show strong warning
- default action should be cancel or skip

#### Same content, different file

If `contentHash` already exists:

- show warning that same parsed data is already present
- allow user to stop before creating duplicate imports

#### Overlapping exam scope

If same `examCode` overlaps existing active rows in same date range but content differs:

- treat as likely revision
- prompt admin to continue in revision mode

## Parser Design

The importer should support two parser modes.

### Parser Mode A: legacy sheet format

Detection clues:

- row 1 contains `Exam Name:-`
- row 1 contains single exam date or single date block
- row 2 contains static columns and one `Male/Female` pair

Output:

- exam name
- one or more dates
- site/date manpower rows

### Parser Mode B: date-pivoted sheet format

Detection clues:

- row 1 contains one or more date cells
- row 2 contains paired `MALE/FEMALE`
- static site columns exist before date columns

Output:

- suggested exam name
- date list
- site/date manpower rows

### Parser output contract

After file read, parser should return:

- `parserMode`
- `suggestedExamName`
- `suggestedExamCode`
- `dateRange`
- `dates`
- `rows`
- `siteCount`
- `rowCount`
- `totalMale`
- `totalFemale`
- `warnings`

Each normalized row should include:

- `siteId` or site lookup identity
- `siteName`
- `district`
- `date`
- `maleGuardsRequired`
- `femaleGuardsRequired`

## Upload Flow

### Step 1: file intake

Admin uploads a TCS duty file.

System parses it and shows:

- parser mode
- suggested exam name
- suggested exam code
- date range
- row count
- site count
- total manpower

Admin can edit:

- exam name
- exam code
- import mode (`new` or `revision`)

### Step 2: duplicate and overlap check

System checks:

- existing `binaryFileHash`
- existing `contentHash`
- existing active rows for same `examCode` and overlapping dates

UI should warn clearly and offer:

- cancel
- continue as new import
- continue as revision

### Step 3: diff preview

Server computes authoritative diff and returns counts for:

- added
- updated
- unchanged
- cancelled-by-revision

Also show sample row details such as:

- old manpower to new manpower
- new sites added
- old active rows that will be cancelled

No write occurs until admin confirms.

## Write Semantics

Import writes must go through a server endpoint, not a client-side per-row Firestore loop.

Recommended endpoint:

`POST /api/admin/work-orders/import`

Input:

- file metadata
- exam metadata
- mode
- normalized parsed rows

Server responsibilities:

- verify admin
- re-check duplicate conditions
- compute authoritative diff
- batch write work order rows
- create `workOrderImports` record
- mark previous overlapping rows as cancelled in revision mode when omitted from new file

## Revision Behavior

Revision scope is:

- `examCode`
- uploaded date range

When a revision is confirmed:

- rows present in new file become current active rows
- rows with changed manpower are updated in place
- rows unchanged remain active
- rows that existed in previous active import scope but are absent in new file become `cancelled`

Cancelled rows:

- remain in history
- are hidden from active admin and field-officer lists

This matches the approved rule:

`cancelled in history, hidden from active list`

## UI Changes

### Admin work orders page

Keep the current site/date-oriented layout, but show exam chips or rows.

Example:

`15 Apr 2026`

- `BITSAT` `M3 F2`
- `NPTEL` `M2 F2`

Site/date totals should be computed as grouped read-time totals from active rows.

### Field-officer work orders page

Show only active rows in assigned districts.

Display same grouped exam breakdown so field officers know which exam is generating each deployment.

### Site detail page

For a given site, group by date, then show per-exam rows under that date.

Assignments should remain per exam row, not shared pool across all same-day exams.

## Assignment Model

Assignments should remain attached to each exam-specific work order document.

This is important because:

- same site can host multiple exams on same day
- manpower can differ by exam
- field timing can differ by exam
- audit trail must stay exam-specific

No shared site-day assignment pool should be introduced.

## Legacy Data Strategy

Phase 1 should not rewrite all legacy `workOrders/{siteId}_{date}` documents.

Instead:

- leave existing legacy rows as-is
- treat them as older general-duty or pre-exam-tracking records
- support new exam-aware docs for future TCS imports

UI can display legacy rows with a fallback label if needed:

- `Legacy`
- `General Duty`

This avoids risky migration during initial rollout.

## Rollout Plan

### Phase 1

- add exam-aware schema
- add dual-parser import support
- add duplicate detection
- add revision diff preview
- add server import endpoint
- update admin and field-officer work order screens to show exam names

### Phase 2

- add import history page
- add detailed import diff inspection
- add supersede/revert tooling

### Phase 3

- optional exam master registry
- optional legacy migration if operationally needed later

## Testing Plan

### Parser tests

Use sample files from the provided TCS folder to verify:

- legacy format parsing
- date-pivot format parsing
- exam-name extraction from row 1
- filename fallback when sheet exam name is missing

### Duplicate tests

Verify:

- exact same file triggers duplicate warning
- renamed same-content file triggers content duplicate warning
- overlapping exam scope with changed content triggers revision warning

### Revision tests

Verify:

- added rows become active
- updated rows change manpower correctly
- omitted rows become `cancelled`
- cancelled rows no longer appear in active admin/FO lists

### UI tests

Verify:

- admin sees per-exam rows/chips
- field officer sees per-exam rows/chips for assigned districts
- same site/day can show multiple exams distinctly

## Recommended Decisions Locked In

- Use exam-aware work order docs: yes
- Support both legacy and pivoted file formats: yes
- Exam name source priority: sheet, then filename, then admin edit
- Use both binary hash and content hash: yes
- Revisions cancel omitted old rows instead of hard delete: yes
- Active lists hide cancelled rows: yes
- Assignment model stays per exam row: yes
- No legacy rewrite migration in phase 1: yes

