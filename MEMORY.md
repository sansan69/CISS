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
- Removed `overtimeRatePerHour` field from `WageTemplate` and `WageTemplateInput`

### UI cleanup
- `AttendanceSummaryCard` removed "Overtime Hours" and "LOP Days" display rows
- `WorkingDaysDisplay` removed `overtimeHours` prop and display
- Payroll admin pages and employee self-service pages updated to remove leave/overtime references

---

## [2026-05-04] — Session: New wage-config builder

Wage config rebuilt from scratch to support full payroll requirements.

### New types (`src/types/wage-config.ts`)
New canonical types: `WageConfig`, `WageConfigSection`, `WageComponent`, `WageComponentCalc`, `WageCalcType`.

### Client wage config API (`src/app/api/admin/clients/[id]/wage-config/`)
- `GET` returns wage config sections + components
- `PUT` accepts sections array, normalizes IDs, upserts components
- Component upsert uses idempotency: existing components updated, new ones created
- Supports all calc types: `fixed_amount`, `pct_of_basic`, `pct_of_ctc`, `pct_of_gross`, `pct_of_epf_base`, `balancing`, `kerala_slab`, `tds_projected`

### Wage config builder page (`src/app/(app)/settings/wage-config/page.tsx`)
- Full CRUD for wage config sections and components
- Drag-and-drop section reordering
- Component form with dynamic calc type fields
- Preview of computed values
- Validation for component names and calc types

### Payroll types updated
- `PayrollEntryEarnings` and `PayrollEntryDeductions` now use `WageComponent`
- `PayrollEntry` uses `WageConfigSection[]` for wage structure

---

## [2026-05-05] — Session: Payroll engine overhaul

### Payroll run API (`src/app/api/admin/payroll/run/route.ts`)
- Uses `aggregateAttendance(employeeDocId, period, db)` for attendance data
- Fetches wage config from `clientWageConfig/{clientId}`
- Computes CTC, gross, net pay using wage components
- Supports Kerala slab and TDS projected calc types
- Stores payroll entries in `payrollEntries` collection

### Payroll calculate engine (`src/lib/payroll/calculate.ts`)
- `calculatePayroll()` function takes employee, attendance, wage config
- Returns detailed breakdown: basic, HRA, DA, allowances, PF, ESI, TDS, PT
- Handles Kerala professional tax slab
- Computes projected TDS for the financial year

### Payroll cycles (`src/app/api/admin/payroll/cycles/`)
- `POST` creates a new payroll cycle
- `GET` lists all cycles for a client
- Cycle status: `draft`, `processing`, `completed`, `cancelled`

### Payroll entries (`src/app/api/admin/payroll/entries/`)
- `GET` lists entries for a cycle
- `POST` recalculates an entry
- Supports filtering by employee, status, amount range

### Payslip generation (`src/lib/payroll/payslip.ts`)
- `generatePayslip()` creates PDF payslip from payroll entry
- Includes company header, employee details, earnings/deductions table, net pay, bank details
- Uses `pdfmake` for PDF generation

---

## [2026-05-07] — Session: Employee salary profiles + bulk ops

### Employee salary profile (`src/app/(app)/employees/[id]/salary/page.tsx`)
- Displays current salary structure from wage config
- Shows historical salary changes
- Allows editing basic salary and components
- Validation for minimum wage compliance

### Bulk payroll operations (`src/app/(app)/payroll/bulk/page.tsx`)
- Upload Excel/CSV for bulk payroll entry
- Validates employee codes, amounts, days worked
- Preview before commit
- Error report for invalid rows

### Payroll reconciliation (`src/app/(app)/payroll/reconcile/page.tsx`)
- Compares payroll entries with attendance data
- Highlights discrepancies: missing attendance, extra days, amount mismatches
- Allows manual adjustment with reason

### Payroll reports (`src/app/(app)/payroll/reports/page.tsx`)
- Monthly summary by client/site
- Cost center breakdown
- PF/ESI summary for statutory filing
- TDS summary for quarterly returns

---

## [2026-05-09] — Session: Attendance system + dual path

### Record attendance page (`src/app/record-attendance/page.tsx`)
- Public page for guards to mark attendance
- Supports both "Guard Portal" (select site/duty point) and "QR Scan" modes
- Photo capture for IN and OUT
- Geofence validation with override option
- Rate limiting (5 attempts per minute)

### QR attendance API (`src/app/api/public/attendance/verify-qr/route.ts`)
- Verifies QR code token (HMAC-SHA256)
- Returns employee details, site info, shift info
- Validates QR freshness (5 minute expiry)

### Attendance validation API (`src/app/api/attendance/validate/route.ts`)
- Pre-flight validation before submission
- Checks for duplicate IN, missing OUT, shift matching
- Returns resolved shift, next expected action, warnings

### Attendance submission API (`src/app/api/attendance/submit/route.ts`)
- Idempotent submission with `clientRequestId`
- Creates `attendanceLogs` document
- Updates `attendanceState` for the employee
- Creates/updates `attendanceSessions` document
- Geofence validation with `strict`/`warn`/`loose` modes
- Handles overnight shifts (crossesMidnight)

### Attendance state machine (`src/lib/attendance/attendance-validation.ts`)
- `canRecordIn()`: checks if IN is allowed (prevents duplicate IN at same duty point)
- `canRecordOut()`: checks if OUT is allowed (requires open IN session)
- `resolveOperationalAttendanceDate()`: handles next-day checkout for overnight shifts
- `computeAutoCheckoutTime()`: calculates when session should auto-close
- `isSessionStale()`: checks if open session has exceeded allowed duration

### QR token generation (`src/lib/qr/qr-token.ts`)
- `generateQRToken()`: creates HMAC-SHA256 signed token with employee info
- `verifyQRToken()`: validates token, checks expiry, returns decoded payload
- Backward compatible with old plain-text QR codes

### Rate limiting (`src/lib/server/rate-limit.ts`)
- Firestore-based rate limiting for serverless environments
- `checkRateLimit()`: checks if action is within limit
- `recordAttempt()`: records an attempt
- Configurable window and max attempts

---

## [2026-05-11] — Session: Attendance logs + geo tracking

### Attendance logs page (`src/app/(app)/attendance-logs/page.tsx`)
- Complete rewrite with client-grouped Accordion view
- Date range picker with preset ranges (Today, Yesterday, Last 7 days, etc.)
- District filter dropdown
- Per-client summary stats (present, absent, total guards)
- CSV export with all fields
- Role-scoped views: admin (all), field officer (district-limited), client (client-limited)

### Geo tracking service (`lib/core/location/background_tracking_service.dart`)
- Complete rewrite for hybrid indoor/outdoor positioning
- GPS best (8s timeout) → network WiFi/cell (5s timeout) → last known fallback
- Indoor accuracy buffer: adds `accuracy/2` to geofence radius when accuracy >30m
- Geofence state machine: entry/exit detection with 2-consecutive-out rule
- 3-minute heartbeat + 30-second movement trace
- Battery optimization handling

### Permission onboarding (`lib/features/auth/presentation/permission_onboarding_screen.dart`)
- Rewritten with real-time permission tracking
- Checks: location, camera, photos, notification, biometric
- Shows which permissions are granted/missing
- Redirects to app settings for permanently denied permissions

### Android manifest updates
- Added: `ACCESS_WIFI_STATE`, `ACTIVITY_RECOGNITION`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `VIBRATE`, `USE_BIOMETRIC`, `USE_FINGERPRINT`

---

## [2026-05-12] — Session: Biometric login + dashboard redesign

### Biometric credential storage (`lib/core/auth/biometric_credential_store.dart`)
- `FlutterSecureStorage`-backed encrypted credential storage
- Stores username, password (encrypted), role
- `saveCredentials()`, `getCredentials()`, `deleteCredentials()`

### Biometric service (`lib/core/auth/biometric_service.dart`)
- `authenticate()`: triggers device biometric prompt with fallback to PIN/pattern
- `isAvailable()`: checks if biometrics are enrolled
- `getAvailableBiometrics()`: returns enrolled types (fingerprint, face, iris)
- Localized reason messages

### Saved accounts service (`lib/core/auth/saved_accounts_service.dart`)
- `SavedAccountsService` manages list of saved accounts
- `biometricEnabled` flag per account
- `addAccount()`, `removeAccount()`, `getAccounts()`, `setBiometricEnabled()`

### Auth controller updates (`lib/features/auth/application/auth_controller.dart`)
- `saveForBiometric()`: encrypts and stores credentials after successful login
- `getStoredPassword()`: retrieves stored password for biometric unlock
- `setBiometricEnabled()`: toggles biometric for an account
- `deleteBiometricCredentials()`: removes stored credentials

### Role login screen (`lib/features/auth/presentation/role_login_screen.dart`)
- Saved account tiles with biometric unlock button
- Tapping tile attempts biometric auth, auto-fills form, auto-submits on success
- "Enable biometric" checkbox during login
- Clean separation: saved accounts section vs. manual login section

### Auth gate screen (`lib/features/auth/presentation/auth_gate_screen.dart`)
- Biometric re-authentication gate for returning users
- Checks all permissions on app resume
- Expanded to include `locationAlways` and `notification`

### Dashboard widgets (new)
- `DashboardHeader`: time-aware greeting + profile photo with status dot
- `QuickActionBar`: 5 prominent shortcuts with 48dp touch targets
- `StatPillRow`: 3 compact stat pills with icon + metric
- `ActivityFeed`: recent activity list with empty state
- `DutyStatusCard`: color-coded duty status (On Duty/Standby/Off Duty)

### Guard dashboard (`lib/features/guard/presentation/screens/guard_dashboard_screen.dart`)
- Complete rewrite: header → duty status → quick actions → stats → recent activity → performance score
- Uses `AppTypography` for consistent text styles
- Uses `AppShadows.subtle`/`elevated` for depth

### Field officer dashboard (`lib/features/field_officer/presentation/screens/field_officer_dashboard_screen.dart`)
- Complete rewrite: header → stats → quick actions → attendance coverage → pending items
- Consistent with guard dashboard design language

### App tokens update (`lib/app/theme/app_tokens.dart`)
- Added `AppTypography` with 8 pre-defined text styles (display, headline, title, body, caption, etc.)
- Added `AppShadows.subtle` and `AppShadows.elevated`

---

## [2026-05-15] — Session: Shift resolution + attendance edge cases

### Shift resolution fix (`src/lib/shift-utils.ts`)
- **Problem:** `resolveSiteShift()` matched shifts by current wall-clock time, but guards often arrive early/late or work overnight shifts
- **Solution:** New `resolveAttendanceShift()` function that matches shifts based on punch time, not current time
- **Rules:**
  - Early arrival (up to 120 min before shift start) → match that shift
  - Late arrival (up to 60 min after shift start) → match that shift
  - Well into shift (>60 min after start) → match that shift
  - Tail-end handoff (within 120 min of shift end) → prefer NEXT shift to avoid assigning to ending shift
  - If no match, falls back to shift with closest start time

### Shift resolution tests (`src/lib/shift-utils.test.ts`)
- 22 tests covering:
  - Day shift IN at 08:45 → matches 09:00 shift
  - Night shift IN at 21:30 → matches 22:00 shift
  - Late arrival IN at 10:15 → matches 09:00 shift
  - Tail-end handoff IN at 16:50 → prefers next 18:00 shift over ending 14:00 shift
  - Overnight shift: IN at 21:00, OUT at 06:00 next day
  - Multiple shifts: correct selection among 2+ shifts

### Mobile shift pre-selection (`lib/core/models/attendance_models.dart`)
- Added `resolveAttendanceShiftTemplate()` for mobile client-side shift matching
- Same logic as web version: early arrival, late arrival, tail-end handoff

### State machine expansion (`src/lib/attendance/attendance-validation.ts`)
- **`canRecordIn()`**: prevents duplicate IN at same duty point, allows auto-close of stale previous session
- **`canRecordOut()`**: allows same-day checkout, next-day overnight checkout, auto-close of stale session
- **`computeAutoCheckoutTime()`**: calculates exact ISO timestamp for auto-checkout based on shift end + 120 min buffer
- **`isSessionStale()`**: checks `autoCheckoutAt` first, then falls back to max session hours (24h)

### Submit route hardening (`src/app/api/attendance/submit/route.ts`)
- Replaced ad-hoc state checks with `canRecordIn()`/`canRecordOut()` state machine
- Stores `autoCheckoutAt` on every IN punch (for cron job to use)
- Handles `action: "autoClosePrevious"` — closes stale session and creates new IN
- Handles `action: "autoCloseStale"` — closes stale session and creates OUT
- All UTC date computations to prevent timezone drift

### Auto-checkout cron job (`src/app/api/attendance/auto-checkout/route.ts`)
- New scheduled job (Vercel Cron) that runs every 30 minutes
- Queries `attendanceState.where("lastStatus", "==", "In")`
- For each stale session:
  - Creates auto-closed OUT log in `attendanceLogs`
  - Updates `attendanceSessions` document status to "closed"
  - Updates `attendanceState`: lastStatus="Out", deletes openSessionId, autoCheckoutAt
- Protected by `CRON_SECRET` query param
- Returns count of closed sessions + reasons

### Mobile attendance screen updates
- `guard_attendance_screen.dart`: state-aware default IN/OUT from history, stale session banner
- `resolveAttendanceShiftTemplate()`: smart shift pre-selection based on punch time

### Tests
- `src/lib/attendance/attendance-validation.test.ts` — 24 tests, all passing
- `src/lib/shift-utils.test.ts` — 22 tests, all passing
- `npx tsc --noEmit` — 0 errors

---

## [2026-06-01] — Session: Fix auto-checkout for existing sessions + test audit

### 1. Auto-checkout cron fix (`src/app/api/attendance/auto-checkout/route.ts`)
- **Problem:** Existing `attendanceState` documents (created before this feature) don't have `autoCheckoutAt`, so the cron job would only catch sessions older than 24 hours
- **Fix:** Pre-fetch open `attendanceSessions` documents in batches of 10 (Firestore `in` limit). For each session missing `autoCheckoutAt`, compute it from the session's `shiftEndTime` and `shiftStartTime` using the same logic as `computeAutoCheckoutTime()`
- **Variable rename:** `batch` → `idBatch` inside loop to avoid shadowing the outer Firestore `batch`
- **Type safety:** `npx tsc --noEmit` — 0 errors

### 2. Pre-existing test audit
Ran full test suite. Confirmed 3 failures are **pre-existing** and unrelated to our changes:
- `src/app/api/public/attendance/route.test.ts:58` — expects certain location objects in public attendance options
- `src/app/api/field-officer/reports-submission.test.ts:261` — expects 201 but gets 400
- `src/app/api/attendance/attendance-flow.integration.test.ts:695` — passes `from=2026-05-20T00:00:00.000Z` to admin report endpoint which validates `YYYY-MM-DD` regex

### 3. All our tests still pass
- `src/lib/attendance/attendance-validation.test.ts` — 24/24 pass
- `src/lib/shift-utils.test.ts` — 22/22 pass
- `src/app/api/attendance/` integration tests — 3/4 pass (1 pre-existing failure above)

### Next steps (unchanged)
- Configure Vercel Cron job to call `/api/attendance/auto-checkout` every 30 minutes with `CRON_SECRET`
- Add `CRON_SECRET` environment variable to Vercel deployment
- Test scheduled auto-checkout on staging with real open sessions
- Regenerate employee QR codes to include new HMAC tokens

---

## [2026-06-01] — Session: Vercel Cron config + auto-checkout auth + tests

### 1. Vercel Cron configuration (`vercel.json`)
- Added `crons` array with:
  - `path`: `/api/attendance/auto-checkout`
  - `schedule`: `*/30 * * * *` (every 30 minutes)
- Valid JSON confirmed with `node -e "JSON.parse(...)"`

### 2. Auto-checkout route auth updates (`src/app/api/attendance/auto-checkout/route.ts`)
- **Problem:** Vercel Cron jobs send a signed `x-vercel-signature` header, not query params
- **Solution:** Added `verifyVercelCronSignature()` function that:
  - Parses `t=<timestamp>,v1=<signature>` format from `x-vercel-signature` header
  - Reconstructs payload as `<timestamp>.<body>`
  - Verifies HMAC-SHA256 signature using Web Crypto API
  - Uses constant-time comparison to prevent timing attacks
- Route now accepts **both**:
  - Query param `?key=CRON_SECRET` (for manual testing / external schedulers)
  - Vercel `x-vercel-signature` header (for Vercel Cron)
- `CRON_SECRET` environment variable required for both methods

### 3. Auto-checkout tests (`src/app/api/attendance/auto-checkout/route.test.ts`)
- **New file:** 3 tests covering:
  - Rejects requests without auth (401)
  - Allows requests with correct query param key (200, closedCount=0)
  - Auto-closes a stale session using shift end time (200, closedCount=1)
- Mocks Firestore `attendanceState`, `attendanceSessions`, `attendanceLogs`, and `batch`
- All 3 tests pass

### Verification
- `npx tsc --noEmit` — 0 errors
- `npx vitest run src/app/api/attendance/auto-checkout/route.test.ts` — 3/3 pass
- `npx vitest run src/lib/attendance/attendance-validation.test.ts` — 24/24 pass
- `npx vitest run src/lib/shift-utils.test.ts` — 22/22 pass

### Next steps
- Add `CRON_SECRET` environment variable to Vercel dashboard (Project Settings → Environment Variables)
- Deploy to Vercel (cron config is picked up from `vercel.json` automatically)
- Verify cron job runs by checking Vercel Functions logs
- Test scheduled auto-checkout on staging with real open sessions
- Regenerate employee QR codes via `/settings/qr-management` page (already uses HMAC tokens)

---

## [2026-06-01] — Session: APK download page + hosting infrastructure

### 1. Download page overhaul (`src/app/download/page.tsx`)
- Updated to serve APK directly from `/downloads/ciss-workforce-latest.apk` (hosted within the webapp)
- Added 6 feature highlights (including biometric login and night shift support)
- Added troubleshooting section (install blocked, storage space, login issues)
- Added fallback link to GitHub releases page for older versions
- Improved responsive layout and visual hierarchy

### 2. Downloads directory (`public/downloads/`)
- Created `public/downloads/` directory with `README.md` explaining:
  - How to build the APK from `CISS-Mobile` Flutter project
  - Naming convention: `ciss-workforce-latest.apk`
  - How to commit and push a new release
- Added `.gitignore` to ignore `*.apk` files (they should be committed intentionally)
- Added `.gitkeep` to preserve empty directory in git

### 3. Vercel serving configuration
- `vercel.json` already has correct headers for `/downloads/*.apk`:
  - `Content-Type: application/vnd.android.package-archive`
  - `Cache-Control: public, max-age=86400, immutable`

### How to release a new APK
1. Build release APK from `CISS-Mobile` repo:
   ```bash
   flutter build apk --release --split-per-abi
   ```
2. Copy to webapp:
   ```bash
   cp app-arm64-v8a-release.apk public/downloads/ciss-workforce-latest.apk
   ```
3. Commit and push:
   ```bash
   git add public/downloads/ciss-workforce-latest.apk
   git commit -m "release: mobile app vX.Y.Z"
   git push origin main
   ```
4. APK will be live at `https://<domain>/downloads/ciss-workforce-latest.apk`

### Note
- No APK file is currently present in the repository (it lives in CISS-Mobile repo)
- The download page is ready to serve it once placed in `public/downloads/`
- Guards and field officers can access the download page at `/download`
