# MEMORY.md — CISS Workforce Codebase Changelog

This file is the authoritative log of all changes made to the codebase.
**Read this before implementing anything.** Update it after every change.

---

## [2026-05-02] — Session: Remove overtime, LOP, and leave from entire app

Overtime and leave are not part of the CISS workforce model. All related code removed.

### Deleted files
- `src/types/leave.ts` — Leave request and balance types
- `src/lib/payroll/leave-aggregator.ts` — Leave aggregation for payroll
- `src/lib/leave-balances.ts` — Leave balance doc ID builders
- `src/lib/leave-balances.test.ts` — Tests for leave-balances
- `src/app/(guard)/guard/leave/page.tsx` — Guard leave application page
- `src/app/api/guard/leave/route.ts` — Guard leave API (GET/POST/PATCH)
- `src/app/(app)/leave/page.tsx` — Admin leave management page
- `src/app/api/admin/leave/requests/route.ts` — Admin leave requests API
- `src/app/api/admin/leave/requests/[id]/route.ts` — Admin leave approve/reject API

### attendance-aggregator.ts
- Removed `lopDays` and `overtimeHours` from `AttendanceSummary` interface
- Removed all overtime calculation logic (shift hours, logsByDate with timestamps, hoursWorked)
- Removed lopDays calculation
- Simplified to just count unique present dates per month and compute working days

### Payroll types (`src/types/payroll.ts`)
- Removed `overtimeAmount` from `PayrollEntryEarnings`
- Removed `lopDeduction` from `PayrollEntryDeductions`
- Removed `approvedPaidLeaveDays`, `approvedUnpaidLeaveDays`, `lopDays`, `overtimeHours`, `overtimeAmount` from `PayrollEntry`

### Payroll run (`src/app/api/admin/payroll/run/route.ts`)
- Removed `aggregateApprovedLeave` import and call
- Removed `lopDays` computation and `payableDays` offset by leave
- `payableDays` now equals `min(workingDays, presentDays)` directly
- Removed `lopDeduction` from deductions object
- Removed `overtimeHours`/`overtimeAmount` and leave days from entry construction
- `attendanceInputs.weekly_off` and `extra_duty_days` set to 0; `additional_duties` set to 0

### Payroll calculate.ts
- Removed `calculateLOP()` function

### Payslip (`src/lib/payroll/payslip.ts`)
- Removed "LOP Days" label from header
- Removed "Overtime" row from earnings
- Removed "LOP Deduction" row from deductions

### Wage template parser
- Removed `overtime` alias from extra_duty_amount regex
- Removed `leave_salary|leave` alias

### Notifications (`src/lib/notifications.ts`)
- Removed `leave_approved` and `leave_rejected` notification types

### Guard pages
- `guard/attendance/page.tsx` — Removed `absentDays` from interface and UI (was red "Absent" card)
- `guard/attendance/route.ts` — Removed `absentDays` from API response, removed `workingDaysInMonth` function
- `guard/dashboard/page.tsx` — Removed `leaveBalance` from `DashboardData` type; replaced "Leave balance" stat card with "Working days"; replaced "Apply Leave" quick action with "Training"
- `guard/dashboard/route.ts` — Removed `leaveBalance` section (30+ lines of leave doc lookup), removed `absentDays` from response, removed `buildLeaveBalanceLookupIds` import
- `guard-bottom-nav.tsx` — Removed "Leave" tab from bottom nav

### Admin dashboard
- `dashboard/page.tsx` — Removed `onLeave` from `DashboardStats`, removed "On Leave" stat def, removed `onLeave` counting from employee snapshot loop, removed "on leave" text from super-admin card, removed "On Leave" from region detail card
- `components/dashboard/stats.tsx` — Removed `onLeave` from stats interface, removed "On Leave"/"Pending Leave" from all role configs, updated `getValue()` mapping
- `components/dashboard/actions.tsx` — Removed "Leave Requests" from HR quick actions

### Region + client types
- `src/types/region.ts` — Removed `onLeaveEmployees` from `RegionDetail.totals` and `SuperAdminOverviewSummary`
- `src/types/client-dashboard.ts` — Removed `onLeaveGuards` from `ClientDashboardSummary`

### Super-admin overview + client dashboard APIs
- `src/app/api/super-admin/overview/route.ts` — Removed all `onLeaveEmployees` references
- `src/app/api/client/dashboard/route.ts` — Removed `onLeaveGuards` computation

### Payroll UI
- `payroll/cycles/[id]/page.tsx` — Removed LOP column from table and CSV export
- `payroll/cycles/[id]/entries/[entryId]/page.tsx` — Removed LOP Days and LOP Deduction display
- `payroll/cycles/[id]/worksheet/route.ts` — Removed LOP Days, LOP Deduction, Paid Leave Days, Unpaid Leave Days columns

### Verification
- `tsc --noEmit` clean, `eslint` clean (only pre-existing warnings)

---

## [2026-05-02] — Session: Attendance flow audit fixes

Continuation of attendance flow fix. Addresses remaining issues from full audit.

### Guard attendance API — date-range filter (`src/app/api/guard/attendance/route.ts`)
- Added `attendanceDate >= firstDay` and `attendanceDate <= lastDay` to both the `employeeDocId` and `employeeId` fallback Firestore queries.
- Removed `.limit(500)` from both queries — date-range filter constrains results naturally.
- Removed in-memory `.filter((log) => log.date >= firstDay && log.date <= lastDay)` since Firestore now handles it.

### Attendance calendar UTC vs IST (`src/components/guard/attendance-calendar.tsx`)
- `isToday()` and `isFutureDate()` used `new Date().toISOString().slice(0,10)` which is UTC — wrong between 11:30 PM–midnight IST.
- Replaced with `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())` for IST-correct date.
- Also fixed `canGoNext` month comparison which used the same UTC `toISOString()`.

### Zod schema for attendance logs (`src/types/attendance.ts`)
- `attendanceLogSchema` used `z.any()` for `reportedAt` and `createdAt`, losing all type safety.
- Replaced with `z.custom()` that validates Firestore Timestamp-like objects (`{ seconds, nanoseconds, toDate() }`), `Date`, or `null/undefined`.
- Added `FirestoreAttendanceLog` interface for admin attendance-logs page — matches actual Firestore document shape with `Timestamp`-like objects, optional fields, and `attendanceDate`.

### Duplicate AttendanceLog types
- `src/app/(app)/attendance-logs/page.tsx` had its own 35-line `AttendanceLog` type duplicating `@/types/attendance`. Replaced with `type AttendanceLog = FirestoreAttendanceLog`.
- `src/components/guard/attendance-calendar.tsx` had `AttendanceLog` with completely different fields (view-model for calendar). Renamed to `CalendarAttendanceEntry` to avoid confusion. Updated `src/app/(guard)/guard/attendance/page.tsx` import.

### Hardcoded geofence radius 150
- `src/app/attendance/page.tsx` had 4 instances of `|| 150`. Replaced with `|| DEFAULT_GEOFENCE_RADIUS_METERS` from `@/lib/constants`.
- `src/lib/attendance/public-attendance.ts` had `?? 150`. Replaced with `?? DEFAULT_GEOFENCE_RADIUS_METERS`.
- Added `DEFAULT_GEOFENCE_RADIUS_METERS` import to both files.

### Firestore rules — attendanceState vs attendanceStates (`firestore.rules`)
- Rules comments said `attendanceStates` (plural) was "primary" and `attendanceState` (singular) was "legacy".
- All server code uses `attendanceState` (singular) — it is the active collection. Corrected comments and reordered rules to put singular first with proper permissions (guards can create/update their own). Plural marked as legacy.

### Payroll attendance aggregator — shift-aware overtime (`src/lib/payroll/attendance-aggregator.ts`)
- `STANDARD_WORKING_HOURS = 8` was hardcoded — guards on 12-hour shifts got 4hrs fake overtime every day.
- Added `parseShiftHours(startTime, endTime)` helper that parses `HH:MM` shift times from attendance log data.
- Overtime now computed per-day against the actual shift hours from the log (`shiftStartTime`/`shiftEndTime`). Falls back to 8 hours if shift data is missing.
- `LogEntry` type extended with `shiftStartTime`/`shiftEndTime` fields.

### Verification
- `tsc --noEmit` clean, `eslint` clean (only pre-existing warnings).
- 3 pre-existing surface-test failures unrelated to these changes.

---

## [2026-05-02] — Session: Attendance flow — remove clientLocations, fix sourceCollection

- Guards should only record attendance at sites (duty centers), not office/client locations. The attendance page was incorrectly including `clientLocations` in the site picker and auto-detection, mixing office locations with actual guard duty sites.
- **`src/app/api/public/attendance/route.ts`** — Removed `clientLocations` fetch entirely. Now only returns `sites` collection. Removed the dedup logic since there's no second collection.
- **`src/app/attendance/page.tsx`** — Removed "Office" badge rendering for `clientLocations`. Made `sourceCollection` optional in `SiteOption` type. Removed `sourceCollection === 'sites'` guards on duty-point display (now always shows duty points). Defaulted `sourceCollection` to `'sites'` in the submission payload.
- **`src/app/api/attendance/submit/route.ts`** — Added `sourceCollection` to the `transaction.set()` Firestore write (was missing, causing the field to always be `undefined` in stored logs). Removed `(payload as any).sourceCollection` cast since the Zod schema already defines the field.
- Verification: `tsc --noEmit` and `eslint` pass clean.

---

## [2026-05-01] — Session: Legacy employee district visibility for field officers

- Root cause: older employee docs can have district data in legacy shapes/aliases, while field-officer employee directory used an exact Firestore `district in assignedDistricts` filter and assignment lookup only read `employee.district`. That made older guards disappear from FO pages or assignment dialogs even when they belonged to the correct district.
- Added `src/lib/employees/visibility.ts` to resolve employee district from modern `district`, legacy district-like fields (`districtName`, `currentDistrict`, `permanentDistrict`, `addressDistrict`, `locationDistrict`, `city`), or address keyword inference.
- Updated work-order guard assignment filtering and `/api/field-officer/guards` to use shared employee district resolution and return canonical district names.
- Updated FO employee directory to avoid exact district-only Firestore filtering; it now applies legacy-aware district matching in memory after fetching the candidate employee set.
- Updated FO dashboard guard count to remove unsafe `.limit(500)` and use the same legacy-aware district matcher.
- Added regression tests for legacy `districtName: "Cochin"` and address-inferred employee districts.
- Data audit: current live employee docs already have valid district values for real districts; no production employee district backfill was required.
- Verification: `npx vitest run src/app/api/field-officer/ src/lib/work-orders/ src/lib/employees/visibility.test.ts src/lib/districts.test.ts src/app/work-orders-surface.test.ts` → 37 passed (8 files). `npx tsc --noEmit -p tsconfig.typecheck.json` → clean.

---

## [2026-05-01] — Session: Remove legacy mobile app

- Deleted the tracked legacy mobile app tree from the repository.
- Deleted the three old mobile planning documents under `docs/`.
- Updated `firestore.rules` comments to remove stale platform-specific wording while preserving the existing guard-auth rule behavior.
- Verification: the legacy mobile app directory is absent, and a repository scan found no remaining platform-specific references in the active working tree.

---

## [2026-05-01] — Session: End-to-end work-order import + assignment fixes (May 2-10 regression)

**Symptoms reported:** Recently uploaded TCS centres/sites missing from field-officer pages; assignment dialog often shows "no guards to map"; suspected district parsing/mapping issue; problem most visible for uploads dated 2-10 May 2026.

**Root causes identified:** empty/non-canonical district on imports when the file has no recognised district column; "Location" alias collision between `siteName` and `district`; commit-route site lookup keys district into the cache so a corrected district creates a duplicate site instead of updating the existing one; `field-officer/guards` and `field-officer/work-orders` API routes used `.limit(1000)` without ordering (silent truncation past the cap); admin assign dialog passed `[""]` as district scope when site district was missing → empty guard list; legacy "South 2" zone label and alias districts (Trivandrum/Cochin) not consistently canonicalised.

**Files modified:**

### 1. Parser district resolution
- `src/lib/work-orders/tcs-exam-parser.ts`
  - Removed `"location"` from `STATIC_HEADER_ALIASES.district` so it no longer doubles as siteName + district.
  - Added `"tc address"` / `"address"` as site-name fallbacks and `"zone"` / `"zone name"` as district-zone inputs, so TCS rows with `STATE / TC ADDRESS / ZONE / Male / Female` parse instead of being skipped.
  - `resolveStaticHeaderIndices` now skips a header role once a previous role has claimed the column (prevents the same column index being assigned to siteName *and* district).
  - Uses the shared Kerala-district keyword scan from `src/lib/districts.ts` (covers all 14 districts plus common town-level keywords like Aluva, Kakkanad, Calicut, Kanhangad, etc.).
  - New `resolveDistrictFromRow(rawDistrict, row)` is used by both the legacy and pivot parsers — if the district column is missing or doesn't resolve to a Kerala district, scan all cells in the row for a keyword.
  - `extractExamName` now rejects single-word generic file-derived names (e.g. "requirement") so the row-title fallback can fire.
- `src/lib/work-orders/tcs-exam-parser.test.ts` — added tests for keyword fallback, Location-collision avoidance, "South 2" → Ernakulam, alias canonicalisation (Trivandrum/Cochin), and the no-signal case.

### 1a. Shared district source of truth
- `src/lib/districts.ts`
  - Now owns `KERALA_DISTRICTS`, aliases, search variants, TCS zone mapping, and district keyword inference helpers.
  - `src/lib/constants.ts` re-exports `KERALA_DISTRICTS` for compatibility; new/direct district consumers should import from `@/lib/districts`.
  - Settings pages now import `KERALA_DISTRICTS` from `@/lib/districts`.
- `src/lib/districts.test.ts` — added coverage for `"South 2"` mapping, address-based district inference, and alias canonicalisation before FO matching.

### 2. Commit route site lookup tolerates district changes
- `src/app/api/admin/work-orders/import/commit/route.ts`
  - Added `buildSiteCodeKey` and `buildSiteNameKey` helpers (district-free).
  - `fetchSites` now also indexes `byCode` and `byName`, and accepts the TCS client via `clientId` match (in addition to `clientName`) so legacy variants of the client name are still recognised.
  - `resolveCommitRows` now tries `byCodeDistrict → byFallback → byCode → byName` for site lookup. When district has changed, the existing site is updated in place (instead of creating a duplicate). The update also pins `clientName` to the canonical `OPERATIONAL_CLIENT_NAME` and links `clientId`.
  - Newly created sites are inserted into all four lookup maps to avoid a row in the same import re-creating them.

### 3. `field-officer/guards` endpoint
- `src/app/api/field-officer/guards/route.ts`
  - Removed unsafe `.limit(1000)` on the employees collection. The active-status filter still runs in memory because it has to be case-insensitive.

### 4. `field-officer/work-orders` endpoint
- `src/app/api/field-officer/work-orders/route.ts`
  - Replaced `.limit(1000)` with a server-side `where("date", ">=", today)` + `orderBy("date", "asc")` query that mirrors the FO panel's client-side query.
  - Filters by `isOperationalWorkOrderClientName` (TCS-only).
  - Resolves the authoritative district from `sites/{siteId}` first, then falls back to the work-order's own district — same logic as the panel uses.

### 5. Available-guards helper
- `src/lib/work-orders/available-guards.ts`
  - `fetchActiveGuardsForDistricts` accepts a new `{ allowEmptyScope?: boolean }` option. When the admin opens the assign dialog on a site with no district, the helper falls through to the API (which returns all active guards for admins) instead of returning an empty list.
  - When the scope is empty and the API returns guards, the helper sorts them by name client-side without district filtering.

### 6. Admin assign dialog (site detail page)
- `src/app/(app)/work-orders/[siteId]/page.tsx`
  - `handleOpenAssignDialog` now resolves the dialog scope explicitly: admins fall back to "all active guards" (with a destructive toast warning to fix the site district); field officers stay scoped to their assigned districts even when the site district is missing.

### 7. Field-officer panel assign dialog
- `src/components/field-officers/work-orders-panel.tsx`
  - Same fallback pattern in `handleOpenAssign`: admin without site district → all active guards + warning toast; FO → their assigned districts.

### 8. District backfill API
- `src/app/api/admin/work-orders/backfill-districts/route.ts` (new)
  - Admin-only `POST` route. Optional `?dryRun=true` for preview.
  - Pass 1 — sites: scans every TCS site, canonicalises aliases, runs the Kerala keyword scan over `district + siteName + siteAddress` to infer a real district when the stored value is empty or non-canonical (incl. legacy `"South 2"`), and updates the site doc + `locationKey`.
  - Pass 2 — workOrders: iterates work orders in 500-doc batches and aligns `workOrders.district` to the resolved site district.
  - Reports `sitesScanned`, `sitesUpdated`, `workOrdersUpdated`, plus a list of sites still needing manual attention (no district signal in any field).

**Tests:** `npx vitest run src/app/api/field-officer/ src/lib/work-orders/ src/lib/districts.test.ts src/app/work-orders-surface.test.ts` → 32 passed (7 files). `npx tsc --noEmit -p tsconfig.typecheck.json` → clean.

**Operator follow-up:** run `POST /api/admin/work-orders/backfill-districts?dryRun=true` once on production to preview, then run it for real to repair sites/work-orders that still hold `"South 2"` or empty districts from the May 2-10 imports.

---

## [2026-04-30] — Session: Attendance duty-point requirement, work-order district resolution, and client/site name matching

**Files modified:**

### 1. Attendance now requires an explicit duty point selection
- `src/app/attendance/page.tsx` — removed the silent auto-pick for duty points and made the review step show a prominent required duty-point selector before submission.
- When a site has duty points, the submit button now clearly blocks with `Select duty point first` until one is chosen.

### 2. Work orders now resolve districts from the site record first
- `src/components/field-officers/work-orders-panel.tsx` — field officer upcoming duties now use the site district as the authority, not just the raw work-order district.
- `src/app/(app)/work-orders/[siteId]/page.tsx` — admin assignment lookup now uses the resolved site district and expands district aliases before querying guards.
- `src/lib/districts.ts` — keeps alias support for district spellings like `Trivandrum` and `Thiruvananthapuram`.

### 3. Client/site matching now tolerates punctuation differences
- `src/lib/server/client-access.ts` — client scope matching now normalizes punctuation and possessives, so names like `Anil` and `Anil's` resolve together.
- `src/lib/sites/site-directory.ts` — site-to-client matching now uses the same normalized key, so sites do not disappear from client pages because of punctuation differences.
- `src/app/page.tsx` — landing page polish and portal entry UI refresh.
- `src/lib/sites/site-directory.test.ts` — regression for client-name matching across punctuation differences.
- `src/app/api/mobile/session/route.test.ts` — regression coverage for field officer and guard mobile session resolution.

**Behavioral impact:**  
These changes keep attendance duty-point selection explicit, make field officer work orders line up with the authoritative site district, and prevent client-scoped sites from disappearing because of punctuation-only name differences.

---

## [2026-04-28] — Client Portal: Credential Management + Per-Client Dashboard Visibility

**Problem:** Admin had no way to edit client portal user credentials (name/email/password) or control which dashboard sections each client could see. All clients saw identical dashboards.

**Files created:**
- `src/types/client-permissions.ts` — `ClientDashboardModule` type, `DEFAULT_CLIENT_MODULES`, `CLIENT_MODULE_LABELS`, `CLIENT_MODULE_DESCRIPTIONS`, `resolveClientModules()` helper

**Files modified:**

### 1. PATCH API for client user credentials
- `src/app/api/admin/client-users/[id]/route.ts` — added `PATCH` handler
  - Accepts `name`, `email`, `password` (any subset)
  - Updates Firebase Auth user (`displayName`, `email`, `password`) via Admin SDK
  - Updates Firestore mapping docs (`clientUsers` + `clientUsersByUid`)
  - Validates email format, password min length 6
  - Writes audit trail to `clientUserAudit`
  - Password change is optional (blank = keep current)

### 2. Client PATCH API accepts dashboardModules
- `src/app/api/admin/clients/[id]/route.ts` — `PATCH` now accepts `dashboardModules: Record<string, boolean>`
  - Stored directly on the client Firestore document
  - Controls which dashboard sections the client portal shows

### 3. Admin UI: Portal Config tab on client detail page
- `src/app/(app)/settings/clients/[clientId]/page.tsx` — major additions:
  - **Enhanced Users tab:** each portal user now has Edit (pencil) and Delete (trash) buttons
  - **Edit User dialog:** change name, email, password for any portal user
  - **Create User dialog:** add new portal users directly from client page (no redirect)
  - **Delete User confirmation:** removes portal access
  - **Portal Config tab:** new tab with 7 toggle switches for dashboard modules:
    - Summary Banner & Stats
    - Live Attendance Table
    - Top Sites Snapshot
    - Upcoming Work Orders
    - Visit Reports
    - Training Reports
    - Guard Highlights
  - "Reset to Default" and "Save Visibility" buttons
  - Each toggle shows Eye/EyeOff icon for visual clarity

### 4. Dashboard API returns module config
- `src/app/api/client/dashboard/route.ts` — loads `dashboardModules` from client document and includes it in the response payload

### 5. Client dashboard respects permissions
- `src/components/dashboard/client-operations-dashboard.tsx` — conditionally renders each section based on `dashboardModules` from the API response
  - Disabled sections are completely hidden (not just greyed out)
  - Default: all modules visible (backward compatible)

### 6. Type updates
- `src/types/client-dashboard.ts` — added optional `dashboardModules` field to `ClientDashboardPayload`

**Firestore field:** `clients/{clientId}.dashboardModules` — `{ summary: true, attendance: true, sites: true, workOrders: true, visitReports: true, trainingReports: true, guardHighlights: true }`

**No migration needed:** existing clients without `dashboardModules` get all modules visible by default via `resolveClientModules()`.

---

## [2026-04-25] — Claude Code Best Practices Implementation

**Files created:**
- `.claude/settings.json` — Team-shared permissions (clean, no secrets)
- `.claude/settings.local.json` — Personal overrides, removed hardcoded API keys
- `.claude/rules/firebase.md` — Firebase/Server-side path rules
- `.claude/rules/payroll.md` — Payroll/wage-config domain rules
- `.claude/rules/api-routes.md` — API route patterns
- `.claude/rules/components.md` — UI component patterns
- `.claude/commands/deploy.md` — `/deploy` command
- `.claude/commands/typecheck.md` — `/typecheck` command
- `.claude/commands/db-query.md` — `/db-query` command
- `.claude/agents/code-reviewer.md` — Code reviewer subagent
- `.claude/agents/firebase-expert.md` — Firebase expert subagent
- `.mcp.json` — Added Context7 MCP server

**Security fix:** Removed OpenAI API keys and Milvus tokens from `settings.local.json` (were hardcoded).

**CLAUDE.md updated:** Added Project Configuration section documenting new structure.

---

## [2026-04-25] — Session: PIN setup optional after enrollment, profile download on completion screen

**File modified:** `src/app/enroll/page.tsx`
- **Feature:** After successful enrollment, form is replaced by a dedicated completion screen (no redirect to `/profile/{id}`).
- Completion screen shows: employee ID, "Download Profile Kit" button, "Set up PIN to access your profile" link.
- Download generates a simple branded PDF profile using `pdf-lib` (fetches employee data via `/api/employees/public-profile/{id}`).
- "Set up PIN" is a link, not a redirect — guard can skip it.
- "Register Another Person" button resets state and returns to step 1.
- PIN setup still required on guard login (unchanged).

**File created:** `src/lib/pdf-utils.ts`
- Shared PDF helpers: `normalizePdfText`, `wrapTextToWidth`, `drawMultilineText`, `sanitizePdfString`, `titleCase`, `fetchImageBytes`.
- Extracted from profile page; available for reuse by both completion screen and full profile PDF.

---

## [2026-04-25] — Session: Sort by exam name, import history rewrite, parser fixes, tasks removed

**File modified:** `src/app/(app)/work-orders/page.tsx`
- **Feature:** Replaced "Sort by date" dropdown with "Sort by" dropdown supporting 4 options:
  - Date: Earliest first / Latest first
  - Exam: A to Z / Z to A
- Sort URL parameter changed from `dateSort` (asc/desc) to `sort` (date-asc, date-desc, exam-asc, exam-desc).
- Added URL cleanup useEffect to remove old `dateSort` param from bookmarks.
- Sort applies to both inner work orders within a site and site groups themselves.

**File rewritten:** `src/app/(app)/work-orders/imports/page.tsx`
- **Feature:** Import History page now queries `workOrders` collection directly instead of `workOrderImports` (which only had 1 document).
- Groups all work orders by `sourceFileName` + `examName` in the browser.
- Shows aggregated stats per upload: date range, site count, work order count, total guards.
- No Firestore composite index required — uses simple collection query.
- Loads all ~2,598 work orders including legacy data.

**File modified:** `src/lib/work-orders/tcs-exam-parser.ts`
- **Fix:** Removed `"zone"` and `"zone name"` from `STATIC_HEADER_ALIASES.district`. TCS files have ZONE column ("South 2") before CITY column (real district). Parser was matching ZONE first and never reaching CITY.
- **Fix:** Added `isGenericExamName()` guard to reject short/single-word/header-like candidates from sheet content before falling back to filename.
- Added `"zone"`, `"zone name"`, `"tc address"`, `"address"`, `"sno"` to `GENERIC_TITLE_HEADERS` exclusion set.
- Improved `cleanExamNameFromFilename()`:
  - Handles `CISS -` prefix via `-` separator fallback.
  - Removes `security guards` / `requirement` / `requirment` prefixes.
  - Removes `which is scheduled` / `scheduled` / `dated` date prefixes.
  - Uses first ` for ` instead of last (safer for typical filenames).

**Files modified:** `src/app/(app)/work-orders/page.tsx`, `src/app/(app)/work-orders/[siteId]/page.tsx`
- **Removed:** Tasks tab from main Work Orders page and Site Tasks card from site detail page.
- Todo API routes and component still exist in codebase but are unused.

---

## [2026-04-25] — Session: Exam filter, bulk delete, district from file

**File modified:** `src/app/(app)/work-orders/page.tsx`
- **Feature:** Added exam name filter dropdown (URL-synced, works alongside district filter).
- **Feature:** Added "Delete Exam" button (admin only) visible when an exam filter is selected. Opens confirmation dialog, then calls bulk-delete API to cancel all active work orders for that exam.
- Added Dialog imports and bulk-delete state (`bulkDeleteExam`, `isBulkDeleting`).

**File created:** `src/app/api/admin/work-orders/bulk-delete/route.ts`
- `POST /api/admin/work-orders/bulk-delete` — requires admin, body `{ examName: string }`.
- Finds all active work orders with matching `examName`, batch-updates their `recordStatus` to `"cancelled"` with audit fields.

**File modified:** `src/app/api/admin/work-orders/import/commit/route.ts`
- **Fix:** Existing sites now have their district updated when an uploaded file provides a different district. Previously only new sites got the file's district; existing sites kept their old district forever.
- This ensures re-importing a file with corrected district names will update both work orders AND sites.

---

## [2026-04-25] — Session: Firestore backfill + UI cleanup + task management

**Firestore data backfill (direct via Firebase Admin SDK with gcloud ADC):**
- Fixed 29 work orders: `examName` changed from `"TC Address"` → `"CSL Exam"`.
- Fixed 1 import document in `workOrderImports`: `examName` changed from `"TC Address"` → `"CSL Exam"`, `examCode` changed from `"tc-address"` → `"csl-exam"`.
- Fixed 8 sites + their work orders: `district` changed from `"South 2"` to inferred real districts based on site name keywords (Kollam, Kottayam, Thrissur, Ernakulam, Kozhikode, Kannur, Kasaragod).
- 21 sites still have `"South 2"` district because their names don't contain recognizable location keywords.
- 2,533 legacy work orders still have no `examName` because they were imported before import tracking existed (no `importId` or `sourceFileName`). These can only be fixed by re-importing original files.

**Files modified:** `src/app/(app)/work-orders/page.tsx`, `src/app/(app)/work-orders/imports/page.tsx`
- Removed all "TCS" branding from UI copy. Descriptions, placeholders, and empty states now use generic "exam duty" wording.
- Site headers show exam name instead of "TCS" + district badge.

**Files created:** `src/app/api/admin/work-orders/todos/route.ts`, `src/app/api/admin/work-orders/todos/[id]/route.ts`
- REST API for work order task management: GET/POST list, PATCH update status, DELETE remove.
- Collection: `workOrderTodos` with Firestore rules (staff read/write, admin delete).

**File created:** `src/components/work-orders/todo-panel.tsx`
- Task panel component with stats, filtering, inline create form, priority badges, status actions.
- Integrated into main Work Orders page ("Tasks" tab) and site detail page ("Site Tasks" card).

**File created:** `src/app/api/admin/work-orders/backfill-exam-names/route.ts`
- Admin API route to backfill `examName` on work orders missing it. Maps `importId` to `workOrderImports` for exam name lookup, falls back to `sourceFileName` parsing.

---

## [2026-04-25] — Session: Work order import system fixes and improvements

**File modified:** `src/lib/api-client.ts`
- **Bug:** `authorizedFetch` unconditionally set `Content-Type: application/json` whenever `init.body` existed and no Content-Type header was provided.
- **Impact:** Work order import preview (which sends `FormData`) failed with "Content-Type was not one of multipart/form-data or application/x-www-form-urlencoded" because the browser could not inject the multipart boundary.
- **Fix:** Added `&& !(init.body instanceof FormData)` condition so that `FormData` requests leave the Content-Type unset, allowing the browser to set the correct `multipart/form-data; boundary=...` header automatically.

**Files modified:** `src/app/(app)/work-orders/page.tsx`
- **Fix:** Confirm Import button was disabled when `duplicateState === 'overlap'` even in Revision mode. Overlap is expected when updating existing work orders. New logic: blocks only `binary-duplicate` and `content-duplicate`; allows `overlap` in revision mode; for new mode still blocks overlap but shows a helpful message to switch to revision mode.
- **Feature:** Added editable exam name field in the preview panel. Admin can override the auto-extracted exam name before committing. Custom exam name is propagated to all rows and content hash is recomputed client-side via Web Crypto API.
- **UI:** Improved duplicate warning messages with contextual help (blue info box for revision overlap, amber warning for new-mode overlap with suggestion to switch modes).
- **UI:** Increased exam name font size and weight in work order cards (main list) so exam names are more prominent.

**File created:** `src/lib/work-orders/tcs-exam-hash-browser.ts`
- Browser-compatible SHA-256 content hash function using `crypto.subtle.digest()`.
- Mirrors the server-side `buildTcsExamContentHash` from `tcs-exam-hash.ts` but works in the browser.
- Used when admin overrides the exam name so the commit route's hash validation still passes.

**File modified:** `src/app/(app)/work-orders/[siteId]/page.tsx`
- **UI:** Increased exam name font size from `text-xs` to `text-sm font-semibold text-foreground` in site detail cards for better visibility.

---

## [2026-04-25] — Session: Work order import — preview table, import history fix, exam name visibility

**File modified:** `src/app/(app)/work-orders/imports/page.tsx`
- **Fix:** Import history page silently failed when Firestore composite index was missing. Added `queryError` state and clear error display.
- **Feature:** When the `workOrderImports` query fails due to a missing index, the UI now shows a red alert with the exact deployment command: `firebase deploy --only firestore:indexes`.
- **UI:** Added `AlertTriangle` and `Alert` component imports for error display.

**File modified:** `src/app/(app)/work-orders/page.tsx`
- **Feature:** Added full preview details table in the import preview panel.
- **Table columns:** Date, Site Name, District, Male, Female, Status.
- **Update rows show before/after counts:** e.g., `0 → 2` for male/female when a row is updated.
- **Scrollable:** Table is wrapped in `<ScrollArea className="h-[300px]">` so large imports don't break the layout.
- **Status badges:** Color-coded chips — green for Added, amber for Updated, muted for Unchanged, red for Cancelled.
- **UI:** Added imports for `ScrollArea` and `Table` components.

**File modified:** `firestore.indexes.json`
- Removed single-field `foVisitReports` index (Firestore handles single-field indexes automatically; caused 400 error on deploy).
- Added composite index for `workOrderImports` on `(clientName ASC, createdAt DESC)` required by the import history page.
- **Deployed:** `firebase deploy --only firestore:indexes` completed successfully on 2026-04-25.

**Note on exam names:** The parser already extracts exam names from TCS filenames (e.g., "Adhoc Security Requirement for SBI JA Prelims..." → "SBI JA Prelims"). Each row in a file gets the same exam name. Exam names are prominently displayed in work order cards (previous commit increased font size). No additional backend changes needed.

---

## [2026-04-19] — Session: Field officers can assign training

**Files modified:**
- `src/app/api/admin/training/assignments/route.ts` — swapped `requireAdmin` → `requireAdminOrFieldOfficer`; GET filters results by `token.assignedDistricts` for FO; POST rejects 403 when `body.district` not in FO's `assignedDistricts`; persists `assignedByRole: "admin" | "fieldOfficer"`; raised GET `.limit(200)` → `.limit(500)`
- `src/app/(app)/training/assignments/page.tsx` — `isPrivileged` now admin+FO; `districtOptions` + `filteredEmployees` scoped to `assignedDistricts` when FO
- `src/app/(app)/layout.tsx` — removed `adminOnly` from Training nav group; `/training/assignments` item now `fieldOfficerVisible: true` so FO sees the link (Training Modules + Evaluations + Leaderboard remain admin-only)

**Effect:** Field officers can now create training assignments, but only for guards in their `assignedDistricts`. All other Training nav entries stay admin-only.

---

## [2026-04-19] — Session: Training assignments — client + district filters

**Files modified:** `src/app/(app)/training/assignments/page.tsx`
- Employee picker now filtered by Client + District dropdowns (derived from loaded employees)
- Removed `limit(200)` on employees query so full list is searchable; client/district derived from full set
- District options scoped to selected client
- Changing client resets district to "all"; selected employee clears if it falls out of filter
- Employee label now includes district suffix
- Assignment POST now also sends `clientId`

---

## [2026-04-19] — Session: Training Phases 2, 4, 5 — banks, quiz runner, performance

**Collections added:** `questionBanks/{bankId}` + `questionBanks/{id}/questions/{qid}`, `quizAttempts/{attemptId}`; `employees/{id}.trainingPerformance` merged on submit.

**APIs added:**
- `src/app/api/admin/training/banks/route.ts` — GET (list, optional `?moduleId`) + POST
- `src/app/api/admin/training/banks/[id]/route.ts` — GET/PATCH/DELETE (delete cascades questions)
- `src/app/api/admin/training/banks/[id]/questions/route.ts` — GET + POST (single or `questions[]` bulk), maintains `questionCount`
- `src/app/api/admin/training/banks/[id]/questions/[qid]/route.ts` — PATCH/DELETE, re-syncs count
- `src/app/api/guard/training/quiz/[assignmentId]/route.ts` — validates guard owns assignment, picks `questionsPerAttempt` shuffled questions, strips `correctIndex`
- `src/app/api/guard/training/quiz/[assignmentId]/submit/route.ts` — grades against stored correctIndex, writes `quizAttempts`, updates assignment status/score, bumps `trainingPerformance.attemptCount/completedCount/lastScore`

**UI added:**
- `src/app/(app)/training/banks/page.tsx` — list + create dialog (module link, questionsPerAttempt, timeLimit, shuffle, maxAttempts)
- `src/app/(app)/training/banks/[id]/page.tsx` — question editor (prompt, options, correctIndex radio, explanation)
- `src/app/(guard)/guard/training/quiz/[assignmentId]/page.tsx` — paginated quiz runner with optional countdown timer, auto-submit at T=0, result card
- Admin training page: added "Question Banks" button next to "New Module"
- Guard training page: added "Start Quiz / Retake Quiz" button on each assignment card

**Rules:**
- `firestore.rules` — added matches for `questionBanks/{id}`, `questionBanks/{id}/questions/{qid}` (admin/FO read for questions, admin write), `quizAttempts/{id}` (admin/FO read, guard reads own by `employeeDocId`, client writes locked — server admin SDK writes on submit)
- Deployed `firestore:rules` + `storage:rules` to `ciss-workforce` via `firebase deploy`

**Types:** `QuestionBank`, `Question`, `QuizAttempt` added to `src/types/training.ts`.

**Not done (deferred):** FO-scoped assignment (admin can already assign; FO creates are still blocked — needs `/api/field-officers/training/assignments` with district check), FO completion dashboard, evaluation tie-in UI surface, question CSV import.

---

## [2026-04-19] — Session: Training Phase 1 — file upload for modules

**Files modified:**
- `storage.rules` — added `trainingModules/{fileName=**}` path (admin write, signed-in read, 100 MB cap, pdf/pptx/image content types via new `isAllowedTrainingSize()` + `isTrainingContent()` helpers)
- `src/types/training.ts` — added `TrainingContentType` = `"pdf" | "pptx" | "image"`; added `contentType`, `contentPath`, `contentFileName` on `TrainingModule`
- `src/lib/firebaseAdmin.ts` — export `storage` (admin bucket) for server-side deletion
- `src/app/api/admin/training/modules/route.ts` — POST now persists `contentType`, `contentPath`, `contentFileName`
- `src/app/api/admin/training/modules/[id]/route.ts` — DELETE now removes Storage object via `contentPath` before deleting Firestore doc (`ignoreNotFound: true`)
- `src/app/(app)/training/page.tsx` — swapped "Content URL" text input for file picker (100 MB, pdf/pptx/jpg/png/webp), uploads via `uploadBytesResumable` with progress bar
- `src/app/api/guard/training/route.ts` — enriches each assignment with parent module's `contentType`, `contentFileName`, `contentUrl` via batched `getAll`
- `src/app/(guard)/guard/training/page.tsx` — inline viewer modal: native `<img>` for image, direct iframe for pdf, Office 365 embed iframe (`view.officeapps.live.com/op/embed.aspx`) for pptx; always shows Download fallback link

**Deployment required:**
- `firebase deploy --only storage:rules` — new rules for `trainingModules/**`

**Not yet done (Phase 2+):** question banks, quiz runner, quiz attempts, `trainingPerformance` aggregate, FO training tab

---

## [2026-04-19] — Session: Training + quiz spec drafted

**Files added:** `docs/training-quiz-spec.md`
- Spec covers admin / FO / guard flows, Firestore model (`trainingModules`, `questionBanks/{id}/questions`, `moduleAssignments`, `quizAttempts`), storage layout, accepted uploads (pdf/pptx/jpg/png/webp, 100 MB), rendering (native pdf/image + Office 365 embed for pptx), 5-phase plan
- No code changes yet — spec is source of truth for upcoming implementation

---

## [2026-04-19] — Session: Remove Work Orders tab from admin Field Officers page

**Files modified:** `src/app/(app)/field-officers/page.tsx`
- Removed `work-orders` entry from `ADMIN_TABS`; admin now sees Officers / Visit Reports / Training Reports
- `resolveWorkspaceTab` no longer honors `?tab=work-orders` for admins (falls back to `officers`); FO path unchanged — FOs still see Work Orders
- `TabsList` grid fixed at `grid-cols-3` for both roles
- `WorkOrdersPanel` TabsContent retained for field-officer role

---

## [2026-04-17] — Session: Public enrollment storage-permission fix verified

### Bug reported
- Submitting `/enroll` on cisskerala.site produced: `Firebase Storage: User have permission to access 'employees/8281849663/profilePictures/...' (storage/unauthorized)`
- Deployed client bundle was building upload paths as `employees/{phoneNumber}/profilePictures/...`; storage.rules require `isSignedIn()` on `employees/**`, but public enrollees are not signed in → denied

### State of the fix in source
**Files verified:** `src/app/enroll/page.tsx`, `storage.rules`
- `src/app/enroll/page.tsx` line 537 already builds path as `enrollments/${phoneNumber}/${folder}/${Date.now()}_${fileStem}.${extension}` — correct public path
- `storage.rules` already contains `match /enrollments/{allPaths=**}` allowing `create` without auth (subject to `isAllowedSize()` + `isDocument()`)
- `src/app/api/employees/enroll/route.ts` is a public endpoint (no `requireAdmin`) — accepts submissions from unauthenticated /enroll flow
- Public page uses plain `fetch("/api/employees/enroll", ...)`, not `authorizedFetch` — correct for unauthenticated flow

### Deployment required
- Local `.next` build artifact still contained the old `employees/...` path string (confirmed via grep) → the currently deployed Vercel bundle also has the old path
- No further source changes needed; next `main` push / Vercel rebuild will pick up the corrected path
- Firebase Storage rules must also be deployed: `firebase deploy --only storage:rules` (if not already pushed since the `enrollments/` rule was added in the F-01/F-02/F-03 security pass on 2026-04-15)
- After redeploy, users on the PWA may need to force-refresh (service worker cache) to pick up the new bundle

---

## [2026-04-17] — Session: Mobile UI redesign + impeccable polish

### PWA icon / favicon fix
**Files modified:** `src/app/favicon.ico`, `public/manifest.json`, `public/icons/*`
- `src/app/favicon.ico` regenerated with multi-size ICO (16/32/48px) using CISS brand icon — Next.js App Router auto-serves this file over `public/favicon.ico`
- `manifest.json`: `theme_color` + `background_color` corrected to `#014c85`
- All PWA icons regenerated with brand blue bg + CISS gold logo via Pillow

### Mobile UI redesign
**Files modified:** `src/components/guard/guard-bottom-nav.tsx`, `src/components/guard/guard-header.tsx`, `src/app/(guard)/layout.tsx`, `src/app/(guard)/guard/dashboard/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/guard-login/page.tsx`, `src/app/globals.css`
- Floating pill bottom nav (both guard + admin): `rounded-2xl`, `backdrop-blur-xl`, layered shadow, `active:scale-[0.92]`, gold dot active indicator, safe-area padding
- Guard header: brand gradient, Exo 2 font, inset-highlight logo container
- Guard login: full-bleed brand gradient, card-floats-from-bottom pattern, `min-h-[100dvh]`
- Guard dashboard: double-bezel `StatCard`, `font-exo2 tabular-nums`, stagger animations, Emil Kowalski easing
- Guard layout: `min-h-[100dvh]`, loading screen gradient
- globals.css: `bottom-nav-item` min-h bumped to 58px, slide-up animation + stagger classes added

### Impeccable polish pass (commit 75318ac7)
**Files modified:** same 6 mobile files
- Removed banned `border-l-2 border-brand-gold` side-stripe → absolute-positioned 3px pill indicator
- Removed all `console.log/warn/error` from layout.tsx and guard-login
- Replaced `text-gray-*` hardcodes with semantic tokens (`text-foreground`, `text-muted-foreground`)
- Fixed `text-[8px]` month label → `text-[10px]` (readability)
- Nav labels 9px → 10px (guard + admin bottom bar)
- Guard header subtitle 9px → 10px
- Wired `animationDelay` on More sheet items to `animate-slide-up`
- `<img>` in guard loading screen → `<Image>` from next/image

---

## [2026-04-16] — Session: Work Orders tab on Field Officers page

### Work Orders tab added to field-officers page
**Files created:** `src/components/field-officers/work-orders-panel.tsx`
**Files modified:** `src/app/(app)/field-officers/page.tsx`

- New `WorkOrdersPanel` component queries `workOrders` from Firestore scoped by role:
  - admin: `where("date", ">=", today)` — all districts
  - fieldOfficer: `where("district", "in", assignedDistricts)` + `where("date", ">=", today)`
  - Uses existing `workOrders: district + date` composite index
- Groups work orders by site; shows manpower stats (male/female/required/assigned) + progress bar
- Inline "Assign Guards" dialog (full AssignGuardsDialog component, mobile tabs + desktop side-by-side layout) — no page navigation needed
- Assign dialog loads active employees scoped to work order's district
- Guard assignment saves via `PATCH /api/admin/work-orders/:id` (already allows FOs)
- No export/download button (excluded per spec)
- Tab added to both admin (4 tabs: Officers / Work Orders / Visit Reports / Training Reports) and fieldOfficer (3 tabs: Work Orders / Visit Reports / Training Reports)
- FO default tab changed from `visit-reports` to `work-orders`
- Added `ClipboardList` to imports

---

## [2026-04-16] — Session: Attendance record flow fixes

### Fix 1: clientName added to client user JWT claims
**File modified:** `src/app/api/admin/client-users/route.ts`
- `setCustomUserClaims` now includes `clientName` alongside `clientId` and `stateCode`
- Root cause: Firestore security rules for `attendanceLogs`, `employees`, `workOrders` all use `clientUserClientName()` which reads `request.auth.token.clientName`; without this claim, all collection reads failed for client users
- Existing clients with broken claims can be repaired via `POST /api/admin/claims/repair` (already handles `clientName` in claimPatch)

### Fix 2: employeePhoneNumber now saved in attendanceLogs
**File modified:** `src/app/api/attendance/submit/route.ts`
- Added `employeePhoneNumber: payload.employeePhoneNumber ?? null` to `transaction.set` in the attendance log write
- Was present in `attendanceSubmissionSchema` and sent by the client but never persisted to Firestore

### Fix 3: Attendance-logs page Firestore query scoped by role
**File modified:** `src/app/(app)/attendance-logs/page.tsx`
- Added `where` import from `firebase/firestore`
- `useEffect` dependency changed from `[]` to `[userRole, clientInfo, assignedDistricts]`
- `client` role: query uses `where("clientName", "==", clientInfo.clientName)` — fixes Firestore permission denied (list query can't prove all docs match without the filter)
- `fieldOfficer` role: query uses `where("district", "in", assignedDistricts)` — scopes data to assigned districts at DB level instead of 200-record client-side filter
- `admin`/other roles: unchanged `orderBy("createdAt", "desc") limit(200)`
- Auth waits for `userRole !== null` before subscribing

### Fix 4: Attendance export API allows field officers
**File modified:** `src/app/api/admin/reports/attendance/route.ts`
- Changed `requireAdmin` → `verifyRequestAuth` + `requireAdminOrFieldOfficer`
- FOs get district-scoped results: if no district filter in request, adds `where("district", "in", foDistricts)`; if district filter present, validates it's within the FO's assigned districts
- Improved error handling (auth errors → 401, others → 500)

### Fix 5: Firestore composite indexes for scoped queries
**File modified:** `firestore.indexes.json`
- Added `attendanceLogs: clientName ASC + createdAt DESC` (for client role query)
- Added `attendanceLogs: district ASC + createdAt DESC` (for FO role query)

---

## [2026-04-15] — Session: Guard login flow — PIN-first redirect + placeholder cleanup

### Guard login now redirects to setup if PIN not set
**Files modified:** `src/app/guard-login/page.tsx`
**Files created:** `src/app/api/guard/auth/pin-status/route.ts`
- Phone+PIN tab is now a two-step flow:
  1. Enter phone number → calls `POST /api/guard/auth/pin-status`
  2. If `hasPin: false`, auto-redirects to `/guard-login/setup`
  3. If `hasPin: true`, shows PIN input with dots indicator
- QR login flow also checks `pin-status` after scan — redirects to setup if no PIN
- Removed the "First time? Set up PIN" / "Forgot PIN?" static links from login card; replaced with single "First time? Set up PIN" link with KeyRound icon
- "Forgot your PIN?" link shown only in the PIN step

### All guard auth placeholder text removed
**Files modified:** `src/app/guard-login/setup/page.tsx`, `src/app/guard-login/reset/page.tsx`, `src/app/guard-forgot-pin/page.tsx`, `src/app/guard-login/page.tsx`
- Removed all placeholder text from phone, PIN, employee ID, OTP, and confirm-PIN inputs across all guard auth pages
- Inputs now show empty, waiting for user input

---

## [2026-04-15] — Session: Comprehensive audit — UI/UX fixes (U-02, U-03, U-06, U-07, U-11)

### U-02: GuardBottomNav missing aria-label
**File modified:** `src/components/guard/guard-bottom-nav.tsx`
- Added `aria-label="Guard navigation"` to `<nav>` element

### U-03: userScalable changed from false to true
**File modified:** `src/app/layout.tsx`
- Changed `userScalable: false` to `userScalable: true` — allows pinch-to-zoom for accessibility

### U-06: Checkbox touch target increased
**File modified:** `src/components/ui/checkbox.tsx`
- Added invisible 44x44px hit area via `after:` pseudo-element while preserving visual 16x16px size

### U-07: Hardcoded brand colors replaced with CSS custom property values
**Files modified:** `guard-bottom-nav.tsx`, `attendance-calendar.tsx`, `guard-header.tsx`
- Replaced hardcoded `#014c85` with `hsl(206 98% 26%)` and `#bd9c55` with `hsl(41 44% 54%)`
- Fixed opacity patterns (`${BRAND_BLUE}15` → `hsl(206 98% 26% / 0.08)`)

### U-11: useToast dependency array fixed
**File modified:** `src/hooks/use-toast.ts`
- Changed `[state]` to `[]` — `setState` is stable and doesn't need `state` as dependency; previous code re-subscribed listener every render

### Verified FALSE / Skipped:
- U-01: FALSE — Radix Dialog/Sheet handles focus management automatically
- U-04: Skipped (minor styling)
- U-05: FALSE — table.tsx already wraps with overflow-auto div
- U-08 to U-10: Skipped (stylistic consistency, not bugs)
- U-12 to U-16: Skipped (missing features)

---

## [2026-04-15] — Session: Comprehensive audit — Super-admin fixes (S-01 to S-05, S-08)

### S-01: Deployment config API no longer exposes service account JSON (CRITICAL)
**File modified:** `src/app/api/super-admin/regions/[id]/deployment-config/route.ts`
- Removed `FIREBASE_ADMIN_SDK_CONFIG_BASE64` from API response
- Replaced with boolean `hasPersistentConnection` check

### S-02: Credentials only persisted on successful validation (CRITICAL)
**File modified:** `src/app/api/super-admin/regions/[id]/validate/route.ts`
- Wrapped `saveRegionConnection` inside `if (result.success)` block

### S-03: Region overview uses UUID for Firebase app name (HIGH)
**File modified:** `src/app/api/super-admin/overview/route.ts`
- Replaced `Date.now()` with `crypto.randomUUID()` for guaranteed uniqueness

### S-04: Super-admin PATCH no longer accepts arbitrary fields (HIGH)
**File modified:** `src/app/api/super-admin/regions/[id]/route.ts`
- Status now always derived from checklist via `nextRegionStatus()`, never from request body

### S-05: Service account payload cleared on region switch (HIGH)
**File modified:** `src/app/(app)/settings/state-management/page.tsx`
- Added `setServiceAccountPayload("")` alongside `setServiceAccountFileName("")`

### S-08: Encryption key dependency documented (MEDIUM)
**File modified:** `src/lib/server/region-connections.ts`
- Added warning comment documenting `REGION_CONNECTIONS_SECRET` dependency

---

## [2026-04-15] — Session: Comprehensive audit — Guard portal fixes (G-01, G-03, G-05)

### G-01: Guard payslips download now uses guard-specific API route (CRITICAL)
**Files created:** `src/app/api/guard/payslips/[id]/payslip/route.ts`
**Files modified:** `src/app/api/guard/payslips/route.ts`
- Created guard-accessible payslip route with `requireGuard` + ownership check
- Updated downloadUrl from `/api/admin/...` to `/api/guard/payslips/${doc.id}/payslip`

### G-03: Guard attendance now counts both "In" and "Out" statuses (HIGH)
**File modified:** `src/app/api/guard/attendance/route.ts`
- Changed filter from `l.status === "In"` to `l.status === "In" || l.status === "Out"`

### G-05: Guard payslips fallback query risk removed (HIGH)
**File modified:** `src/app/api/guard/payslips/route.ts`
- Removed risky fallback query by `employeeId`
- Changed primary query to use `employeeDocId` (authoritative per project conventions)

### Verified FALSE / Skipped:
- G-02: FALSE — guard profile API already picks only 13 specific fields, not spread
- G-04: TRUE but skipped (missing feature — pagination)

---

## [2026-04-15] — Session: Audit bug fixes (T-01 through T-05)

### T-01: QR Management replaced simulated logic with real Firestore queries (CRITICAL)
- **File**: `src/app/(app)/settings/qr-management/page.tsx`
- **Bug**: Used hardcoded `totalEmployees = 1234`, simulated progress via `setInterval`, and `Math.random()` for success/failure
- **Fix**: Now queries active employees from Firestore, generates real QR codes via `generateQrCodeDataUrl`, writes updates back via batched writes (chunked at 500). Employee count is fetched live on mount. Progress reflects actual processing.

### T-02: Bulk import now chunks Firestore batches at 500 (HIGH)
- **File**: `src/app/(app)/settings/bulk-import/page.tsx`
- **Bug**: Single `writeBatch` used for all records; 500+ employees would exceed Firestore's 500-ops-per-batch limit
- **Fix**: Both employee import and clients/sites import now collect batch operations, then commit in chunks of 500. `processClientsSitesImport` also fixed.

### T-03: XLSX export now excludes sensitive fields (HIGH)
- **File**: `src/app/(app)/settings/data-export/page.tsx`
- **Bug**: XLSX export included all Firestore document fields (bank account numbers, IFSC, PAN, EPF/UAN, ESIC, ID proof numbers, all document URLs, signatures)
- **Fix**: Added `XLSX_EXCLUDED_FIELDS` set filtering out 22 sensitive/internal fields from the spreadsheet export. PDF profile kits are unaffected (they are per-employee documents meant for the employee).

### T-04: Removed 500ms sleep per employee in PDF export (HIGH - performance)
- **File**: `src/app/(app)/settings/data-export/page.tsx`
- **Bug**: `await sleep(500)` after each individual PDF download added 50+ seconds for 100 employees
- **Fix**: Removed entirely (no longer needed since T-05 merges into single PDF)

### T-05: PDF export now generates single merged PDF instead of multiple downloads (HIGH)
- **File**: `src/app/(app)/settings/data-export/page.tsx`
- **Bug**: Each employee triggered a separate browser download (`a.click()`); browsers block multiple downloads
- **Fix**: Individual PDFs are generated in-memory, then merged via `PDFDocument.copyPages` into a single file. One download: `ProfileKits_{ClientName}_{date}.pdf`. Updated UI alert text.

---

## [2026-04-15] — Session: Work order & client audit fixes (W-01, W-02, W-05, W-07, W-08)

### W-01: Work order writes now go through server-side API (CRITICAL)
- **Files created**: `src/app/api/admin/work-orders/route.ts` (POST), `src/app/api/admin/work-orders/[id]/route.ts` (PATCH, DELETE)
- **Files changed**: `src/app/(app)/work-orders/page.tsx`, `src/app/(app)/work-orders/[siteId]/page.tsx`
- **Bug**: All work order CRUD (create/import, update assignments, update manpower, delete) was done directly via client-side Firestore SDK with no server-side auth validation
- **Fix**: Created server-side API routes with `requireAdmin` checks; updated client pages to use `authorizedFetch` for all work order writes (import, update, delete). Site creation during import still uses client SDK (no server API exists yet).

### W-02: onSnapshot listener memory leak fixed (CRITICAL)
- **File**: `src/app/(app)/work-orders/[siteId]/page.tsx` lines 523-564
- **Bug**: `useEffect` called `fetchSiteAndWorkOrders()` async function which returned `unsubscribe` from inner scope, but the `useEffect` never captured it — no cleanup function existed
- **Fix**: Stored `unsubscribe` in a local variable accessible to the `useEffect` cleanup; added `return () => { if (unsubscribe) unsubscribe(); }` cleanup

### W-05: Replaced fragile `__name__` with `documentId()` (HIGH)
- **File**: `src/components/work-orders/assigned-guards-export-panel.tsx` line 142
- **Bug**: Used `where('__name__', 'in', chunk)` — `__name__` is Firestore internal field, not part of public API
- **Fix**: Replaced with `where(documentId(), 'in', chunk)` and imported `documentId` from `firebase/firestore`

### W-07: Client deletion now blocked when associated data exists (MEDIUM)
- **Files**: `src/app/api/admin/clients/[id]/route.ts`, `src/app/(app)/settings/clients/[clientId]/page.tsx`
- **Bug**: DELETE endpoint deleted client doc regardless of associated sites/locations/users, leaving orphans
- **Fix**: API route now checks for existing sites, locations, and users; returns 409 with descriptive error if any exist. Client-side dialog updated with clearer warning text and better error display.

### W-08: Site deletion now checks for assigned guards (MEDIUM)
- **File**: `src/app/(app)/settings/clients/[clientId]/page.tsx` `handleDeleteSite`
- **Bug**: Site could be deleted even when work orders with assigned guards existed, breaking assignment references
- **Fix**: Before deleting, queries `workOrders` collection for the site; if any work orders have assigned guards, blocks deletion with descriptive toast. Updated dialog description.

### Verified FALSE / Skipped:
- W-03: Field officer photo upload — already fixed by prior F-01
- W-04: Guard assignments concurrency control — skipped (missing feature, not a bug)
- W-06: Bulk site import — skipped (missing feature, not a bug)

---

## [2026-04-15] — Session: Payroll audit fixes (P-01, P-04, P-06)

### P-01: netPay now subtracts lopDeduction (CRITICAL bug)
- **File**: `src/app/api/admin/payroll/run/route.ts` line 215-216
- **Bug**: `netPay = gross - epf - esic - pt - tds` omitted `lopDeduction`, though `totalDeductions` included it
- **Fix**: Added `- lopDeduction` to netPay formula

### P-04: Failed payroll cycles now marked as "failed" (CRITICAL bug)
- **Files**: `src/app/api/admin/payroll/run/route.ts`, `src/types/payroll.ts`, `src/app/(app)/payroll/page.tsx`, `src/app/(app)/payroll/cycles/[id]/page.tsx`
- **Bug**: Cycle created with status "processing" but never updated to "failed" on error; left stuck in "processing"
- **Fix**: Hoisted `cycleRef` outside try block; catch block now updates cycle status to "failed" with error message; added "failed" to `PayrollCycleStatus` type and UI status configs

### P-06: Skipped employees now persisted on cycle document (HIGH)
- **File**: `src/app/api/admin/payroll/run/route.ts` line 294
- **Bug**: Skipped employees only returned in API response, never written to Firestore
- **Fix**: Added `skippedEmployees` array to cycle update, so skip records persist in Firestore

### Verified FALSE (no fix needed):
- P-02: EPF ceiling logic is correct (`min(wage, 15000)` then apply rate)
- P-03: `grossRate < 1` guard prevents division by zero; fallback to `knownTotal`
- P-05: Client allowances merged into `mergedComponentAmounts` BEFORE prorating
- P-08: "Basic Salary" matches `includes("basic")`; "Danger Allowance" does NOT match `=== "da"`

---

## [2026-04-15] — Session: Attendance audit fixes (AT-01 through AT-12)

### AT-01: Public site GPS coordinates redacted
**File modified:** `src/app/api/public/attendance/route.ts`
- Removed `lat` and `lng` from public API response for both `sites` and `clientLocations`
- Exact GPS coordinates of security sites no longer exposed to unauthenticated requests
- Client-side auto-detection still works via manual district/site selection; server-side geofence enforcement in submit route unaffected

### AT-03: Photo analysis integrated into attendance capture
**File modified:** `src/app/attendance/page.tsx`
- After photo capture and watermarking, the `analyze-photo` API endpoint is now called in the background
- Manual review compliance is set immediately (non-blocking); AI result replaces it when ready
- If AI analysis fails, manual review compliance remains as fallback

### AT-04: Work order validation extended to fixed-shift sites
**File modified:** `src/app/api/attendance/submit/route.ts`
- Fixed-shift sites (`siteShiftMode === "fixed"`) now also check for work orders
- If work orders exist, employee assignment is validated against them
- If no work orders exist AND no resolved shift, attendance is rejected
- If no work orders exist but a resolved shift matches, attendance proceeds (fixed-shift-only sites)

### AT-05: Guard dashboard attendance query now uses date range
**File modified:** `src/app/api/guard/dashboard/route.ts`
- Added `attendanceDate >= startDateStr` and `attendanceDate <= endDateStr` filters to the Firestore query
- Removed arbitrary `limit(200)` and client-side date filtering
- Uses existing composite index `(employeeDocId, attendanceDate)` in `firestore.indexes.json`

### AT-07: Overtime calculation implemented
**File modified:** `src/lib/payroll/attendance-aggregator.ts`
- Pairs In/Out logs per day using `reportedAt` timestamps
- Calculates hours worked as difference between earliest In and latest Out
- Any hours beyond 8-hour standard counted as overtime
- Returns `overtimeHours` rounded to 2 decimal places (previously hardcoded to 0)

### AT-08: Next shift query error handling improved
**File modified:** `src/app/api/guard/dashboard/route.ts`
- Added `console.error` logging in the catch block (was previously silent)
- Added `nextShiftUnavailable` boolean in API response so frontend can inform user when next shift data is unavailable

### Not fixed (by design):
- AT-02: FALSE — `validateEmployee()` at line 69 already verifies `employeeData.employeeId !== payload.employeeId`
- AT-06: Missing feature (holiday calendar), skip per instructions
- AT-09: Architecture issue requiring significant refactoring, skip per instructions
- AT-10: FALSE — transaction-based `attendanceState` check prevents duplicates atomically
- AT-11: Architecture issue requiring significant refactoring, skip per instructions
- AT-12: TRUE but not simple to fix without breaking offline queuing — client time used for `reportedAtClient` which feeds `attendanceDate`; server enforces max-age check but cannot fully replace client time for offline scenarios

---

## [2026-04-15] — Session: Employee audit bug fixes (E-01, E-02, E-03, E-05, E-10)

### E-01: Admin employees API filtered by clientId instead of clientName
**File modified:** `src/app/api/admin/employees/route.ts`
- Changed `.where("clientId", "==", clientId)` to `.where("clientName", "==", clientId)` since employees only store `clientName`, never `clientId`

### E-02: Phone number normalization on storage
**File modified:** `src/app/api/employees/enroll/route.ts`
- Added `normalizedPhone = payload.phoneNumber.replace(/\D/g, "")` before storing to ensure digits-only storage
- Guard login normalizes to digits on query; now storage matches

### E-03: employeeId generation uses crypto.randomInt instead of Math.random
**Files modified:** `src/lib/employee-id.ts`, `src/app/(app)/employees/[id]/page.tsx`
- Server-side `generateEmployeeId` now uses Node.js `crypto.randomInt(1, 1000)` instead of `Math.random()`
- Client-side `generateEmployeeId` now uses `crypto.getRandomValues()` instead of `Math.random()`

### E-05: Status update now also updates publicProfile.status
**File modified:** `src/app/(app)/employees/page.tsx`
- `handleConfirmStatusUpdate` now writes `publicProfile` object with updated `status` alongside the top-level `status` field
- Prevents stale status showing on public profile after status change from directory page

### E-10: Enrollment schema enforces identity and address proof types differ
**Files modified:** `src/types/enrollment.ts`, `src/app/(app)/employees/[id]/page.tsx`
- Added `superRefine` validation to `enrollmentSubmissionSchema` rejecting same type for both proofs
- Added matching validation to client-side `employeeUpdateSchema`

### Not fixed (by design):
- E-04: FALSE — `clientName` was never in `searchableFields`; condition is consistent
- E-06: Missing feature (Auth cleanup on delete), skip per instructions
- E-07, E-08, E-09: Missing features, skip per instructions

---

## [2026-04-15] — Session: Auth & security audit fixes (A-01 through A-14)

### A-01: QR login accepts employeeId
**File modified:** `src/app/api/guard/auth/login/route.ts`
- Login API now accepts both `phoneNumber` and `employeeId` for authentication
- QR flow sends `employeeId`, phone flow sends `phoneNumber`; both work correctly
- Rate limiting keyed by whichever identifier is used

### A-02: SMS OTP TODO clarified
**File modified:** `src/app/api/guard/auth/send-reset-otp/route.ts`
- Expanded TODO comment to clearly state the forgot-PIN flow is non-functional without SMS integration

### A-03: Rate limiting added to verify-reset-otp
**File modified:** `src/app/api/guard/auth/verify-reset-otp/route.ts`
- Added Firestore-based rate limiting: max 5 attempts per phone per 10 minutes
- Also updated to use hashed OTP verification instead of plaintext query

### A-04: Enrollment API now requires admin auth
**File modified:** `src/app/api/employees/enroll/route.ts`
- Added `requireAdmin(request)` call before processing enrollment

### A-05: DOB verification handles Timestamp format
**File modified:** `src/app/api/guard/auth/setup-pin/route.ts`
- `dateOfBirth` comparison now handles both string (`YYYY-MM-DD`) and Firestore Timestamp formats
- Converts Timestamp to `YYYY-MM-DD` string before comparing

### A-06: PIN hashing now uses per-user salt
**File modified:** `src/lib/guard/pin-utils.ts`
- `hashPin()` generates a random 16-char salt, stored as `salt:hash` format
- `verifyPin()` supports both new salted format and legacy unsalted format for backward compatibility
- Existing unsalted hashes will auto-upgrade on next successful login/PIN change

### A-07: OTP stored as hash in Firestore
**Files modified:** `src/app/api/guard/auth/send-reset-otp/route.ts`, `src/app/api/guard/auth/verify-reset-otp/route.ts`, `src/app/api/guard/auth/reset-pin/route.ts`
- New file: `src/lib/guard/otp-utils.ts` — provides `hashOtp()` and `verifyOtp()` functions
- OTPs now stored as `otpHash` instead of plaintext `otp`
- `verifyOtp()` supports both hashed and legacy plaintext for backward compatibility
- Verify and reset routes updated to use hashed verification

### A-08: Employee lookup rate limiting tightened
**File modified:** `src/app/api/employees/lookup/route.ts`
- Reduced unauthenticated rate limit from 10 to 5 per minute
- Authenticated requests get higher limit (20 per minute)
- Added optional auth check

### A-09: Public profile page uses server-side API
**Files modified:** `src/app/profile/[id]/page.tsx`, new file `src/app/api/employees/public-profile/[id]/route.ts`
- Profile page no longer reads full employee document via client SDK
- New server API route returns only safe fields (name, employeeId, clientName, profilePictureUrl, status, qrCodeUrl, joiningDate)
- Removed unused `db`, `doc`, `getDoc` imports from profile page

### A-10: Rate limiting added to change-pin
**File modified:** `src/app/api/guard/auth/change-pin/route.ts`
- Added Firestore-based rate limiting: max 5 attempts per employee per 5 minutes

### A-13: Admin login verifies custom claims before redirect
**File modified:** `src/app/admin-login/page.tsx`
- After sign-in, checks `getIdTokenResult()` for admin/superAdmin role or `admin` claim or legacy admin email
- Non-admin users are signed out and shown "Access Denied" message

### A-14: Admin login requires email verification
**File modified:** `src/app/admin-login/page.tsx`
- Added `emailVerified` check after sign-in
- Unverified users are signed out and shown error message

### A-16 (TRUE, no fix applied): Two PIN reset flows exist
- `/guard-forgot-pin` (OTP-based) and `/guard-login/reset` (DOB-based) serve different user scenarios
- Both are intentionally linked from the guard login page; not a bug, but a design decision

---

## [2026-04-15] — Session: Security audit fixes (F-01 through F-10)

### 1. storage.rules — F-01/F-02/F-03 fixes
**File modified:** `storage.rules`
- Added `isSignedIn()` and `isFieldOfficer()` helper functions
- Added `match /foReports/{folder}/{uid}/{fileName}` with field officer auth (F-01)
- Added `isSignedIn()` to all `create` rules (F-02)
- Changed all `allow read: if true` to `allow read: if isSignedIn()` (F-03)

### 2. firestore.rules — F-05/F-06 fixes
**File modified:** `firestore.rules`
- Restricted `fcmTokens/{tokenId}` write to `isSignedIn() && request.auth.uid == tokenId` (F-05)
- Added `isHR()` to `payrollCycles` read rules (F-06)

### 3. firestore.indexes.json — F-07/F-10 fixes
**File modified:** `firestore.indexes.json`
- Removed 8 duplicate index definitions (F-07)
- Added `payrollEntries` index on `employeeDocId + period` (F-10)
- Added `payrollEntries` index on `cycleId + employeeName` (F-10)
- Added `notifications` index on `recipientUid + read + createdAt` (F-10)
- Added `foVisitReports` index on `createdAt` (F-10)

### 4. .env.example — F-04/F-08/F-09 documentation
**File modified:** `.env.example`
- Added `NEXT_PUBLIC_FIREBASE_VAPID_KEY` placeholder (F-04)
- Added `FIREBASE_ADMIN_STORAGE_BUCKET` placeholder (F-08)
- Both `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_EMAIL` present (F-09)

### 5. .env.local — F-09 fix
**File modified:** `.env.local`
- Added `SUPER_ADMIN_EMAIL` matching `NEXT_PUBLIC_SUPER_ADMIN_EMAIL` (F-09)

### 6. firebaseAdmin.ts — F-08 fix
**File modified:** `src/lib/firebaseAdmin.ts`
- `storageBucket` now prefers `FIREBASE_ADMIN_STORAGE_BUCKET`, falls back to `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` (F-08)

### Outstanding — requires manual action
- **F-04**: `NEXT_PUBLIC_FIREBASE_VAPID_KEY` must be added to `.env.local` with the actual VAPID key from Firebase Console > Project Settings > Cloud Messaging

---

## [2026-04-14] — Session: Hybrid QR scanner implementation

### 1. Shared QR scanner module added
**Files created:**
- `src/lib/qr/scanner-types.ts` — shared types: `QrScannerBackend`, `QrScannerErrorCode`, `QrScannerStatus`, `QrScanResult`
- `src/lib/qr/scanner-support.ts` — helpers: `shouldUseNativeBarcodeDetector`, `choosePreferredVideoInput`, `isTorchSupported`, `normalizeScannerError`
- `src/lib/qr/scanner-engine.ts` — runtime: `createDuplicateScanGuard`, `shouldFallbackToZxing`, `startHybridQrScanner`, `startSafeHybridQrScanner`
- `src/lib/qr/scanner-support.test.ts` — unit tests for support helpers (all passing)
- `src/lib/qr/scanner-engine.test.ts` — unit tests for duplicate suppression and fallback logic (all passing)

**Architecture:**
- Native `BarcodeDetector` preferred for speed; falls back to ZXing automatically if unsupported or runtime-fails
- `createDuplicateScanGuard(cooldownMs)` suppresses repeated scans within cooldown window
- `choosePreferredVideoInput` prefers rear/back/environment-facing camera
- `normalizeScannerError` maps `DOMException` names to typed error codes

### 2. Attendance page integrated with shared scanner
**File modified:** `src/app/attendance/page.tsx`
- Replaced in-page ZXing lifecycle with `startHybridQrScanner` from shared engine
- Uses `scannerSessionRef` for lifecycle management; `stop()` on cleanup

### 3. Guard login page integrated with shared scanner
**File modified:** `src/app/guard-login/page.tsx`
- Replaced in-page ZXing lifecycle with `startSafeHybridQrScanner` from shared engine
- Uses `scannerSessionRef`; stops on successful scan or error

### 4. Plan and spec docs committed
- `docs/superpowers/plans/2026-04-13-hybrid-qr-scanner.md`
- `docs/superpowers/specs/2026-04-13-hybrid-qr-scanner-design.md`

**Commit:** `812b4294` — pushed to `origin/main`

---

## [2026-04-14] — Session: Photo capture + report forms for field officers

### 1. PhotoCapture component added
**File created:** `src/components/field-officers/photo-capture.tsx`
- Three capture modes: Site Photo (`capture="environment"`), Selfie (`capture="user"`), Gallery (no capture)
- Uploads directly to Firebase Storage: `foReports/{folder}/{uid}/{timestamp}_{filename}`
- Shows thumbnails with remove button; enforces `maxPhotos` limit (default 10)
- Props: `urls`, `onChange`, `folder` ("visitReports" | "trainingReports"), `maxPhotos`, `disabled`

### 2. Visit reports panel updated
**File:** `src/components/field-officers/visit-reports-panel.tsx`
- PhotoCapture added to new-report form (FO flow)
- `photoUrls` state reset on form close
- Photos sent in POST body
- Admin review sheet now shows photo thumbnails (clickable, open in new tab)

### 3. Training reports panel updated
**File:** `src/components/field-officers/training-reports-panel.tsx`
- PhotoCapture added to new-report form (FO flow)
- Added detail Sheet (View button on each card) showing full report + photos
- Admin can acknowledge directly from detail sheet

### 4. API routes extended
- `POST /api/admin/visit-reports` — accepts and stores `photoUrls[]`
- `PATCH /api/admin/visit-reports/[id]` — accepts `photoUrls[]` update
- `POST /api/admin/training-reports` — accepts and stores `photoUrls[]`
- `PATCH /api/admin/training-reports/[id]` — accepts `photoUrls[]` update

**Commit:** `d74d54be`

---

## [2026-04-13] — Session: Product cleanup, navigation consolidation, landing polish, GitHub/Vercel sync repair

### 1. Client + site location management upgraded into operational workspace
**Files:**
- `src/app/(app)/settings/clients/[clientId]/page.tsx`
- `src/components/location/location-editor-card.tsx`
- `src/components/location/location-picker-map.tsx`
- `src/app/layout.tsx`
- `src/app/globals.css`

- Removed client-level compensation/compliance-style clutter from client detail workflow
- Shifted client detail page toward operational fields only
- Added richer site and office cards showing:
  - address
  - district
  - GPS status
  - latitude / longitude
  - geofence radius
  - site/location type
  - strict geofence flags and related notes
- Expanded edit dialogs so admins can edit practical location fields directly
- Added OpenStreetMap + Leaflet based map picker:
  - click map to place location
  - drag marker to correct location
  - keep lat/long fields synced with marker position

---

### 2. Site GPS repair system built and live-repaired
**Files:**
- `scripts/repair-site-gps.mjs`
- `src/lib/site-gps-repair.ts`
- `src/lib/site-gps-repair.test.ts`
- `src/lib/server/location-geocode.ts`
- `src/app/api/admin/sites/batch-geocode/route.ts`
- `src/app/(app)/settings/clients/[clientId]/page.tsx`

- Built standalone repair script for missing/bad site coordinates
- Restricted OpenCage forward geocoding to India to stop false foreign matches
- Added pending/invalid coordinate detection logic shared by UI + script
- Added `Run GPS Repair` action on client sites page
- Live run result:
  - inspected `257` sites
  - updated `255`
  - skipped `1`
  - failed `1` unresolved site

---

### 3. Admin settings information architecture heavily cleaned
**Files:**
- `src/app/(app)/settings/page.tsx`
- `src/app/(app)/layout.tsx`
- `src/components/dashboard/actions.tsx`
- `src/app/settings-surface.test.ts`

- Removed `Compliance Settings` from admin settings surface and deleted old page route
- Combined:
  - `Client Management`
  - `Client Locations`
  - `Duty Sites`
  into one `Clients & Sites` settings entry pointing to `/settings/clients`
- Removed duplicate `Assigned Guards Export` settings card because feature already belongs under operations/work orders
- Combined:
  - `Bulk Employee Import`
  - `QR Management`
  - `Export All Data`
  into unified `Admin Tools` workspace at `/settings/admin-tools`

---

### 4. Salary grade / salary assignment layer removed; wage config became only payroll setup source
**Files:**
- `src/app/(app)/settings/page.tsx`
- `src/app/(app)/layout.tsx`
- `src/app/(app)/payroll/page.tsx`
- `src/app/api/admin/payroll/run/route.ts`
- `src/lib/payroll/calculate.ts`
- `src/types/payroll.ts`
- `src/components/dashboard/actions.tsx`
- `src/lib/payroll/calculate.test.ts`

**Deleted:**
- `src/app/(app)/settings/salary-grades/page.tsx`
- `src/app/(app)/payroll/salaries/page.tsx`
- `src/app/api/admin/salary-structures/route.ts`
- `src/app/api/admin/salary-structures/[id]/route.ts`
- `src/app/api/admin/employee-salaries/route.ts`
- `src/app/api/admin/employees/[id]/salary/route.ts`

- Removed salary grades and salary assignment UI, APIs, and navigation
- Kept `Wage Configuration` as only compensation-setup surface
- Payroll calculation refactored to derive monthly template from client wage config instead of separate salary structure layer

---

### 5. Field officer workflows unified
**Files:**
- `src/app/(app)/field-officers/page.tsx`
- `src/components/field-officers/visit-reports-panel.tsx`
- `src/components/field-officers/training-reports-panel.tsx`
- `src/app/(app)/visit-reports/page.tsx`
- `src/app/(app)/training-reports/page.tsx`
- `src/app/field-officers-surface.test.ts`

- Removed separate `Visit Reports` and `Training Reports` sidebar items
- Turned `Field Officers` into single workspace with:
  - officers
  - visit reports
  - training reports
- Added redirect shims from old routes into unified workspace

---

### 6. Work Orders and Assigned Guards Export merged operationally
**Files:**
- `src/app/(app)/work-orders/page.tsx`
- `src/components/work-orders/assigned-guards-export-panel.tsx`
- `src/app/(app)/work-orders/assigned-guards-export/page.tsx`
- `src/app/work-orders-surface.test.ts`
- `src/app/(app)/layout.tsx`

- Removed standalone `Assigned Guards Export` sidebar item
- Added admin-only assigned-guards export tab/section inside `Work Orders`
- Converted old export route into redirect-compatible wrapper

---

### 7. Branch Ops and branch-based Expenses removed completely
**Files updated:**
- `src/app/(app)/layout.tsx`
- `src/app/(app)/settings/page.tsx`
- `src/app/branch-admin-removal.test.ts`
- `docs/app-context.md`

**Deleted:**
- `src/app/(app)/branch-ops/page.tsx`
- `src/app/(app)/branch-ops/[branchId]/page.tsx`
- `src/app/(app)/expenses/page.tsx`
- `src/app/(app)/expenses/[branchId]/[month]/page.tsx`
- `src/app/api/admin/branches/route.ts`
- `src/app/api/admin/expenses/[branchId]/[month]/route.ts`
- `src/app/api/admin/expenses/[branchId]/[month]/approve/route.ts`

- Removed branch-admin UI and API slice entirely
- Removed branch-expense workflow because it depended on deleted branch model
- Cleaned leftover branch-only types from `src/types/branch.ts`

---

### 8. Repo cleanup — removed non-webapp folders/artifacts
**Files/folders removed from workspace:**
- `autoresearch/`
- `streamvault/`
- `functions/`
- `.tmp/`
- `tmp_ops_review/`
- `opencode.jsonc`
- `output/`
- `.idx/`
- `.modified`
- old screenshot/demo PNG files in repo root

**Files updated:**
- `.gitignore`
- `docs/app-context.md`

- Purpose: keep repo focused on actual webapp/runtime code only

---

### 9. Build + runtime stability fixes
**Files:**
- `src/app/(app)/layout.tsx`
- `next.config.ts`
- `src/next-config.test.ts`
- `src/app/(app)/attendance-logs/page.tsx`
- `package.json`

- Fixed invalid Next layout export issue
- Added/kept tracing-root protection for Vercel output tracing
- Replaced raw `<img>` in attendance logs with `next/image`
- Added `clean:next` script
- Set `dev` to remove stale `.next` first because corrupted Next dev cache previously caused:
  - `__webpack_modules__[moduleId] is not a function`
  - React client manifest missing-module errors

---

### 10. Landing page redesign — many iterations, final state is minimal and operational
**Files:**
- `src/app/page.tsx`
- `src/app/landing-page-surface.test.ts`
- `docs/superpowers/specs/2026-04-13-editorial-split-landing-desktop.md`
- `docs/superpowers/specs/2026-04-13-right-heavy-landing-balance.md`
- `docs/superpowers/plans/2026-04-13-landing-hero-minimal-cleanup.md`
- `docs/superpowers/plans/2026-04-13-native-mobile-landing-refactor.md`
- `docs/superpowers/plans/2026-04-13-editorial-split-landing-desktop.md`
- `docs/superpowers/plans/2026-04-13-right-heavy-landing-balance.md`
- `docs/superpowers/plans/2026-04-13-unboxed-landing-layout-refinement.md`

**Final landing state:**
- no giant boxed hero on desktop or mobile
- mobile feels more native-app-like
- desktop is right-heavy split:
  - left = narrow brand rail
  - right = main verification workspace
- visible install card removed from main flow
- noisy small labels removed from verification/quick-access blocks
- verification text simplified to:
  - `Enter mobile number.`
  - `Use employee mobile number to continue.`
- quick access kept as compact rows
- `Secondary paths` label removed
- install support remains only as conditional bottom install prompt logic, not as permanent content block

---

### 11. Browser/runtime warning cleanup
**Files:**
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/admin-login/page.tsx`
- `src/app/(app)/layout.tsx`
- `src/lib/fcm.ts`
- `src/app/browser-warnings.test.ts`

- Removed smooth-scroll warning from root html handling
- Fixed logo image aspect-ratio / sizing warnings
- Reduced noisy notification-permission console warning behavior

---

### 12. GitHub / branch sync repair for deploy pipeline
**Context:**
- local development moved on `main`
- GitHub remote default/HEAD still pointed to old `CISS` branch
- Vercel production was still building from `CISS`

**What happened:**
- `main` already had latest commit `2ca12e7f`
- remote `CISS` was stale at `17a42e1e`
- Vercel production domain therefore did not pick up latest `main` changes

**Fix performed:**
- pushed `main` into remote `CISS`
- after fix:
  - `main` -> `2ca12e7f30cd9c850c3eec98deae3b6580263732`
  - `CISS` -> `2ca12e7f30cd9c850c3eec98deae3b6580263732`
- this triggered new Vercel production deployment:
  - `dpl_EV7UqGF5vuAzfUr9wM44AywkhvSF`
  - target `production`
  - aliases include `cisskerala.site`

**Important remaining repo fact:**
- GitHub website default branch setting may still display `CISS`
- branch contents are synced, so deploys work again
- but long-term cleanup should still change GitHub default branch setting to `main`

---

## [2026-04-13] — Session: Landing page refactor

### 1. Landing page redesign — professional minimal + native mobile feel
**File:** `src/app/page.tsx`
- Removed `Card` box wrapping phone input (boxed hero eliminated on desktop and mobile)
- Quick access rows replaced outline buttons with native app-style list: branded icon square (bg `#014c85`) + label + subtitle + ChevronRight, grouped in rounded-2xl container with dividers
- Typography tightened: `text-2xl` brand title, `text-xs uppercase tracking-widest` section labels, smaller body text
- Layout: flex-col justify-center on desktop, top-aligned `pt-14` on mobile, max-w-sm
- Brand color `#014c85` applied inline on CTA button, icon backgrounds, install banner button
- Input styled with `bg-gray-50 rounded-xl`, brand-blue focus ring
- PWA install banner redesigned to match app row aesthetic

---

## [2026-04-12] — Session: Payroll fixes + Wage config redesign

### 1. Removed unused npm packages
**Files:** `package.json`
- Removed: `axios`, `html2canvas`, `html5-qrcode`, `jspdf`, `@tanstack/react-query`, `@tanstack-query-firebase/react`
- Moved `dotenv` to devDependencies
- Upgraded `next` 15.5.12 → 15.5.15
- Ran `npm audit fix` — vulnerabilities reduced from 37 to 11 (remaining are upstream unfixable: xlsx, firebase-admin)

---

### 2. Fixed attendance aggregator — critical payroll bug
**File:** `src/lib/payroll/attendance-aggregator.ts`
- **Bug 1:** Query used `employeeId` (CISS guard ID like "CISS12345") but payroll passes `employeeDoc.id` (Firestore document ID) → zero present days for all employees → 100% LOP
- **Fix:** Changed Firestore query field to `employeeDocId`
- **Bug 2:** No date range filter → full collection scan every time
- **Fix:** Added `attendanceDate >= startDateStr` and `attendanceDate <= endDateStr` filters (YYYY-MM-DD strings)
- **Required:** New composite Firestore index added to `firestore.indexes.json`

---

### 3. Added Firestore composite index for attendance
**File:** `firestore.indexes.json`
- Added: `attendanceLogs` collection — `(employeeDocId ASC, attendanceDate ASC)`

---

### 4. Payroll run — skipped employees tracking
**File:** `src/app/api/admin/payroll/run/route.ts`
- Added `skippedEmployees[]` array tracking employees skipped due to missing wage config
- Response now includes `skippedEmployees` and `skippedCount`

---

### 5. New payroll validation endpoint
**File:** `src/app/api/admin/payroll/validate/route.ts` *(new)*
- `GET /api/admin/payroll/validate?period=YYYY-MM&clientId=xxx`
- Returns: `{ totalEmployees, readyCount, skippedCount, skipped[], existingCycle }`
- Checks which employees have wage config before committing a payroll run

---

### 6. Payroll cycles — DELETE endpoint
**File:** `src/app/api/admin/payroll/cycles/[id]/route.ts`
- Added `DELETE` handler
- Blocked on `finalized` or `paid` status
- Deletes all `payrollEntries` sub-docs in batches of 450, then deletes the cycle doc

---

### 7. Payroll run page — pre-run validation UI
**File:** `src/app/(app)/payroll/run/page.tsx` *(rewritten)*
- Added validation step between period selection and processing
- Shows pre-run summary: ready count, skipped count, names of skipped employees
- Warns if a cycle already exists for the selected period
- Disables "Process" button if nothing is ready or a conflict exists

---

### 8. Payroll cycle detail page — Delete & Re-run
**File:** `src/app/(app)/payroll/cycles/[id]/page.tsx`
- Added "Delete & Re-run" button (only visible for non-finalized, non-paid cycles)
- Added confirmation dialog before delete
- On success: navigates back to `/payroll`

---

### 9. Wage config — removed AI parsing, replaced with Excel column analysis
**Files:**
- `src/app/api/admin/clients/[id]/wage-config/upload/route.ts` *(completely rewritten)*
- `src/app/(app)/settings/wage-config/page.tsx` *(completely rewritten)*

**Upload route** — no longer calls Gemini/OpenRouter. Now:
- Reads the uploaded Excel with `xlsx` library
- Finds first non-empty row as column headers
- Analyzes each column's values independently using:
  - Name-based statutory detection (EPF → `pct_of_epf_base`, ESIC → `pct_of_gross`, PT → `kerala_slab`, TDS → `tds_projected`)
  - `%` suffix detection in cells
  - Multi-row ratio detection against the Basic column (if ratio consistent within 2% across rows → infers `pct_of_basic`)
  - HRA single-row ratio fallback
  - Default: `fixed_amount` with first numeric value
  - `isLikelySummary` flag for columns to skip by default (Gross, Total, Net Pay, Employee Name, SL No, etc.)
- Returns: `{ sheetNames, selectedSheet, headers, rows, totalRows, columnAnalysis: ColumnAnalysis[] }`

**Wage config page** — 3-stage wizard:
1. **Upload stage** — drag-drop Excel upload; shows shortcut if config already exists
2. **Select stage** — checkboxes per column with type badge, detected hint, sample values; summary columns auto-deselected
3. **Configure stage** — per-component cards with:
   - Editable name + type selector
   - "Detected calculation" info block with 3 action buttons: "Use sheet value ₹X", "Use formula", "Edit / Customise"
   - Inline formula editor (calc type select + value/rate input + reset)
   - EPF applicable + Statutory checkboxes
   - Collapsible live preview (₹15,000 CTC base)
   - Save button → calls `PUT /api/admin/clients/:id/wage-config`

**`ComponentDraft` interface extends `WageComponent` with:**
- `useSheetValue: boolean`
- `detectedValue: number | null`
- `detectedRate: number | null`
- `detectedCalcType: CalculationType`
- `detectedHint: string`
- `isEditing: boolean`

Draft-specific fields are stripped before saving to Firestore.

---

### 10. Created project documentation files
**Files:**
- `CLAUDE.md` *(new)* — Instructions for Claude Code: rules, architecture notes, files to read per feature area
- `MEMORY.md` *(new)* — This file. Changelog of all codebase changes.

---

## Key Architecture Facts (Quick Reference)

| Fact | Value |
|------|-------|
| Attendance query field | `employeeDocId` (NOT `employeeId`) |
| Attendance date field | `attendanceDate` (YYYY-MM-DD string) |
| Wage config collection | `clientWageConfig/{clientId}` |
| Payroll run passes to aggregator | `employeeDoc.id` (Firestore doc ID) |
| Brand blue | `#014c85` |
| Brand gold | `#bd9c55` |
| Deploy target | Vercel, `main` branch |
| Firebase project | `ciss-workforce` |

---

## [2026-04-12] — Wage register upload: header detection fix

**File:** `src/app/api/admin/clients/[id]/wage-config/upload/route.ts`

- **Bug 1 (header row):** Code picked the *first* non-empty row as the column header row. TCS-format wagesheets have 2 title rows before real headers (row 0: "CISS SERVICES LTD", row 1: month title, row 2: actual column labels). Fix: scan first 10 rows and pick the row with the **most non-empty cells**.
- **Bug 2 (TOTAL row):** Geodis sheets have a `TOTAL` summary row inside the data range that skewed ratio analysis. Fix: filter out rows whose first non-empty cell matches `total / grand total / subtotal` (case-insensitive).

---

## Known Issues / Deferred

- `xlsx` package has an unfixable upstream vulnerability — no workaround without replacing the library
- `firebase-admin` / `@tootallnate/once` vulnerability — fix would require downgrading to firebase-admin v10 (breaking); left as-is
- `@types/node` peer dependency warning from vitest — requires vitest upgrade to resolve

---

## [2026-04-16] — Session: Fix enrollment form — missing auth token

### Both enroll pages used plain fetch → 401 on submit
**Files modified:** `src/app/(app)/employees/enroll/page.tsx`, `src/app/enroll/page.tsx`
- Both called `fetch("/api/employees/enroll", ...)` with no Authorization header
- API requires `requireAdmin` (added in A-04 security audit) → every submit returned 401
- Added `authorizedFetch` import, replaced `fetch` → `authorizedFetch` in both submit handlers

---

## [2026-04-16] — Session: Fix work-order PATCH blocking field officers + bad error handlers

### PATCH /api/admin/work-orders/[id] now allows field officers
**File modified:** `src/app/api/admin/work-orders/[id]/route.ts`
- PATCH used `requireAdmin` → field officers got 403 trying to save guard assignments
- Changed to `requireAdminOrFieldOfficer(await verifyRequestAuth(request))`
- Fixed catch blocks in PATCH and DELETE: all errors previously mapped to 401; now auth errors → 401/403, everything else → 500

### POST /api/admin/work-orders catch block fixed
**File modified:** `src/app/api/admin/work-orders/route.ts`
- Same bad catch pattern fixed: auth errors → 401/403, other errors → 500

---

## [2026-04-16] — Session: Removed email verification gate from admin/field-officer/client login

### emailVerified check removed from admin login
**File modified:** `src/app/admin-login/page.tsx`
- Removed the `emailVerified` block that blocked login for unverified emails
- All roles (admin, fieldOfficer, client) can now log in without email verification
- Change applied because Firebase Auth accounts created server-side via Admin SDK are not automatically marked verified, causing a false "Email Not Verified" error for field officers and client admins

---

## [2026-04-17] — Session: UI/UX overhaul — batch 3 (redesign + high-end-visual-design skills)

### Files modified
- `src/app/globals.css`
- `src/components/dashboard/stats.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/button.tsx`

### Changes

**globals.css**
- Grain/noise overlay via `body::after` — SVG feTurbulence, `opacity: 0.022`, fixed, `pointer-events: none`, `z-index: 9998`; breaks digital flatness with physical paper texture
- `h1, h2, h3 { text-wrap: balance }` globally — prevents orphaned words
- `.tabular-nums` / `[data-tabular-nums]` utility — `font-variant-numeric: tabular-nums` for data tables and stat numbers
- `.bezel` class — double-bezel (Doppelrand) outer shell: `bg-muted/0.5`, `border`, `3px padding`, `border-radius: radius+4px`
- `.inset-highlight` class — inner top edge highlight `inset 0 1px 0 hsl(0 0% 100% / 0.12)` for surface depth

**stats.tsx (DashboardStats)**
- Stat cards now use double-bezel: outer `.bezel` div wrapping inner `.bg-card.inset-highlight` div
- `getValue(index).toLocaleString()` — locale-formatted numbers
- `tabular-nums` class on stat number `<p>`

**card.tsx**
- `CardTitle` now has `[text-wrap:balance]` — balanced heading text

**button.tsx**
- `transition-all` → `transition-[transform,box-shadow,background-color,opacity,filter]` — specific props only, no layout triggers
- `active:scale-[0.96]` → `active:scale-[0.97]` — consistent with Emil scale
- `active:transition-none` removed — transitions should apply during press too
- Default variant: inner top highlight `[box-shadow:inset_0_1px_0_hsl(0_0%_100%/0.12),var(--shadow-brand-sm)]` — machined glass feel

---

## [2026-04-17] — Session: UI/UX overhaul — batch 2 (complete implementation)

### Files modified
- `src/components/ui/dialog.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/popover.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/dashboard/stats.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/employees/[id]/page.tsx`
- `src/app/(app)/work-orders/[siteId]/page.tsx`
- `src/app/profile/[id]/page.tsx`
- `src/app/globals.css`

### Changes

**dialog.tsx**
- Open duration → 220ms with `cubic-bezier(0.23,1,0.32,1)` (--ease-out); close → 160ms
- `DialogTitle` now uses `font-exo2`

**sheet.tsx**
- Open duration 500ms → 250ms with `--ease-drawer` curve; close 300ms → 200ms with `--ease-out`
- `SheetTitle` now uses `font-exo2 tracking-tight`

**popover.tsx**
- `style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}` — scales from trigger not center
- Open 180ms / close 130ms with `--ease-out`

**tooltip.tsx**
- `style={{ transformOrigin: "var(--radix-tooltip-content-transform-origin)" }}` — origin-aware
- Duration 125ms with `--ease-out`

**tabs.tsx**
- Active tab trigger: `data-[state=active]:text-primary data-[state=active]:font-semibold` — brand blue active state

**stats.tsx (DashboardStats)**
- `animate-slide-up stagger-{1-4}` on each stat card — cascading entry
- First card (index 0) gets `border-l-4 border-l-primary` depth accent
- Stat number `<p>` now uses `font-exo2`

**dashboard/page.tsx**
- Quick-action card padding `p-3.5` → `p-4`

**employees/[id]/page.tsx + profile/[id]/page.tsx + work-orders/[siteId]/page.tsx**
- Full-page loading: `h-12 w-12` + inline text → `flex-col h-8 w-8` spinner + small muted text

**globals.css**
- `.press-scale` easing fixed: `cubic-bezier(0.4,0,0.6,1)` (ease-in) → `var(--ease-out)`, scale `0.96` → `0.97`
- `.card-interactive` transition easing → `var(--ease-out)`

---

## [2026-04-17] — Session: UI/UX overhaul (Emil Kowalski principles)

### Files modified
- `src/app/globals.css`
- `tailwind.config.ts`
- `src/app/admin-login/page.tsx`
- `src/components/layout/page-header.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/badge.tsx`

### Changes

**globals.css**
- Added `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`, `--ease-drawer: cubic-bezier(0.32,0.72,0,1)` CSS vars to `:root`
- Fixed input `transition: all` → specific properties (`border-color`, `box-shadow`, `background-color`) using `var(--ease-out)`
- Added explicit brand-blue `focus-visible` ring on `input` and `textarea`
- Fixed `button:active` easing from `cubic-bezier(0.4,0,0.6,1)` (ease-in, wrong) → `var(--ease-out)` at 100ms
- Added `@media (prefers-reduced-motion: reduce)` gate — kills all animations/transitions for accessibility
- Added touch hover guard `@media not all and (hover: hover) and (pointer: fine)` on `.card-interactive` — prevents false hover on tap
- Added `tbody tr` hover: `background-color: hsl(var(--muted) / 0.5)` with 100ms `var(--ease-out)` transition

**tailwind.config.ts**
- Added `transitionTimingFunction`: `ease-out-strong`, `ease-in-out-strong`, `ease-drawer` (Emil curves)
- Added `fontFamily.exo2` → `var(--font-exo-display)` (Exo 2 now available as `font-exo2` Tailwind class)

**admin-login/page.tsx**
- Full rebrand: brand-blue gradient background (`#014c85` → `#012f52`), white card with gold `border-t-4 border-[#bd9c55]`, Exo 2 wordmark + card title, brand-blue focus rings on inputs, shadow-heavy card, `animate-slide-up` entry
- Removed unused `Card*` imports

**page-header.tsx**
- Added `font-exo2 tracking-tight` to `<h1>` — Exo 2 now on all page titles

**card.tsx**
- Added `font-exo2` to `CardTitle` — card section headers use Exo 2

**badge.tsx**
- Added dark mode variants to all semantic/status badges (`success`, `warning`, `info`, `error`, `active`, `inactive`, `leave`, `exited`)

---

## [2026-04-16] — Session: Admin login env-var guard (VERCEL)

### Affected feature: Admin login page (/admin-login)
- Issue: Accessing admin portal showed "Auth/API key not valid" due to misconfigured Vercel environment variables for Firebase frontend config.
- Change: Added a safe guard in Admin Login page to detect missing Firebase frontend config (NEXT_PUBLIC_FIREBASE_* vars) and present a clear error message instead of failing silently or throwing API-key errors.
- How to verify:
  - Ensure Vercel environment has the required NEXT_PUBLIC_FIREBASE_API_KEY and related vars set to the Firebase project values.
  - Deploy the change and attempt to open https://cisskerala.site/admin-login; you should see a descriptive error if env vars are missing, instead of a cryptic API key error.

---

## [2026-04-25] — Session: Firebase reliability + rules hardening + Work Orders filters

### Key outcomes
- Local and production public flows verified end-to-end (enrollment + attendance submit) with dummy data and cleanup.
- Firebase Admin local auth fixed by preferring ADC for development when service-account key is invalid/revoked.
- Firestore and Storage rules audited, tightened, and deployed (no raw public reads for operational collections; no public reads of sensitive uploads).
- Attendance photo upload refactored to a server upload route that returns a tokenized download URL (avoids public Storage read permissions).
- Work Orders exam filtering fixed and date sorting removed (date filtering remains).

### Files modified
- `src/lib/firebaseAdmin.ts`
- `.env.example`
- `firestore.rules`
- `storage.rules`
- `src/app/api/public/clients/route.ts`
- `src/app/api/public/attendance/route.ts`
- `src/app/api/public/attendance/upload/route.ts`
- `src/app/attendance/page.tsx`
- `src/app/(app)/work-orders/page.tsx`
- Plus shared UI system files (theme/components/layout) updated as part of the modern redesign pass.

### Firebase Admin credentials (local dev)
- Root cause: `.env.local` contained a service-account key that parsed but failed to mint tokens (`invalid_grant: Invalid JWT Signature`), causing Admin SDK reads to throw `16 UNAUTHENTICATED`.
- Fix: `src/lib/firebaseAdmin.ts` now supports a local-only switch:
  - `FIREBASE_ADMIN_PREFER_APPLICATION_DEFAULT=true` makes local dev use `admin.credential.applicationDefault()`
  - `.env.example` documents this flag.
- Notes:
  - Production (Vercel) continues to use explicit service-account credentials.
  - ADC requires `gcloud auth application-default login` (or equivalent) on the dev machine.

### Firestore rules (security + functionality)
- `clients`, `sites`, `clientLocations`:
  - Read requires signed-in user (no anonymous raw reads).
  - Writes remain admin-only.
- Public enrollment/attendance reads are intended to happen via server routes (`/api/public/*`) rather than direct Firestore access.
- Low-risk lookup collections remain public read:
  - `districts`, `states`.
- Rules were deployed via Firebase CLI.

### Storage rules (security + enrollment compatibility)
- Enrollment uploads:
  - `enrollments/{employeeKey}/profilePictures` and `signatures`: allow anonymous `create` (image only, 15MB cap).
  - `enrollments/{employeeKey}/idProofs`, `addressProofs`, `bankDocuments`, `policeCertificates`: allow anonymous `create` (image/pdf only, 5MB cap).
  - Read for sensitive enrollment files is now restricted to signed-in users (no anonymous reads).
- Legacy `employees/{employeeKey}/*` paths:
  - Sensitive documents/portraits are now admin-only `create` and signed-in `read`.
  - Attendance photo `create` remains allowed (needed by attendance flow), but reads are restricted to signed-in users.
- Rules were deployed via Firebase CLI.

### Attendance photo upload: server route (fixes anonymous getDownloadURL)
- Problem: after Storage rules were tightened, anonymous attendance could upload a photo but could not call `getDownloadURL()` (read denied).
- Fix:
  - Added `POST /api/public/attendance/upload` in `src/app/api/public/attendance/upload/route.ts`.
  - This route saves the photo via Admin SDK and returns a tokenized `alt=media&token=...` URL.
  - `src/app/attendance/page.tsx` now uploads the photo via this route and passes the returned URL into `/api/attendance/submit`.

### Enrollment: public upload + server-side save verified
- `/api/public/enroll/upload` handles file validation (type/size) and saves via Admin Storage bucket.
- `/api/employees/enroll` validates payload via Zod and writes the `employees` doc via Admin SDK.

### Work Orders: exam filter and sort fixes
- Root cause: Work Orders filtered list `useMemo` did not include `selectedExam` as a dependency, causing stale results when changing exam filter.
- Fixes in `src/app/(app)/work-orders/page.tsx`:
  - Added `selectedExam` (and required dependencies) to the memo dependency list.
  - Normalized exam matching (trim + case normalization).
  - Removed date sort options (`sort=date-asc/date-desc`) since date filtering already exists.
  - URL cleanup removes any old `dateSort` or date-sort `sort` values.
  - Exam ordering remains (`exam-asc` / `exam-desc`), with date as stable tie-break.

### Commits (reference)
- `c288a66b` "feat: refresh UI and secure Firebase uploads" (rules + admin ADC + attendance upload + UI system pass)
- `c0b00ffb` "fix: repair work order exam filter" (exam filter dependency + remove date sort)

---

## [2026-04-27] — Kerala admin authority

### Admin identity
- `admin@cisskerala.app` is the Kerala region admin user.
- This account has full admin authority to manage Kerala operations.
- Runtime env values were aligned to use `admin@cisskerala.app`:
  - `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`
  - `SUPER_ADMIN_EMAIL`
- Code already treats `admin@cisskerala.app` as a legacy admin fallback in `LEGACY_ADMIN_EMAILS`.
- Firestore rules already allow this email through `isAdmin()`.

### Firebase Auth claim repair
- Firebase Auth user `admin@cisskerala.app` existed and was enabled.
- The account previously had mixed stale custom claims:
  - `role: "client"`
  - `clientName: "Logiware"`
  - `clientId: "dWdAFXalgmRgByC0QzB5"`
  - `admin: true`
- Cleaned the claim to a pure Kerala admin claim:
  - `admin: true`
  - `role: "admin"`
  - `stateCode: "KL"`
- This prevents the admin account from being resolved as a client user in any UI/API path.

---

## [2026-05-01] — Work-order delete must clear import fingerprints

### Root cause
- Frontend row delete hid/deleted `workOrders`, but the bulk row-delete path left matching `workOrderImports` documents behind.
- Import preview checked `workOrderImports.binaryFileHash` / `contentHash` first and blocked re-upload as duplicate, even when no active work orders remained for that import.

### Fix
- Added `cleanupOrphanWorkOrderImports` in `src/lib/server/work-order-import-cleanup.ts`.
- Single row delete and frontend bulk row delete now load the deleted work-order data, delete the row(s), then delete orphan import records only when no active `workOrders` remain for the same `importId`, `binaryFileHash`, or `contentHash`.
- Import preview now treats matching import hashes as duplicates only when active work orders still back that import/fingerprint.
- Regression coverage added for:
  - re-upload after orphan import metadata,
  - single work-order delete import cleanup,
  - frontend bulk row-delete import cleanup.

### Duplicate re-upload handling
- New imports that detect duplicate/overlapping work orders can now be committed with an explicit duplicate handling choice:
  - `replace`: update matching active site/date work orders with the uploaded row while preserving assigned guards.
  - `omit`: skip matching active site/date rows and import only genuinely new rows.
- Revision imports keep their existing behavior: update matching rows and cancel missing active rows.
