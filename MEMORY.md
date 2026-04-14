# MEMORY.md — CISS Workforce Codebase Changelog

This file is the authoritative log of all changes made to the codebase.
**Read this before implementing anything.** Update it after every change.

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
