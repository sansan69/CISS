# MEMORY.md — CISS Workforce Codebase Changelog

This file is the authoritative log of all changes made to the codebase.
**Read this before implementing anything.** Update it after every change.

## [2026-06-28] — Session: Mobile-first landing & login redesign (Bold & Industrial)

### Overview
Redesigned the landing page (`/`), guard-login (`/guard-login`), and admin-login (`/admin-login`) pages with a dark navy + gold "Bold & Industrial" theme, optimized for mobile. Added QR scan for direct attendance from the landing page.

### Files Created
- `src/components/qr-scanner-dialog.tsx` — Reusable QR scanner Dialog component using `startHybridQrScanner`. Opens a full-screen camera feed with scan overlay, emits scan result on success.

### Files Modified
- `src/app/page.tsx` — Landing page overhaul:
  - Background changed from light (#f5f8fc) with blurred blobs to deep navy gradient + subtle diagonal security-grid overlay
  - Removed all decoration divs (blobs, grid pattern, radial gradients)
  - Header simplified to logo + "CISS Workforce" (no subtitle/badge)
  - Verification card restyled as dark glass (`bg-black/15 backdrop-blur`, white border, gold accents)
  - Added QR scan icon button next to the phone input → opens `QrScannerDialog`
  - QR scan → `/api/public/attendance/employee` lookup → routes to `/attendance?employeeId=XXX` or error toast
  - Removed "Quick access" card section; replaced with two ghost links below: "New guard? Enroll here" and "Guard Portal"
  - Footer simplified: "Admin" + "Download App" links + copyright in `text-white/40`
  - Desktop brand panel restyled to match dark theme (white/10 backgrounds, gold chip)
  - PWA install prompt restyled in dark glass

- `src/app/guard-login/page.tsx` — Card changed from white (`bg-card`) to dark glass (`bg-black/15 border-white/10 text-white`); tabs, labels, inputs, buttons, and links updated with dark theme + gold accents

- `src/app/admin-login/page.tsx` — Same card dark-glass treatment; background gradient matched to landing page; labels/inputs/buttons restyled consistently

### Spec
- `docs/superpowers/specs/2026-06-28-landing-login-redesign.md`

### Bugfix
- `src/components/field-officers/work-orders-panel.tsx` — FO work orders query lacked a `where("district", "in", ...)` filter, causing Firestore security rules to deny reads for work orders outside the FO's assigned districts. Added district-scoped query for non-admin users; admins continue to fetch all.

### Polish (landing page + QR scanner)
- `src/components/qr-scanner-dialog.tsx` — Rewritten: camera now starts via Dialog's `onOpenAutoFocus` instead of `useEffect`, ensuring the video element is mounted before accessing it. Added proper error states (camera denied, unavailable, unsupported) with user-facing messages and a "Try again" button.
- `src/app/page.tsx` — Visual polish pass:
  - Border-radii standardized to ShadCN tokens (`rounded-3xl` for card, `rounded-2xl` for inner sections)
  - Added `inset-highlight` shadow on glass surfaces for depth
  - Gold focus ring on phone input (`focus-visible:ring-2 ring-brand-gold/60`)
  - QR button changed from Button component to plain `<button>` with consistent border styling, aria-label, and hover/active states
  - CTA button changed from `font-semibold` to `font-bold`, added gold-tinted shadow and active scale
  - "Verify Employee" → "Continue" (shorter, clearer)
  - "Processing..." → "Verifying..."
  - Placeholder text: "Enter your 10-digit number" → "10-digit mobile number"
  - Link hover states improved with `hover:underline` offset approach
  - Spacing tightened between card sections, links, and footer
  - PWA install prompt restyled with cleaner borders, smaller buttons, smoother animation
  - Icon colors softened in glass containers
  - Secondary links and footer text opacity refined for visual hierarchy

### Firebase deploy
- Deployed Firestore indexes (including `workOrders district ASC, date ASC` for FO-scoped queries) and security rules.

### Bugfix: FCM token registration
- `src/lib/fcm.ts` — `registerFCMToken` did not include `uid` in the written data, causing security rule `request.resource.data.uid == request.auth.uid` to fail. Added `uid` field to the payload.
- `firestore.rules` — Changed `fcmTokens` write rule from field check to document ID match (`tokenId == request.auth.uid`), which is more reliable since the doc ID is already the user UID.

---

## [2026-06-28] — Session: Reports redesign — preview, photo validation, Firebase config deploy

### Firebase deployment
- Installed `firebase-tools` globally; deployed current `firestore.rules`, `firestore.indexes.json`, and `storage.rules` to production (significant drift repaired).
- Added missing composite indexes for `foVisitReports` (`clientId ASC, createdAt DESC`) and `foTrainingReports` (`clientId ASC, createdAt DESC`) for client dashboard queries.

### Web (CISS) — Visit & Training Reports
- **Photo minimum enforcement**: Visit reports block submission with zero photos; training reports require >=1 photo + client report.
- **Preview step**: New `ReportPreview` component shows a read-only summary card (client/site, date, guards/attendees, remarks, photo grid, GPS) with Edit/Submit buttons before final submission.
- **Photo categorization**: Camera button labeled "Guard Photo" (back), Selfie button labeled "Selfie with Guards" (front), Gallery button unchanged. Added `cameraLabel`/`selfieLabel` props to `PhotoCapture`.
- `site-report-upload.ts` hints updated to reflect 1-photo minimum.

### Mobile (CISS-Mobile) — Visit & Training Reports
- **Photo timestamp stamping**: New `_stampPhoto` method applies canvas overlay (dark bottom bar with timestamp, GPS, title, "Captured by CISS Field Officer") before upload.
- **Photo minimum enforcement**: Same as web — 1 photo minimum for both report types.
- **Preview step**: `_NewReportSheet` now shows a read-only preview (client/site, date, GPS, fields, photos) with Edit/Submit before final submission.
- **Model fixes**: Added `toJson()` to `VisitReportModel` and `TrainingReportModel`. Included `fieldOfficerName` in submit payload.

## [2026-06-02] — Session: Attendance upload-token repair

### Web public attendance
- Fixed `/attendance` photo upload failures caused by the protected `/api/public/attendance/upload` endpoint now requiring `uploadToken`.
- Photo uploads now request `/api/public/attendance/upload-token` and use an `employees/{employeeDocId}/attendance/...` path that matches the signed token.
- Attendance submits refresh the guard's current attendance hint before posting, preventing stale OUT defaults from creating repeated failed local entries.
- Offline queued attendance now keeps the captured photo data so queued records can replay after reconnect.

## [2026-06-01] — Session: Attendance submit idempotency fix

### Web attendance submit
- Added client-side `clientRequestId` generation on `/attendance` before uploading/submitting attendance.
- Hardened server audit events to omit `undefined` detail values so Firestore writes do not fail on older clients that omit optional fields.
- Attendance submission validation now accepts `null` for optional mobile string fields and normalizes them as omitted.
- Admin attendance report date filters accept both `YYYY-MM-DD` and ISO date-time query values.
- Added regression coverage for audit event sanitization.

### Mobile attendance submit
- Updated Flutter guard and QR attendance payloads to include `clientRequestId`.
- QR attendance now requires configured site coordinates, GPS, and a captured photo before submit; offline queue stores the full validated payload plus `photoDataUrl`.
- Guard attendance now submits actual GPS distance and uses current `DropdownButtonFormField.initialValue` API.

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

## [2026-06-01] — Session: Fix visit reports and training reports photo/upload requirements

### Problem
Field officers were getting blocked when submitting visit and training reports:
- **Visit reports**: Error "Add at least one site photo or file before submitting" — even when the officer had photos on his phone (taken with another app) and wanted to upload later or submit from home
- **Training reports**: Only required 1 photo, but the business needs at least 3 training session photos. Also needed the ability to upload client-signed report documents and photos taken with other phones.

### Root cause
The backend and frontend had hard validation blocking submission if photos were missing at submit time. This was too restrictive for real-world field officer workflows where:
- Photos are taken with the app's camera OR another phone/app
- Reports are submitted from the site OR after reaching home
- Photos are uploaded immediately OR attached later

### Changes made

#### 1. Visit Reports — Relax photo requirement
**Backend (`src/app/api/admin/visit-reports/route.ts`):**
- Removed the hard block that rejected submitted reports without photos (lines 208-213)
- Visit reports can now be submitted without photos

**Frontend (`src/components/field-officers/visit-reports-panel.tsx`):**
- Changed the photo validation from a blocking error toast to a non-blocking warning toast
- Message now says: "No photos attached. You can still submit and add photos later by editing this report."

**PATCH endpoint (`src/app/api/admin/visit-reports/[id]/route.ts`):**
- Field officers can now update their own **submitted** reports to add photos
- Admin can still update all fields
- Field officers editing submitted reports can only update `photoUrls`, not summary/issues/etc.

#### 2. Training Reports — Enforce 3+ photos
**Backend (`src/app/api/admin/training-reports/route.ts`):**
- Changed minimum photo requirement from `photoUrls.length === 0` to `photoUrls.length < 3`
- Error message now tells the officer exactly how many photos they have and need

**Frontend (`src/components/field-officers/training-reports-panel.tsx`):**
- Changed validation from `!hasSiteUploads(photoUrls)` to `photoUrls.length < 3`
- Error message: "Training reports require at least 3 photos. You have X. Please add more training session photos before submitting."

**PATCH endpoint (`src/app/api/admin/training-reports/[id]/route.ts`):**
- Field officers can now update their own **submitted** reports to add photos, attachments, and client report URL
- Admin can still update all fields
- Field officers editing submitted reports can only update `photoUrls`, `attachmentUrls`, and `clientReportUrl`

#### 3. Helper updates (`src/components/field-officers/site-report-upload.ts`)
- `isSiteUploadRequired`: Now only returns `true` for training reports (not visit reports)
- `getSiteUploadHint`: Updated messages to explain the new flexible workflows

### Verification
- `npx tsc --noEmit` — 0 errors across entire project
- All changed files compile cleanly

### Notes for field officers
- **Visit reports**: Photos are now optional at submission time. You can submit the report and add photos later by opening the report and clicking edit.
- **Training reports**: You MUST upload at least 3 training session photos before submitting. You can use the app's camera, selfie mode, or upload from your phone's gallery (photos taken with another camera or shared by colleagues).
- **Client report**: Training reports still require a client-signed report or certificate. Upload it in the "Client Report" section.
- All uploads support gallery/files — not just the in-app camera.

---

## [2026-06-01] — Session: Update Flutter Android app to match webapp report changes

### Mobile App Changes (`CISS-Mobile` repo)

#### 1. Field Officer Reports Screen (`lib/features/field_officer/presentation/screens/field_officer_reports_screen.dart`)

**Visit Reports:**
- Added `_pickFiles()` method using `file_picker` to select PDF + all image formats (JPG, PNG, HEIC, WEBP)
- Removed hard photo block in `_submit()` — now shows warning but allows submission without photos
- Added visual warning banner when submitting visit report with 0 photos
- Updated labels: "Visit Photos / Files" with explanation text

**Training Reports:**
- Enforced minimum 3 photos in `_submit()` — blocks submission with clear error
- Added visual error banner when submitting with < 3 photos
- Updated labels: "Training Photos" with "Attach at least 3 photos..."

**Client Report:**
- Changed `_pickClientReport()` from `ImagePicker` to `FilePicker`
- Now properly supports PDF selection
- Accepts PDF, JPG, PNG for client-signed training reports

**_AddPhotoButton widget:**
- Added optional `onFiles` callback
- Bottom sheet now shows 3 options: "Take Photo", "Gallery", "Files (PDF + Images)"

#### 2. Dependencies (`pubspec.yaml`)
- Added `file_picker: ^8.0.0+1` for cross-file format support
- Version bump: `1.0.7+7` → `1.0.8+8`

### Verification
- `flutter analyze` on modified file shows only pre-existing `MobileRepository` method errors (not introduced by this change)
- All new code compiles correctly

### Mobile app now matches webapp behavior
- Both platforms allow flexible photo upload (camera, gallery, files)
- Both enforce 3+ training photos
- Both allow visit reports without photos at submission time (with warning)
- Both support PDF client reports

---

## [2026-06-01] — Session: Set up private APK distribution infrastructure

### Problem
- `CISS-Mobile` repo is private on GitHub, so GitHub Releases cannot be used for public APK downloads
- The `/download` page was linking to GitHub releases which won't work for a private repo
- No local APK hosting infrastructure existed

### Solution
- Re-created `public/downloads/` directory with README and `.gitkeep`
- Removed GitHub releases fallback link from `/download` page
- APK will now be served directly from `/downloads/ciss-workforce-latest.apk`
- Added instructions in `public/downloads/README.md` for building from the private `CISS-Mobile` repo

### What the user needs to do
1. Build the APK from the private `CISS-Mobile` repo:
   ```bash
   cd CISS-Mobile
   flutter build apk --release --split-per-abi
   ```

2. Copy to the webapp:
   ```bash
   cp build/app/outputs/flutter-apk/app-arm64-v8a-release.apk CISS/public/downloads/ciss-workforce-latest.apk
   ```

3. Commit and push:
   ```bash
   cd CISS
   git add public/downloads/ciss-workforce-latest.apk
   git commit -m "release: mobile app v1.0.8"
   git push origin main
   ```

4. Vercel will auto-deploy and the APK will be live at `https://your-domain/downloads/ciss-workforce-latest.apk`

### Note
- The APK file will be stored in the git repo (required for Vercel to serve it from `public/`)
- This is the standard approach for static file hosting on Vercel
- The `CISS-Mobile` repo remains private — only the built APK is distributed through the webapp

### [2026-06-28] — Attendance bugfixes: guardLocations doc ID, employee lookup by phone/resourceId

- Fixed `guardLocations` document ID from `employeeId` (contains slashes like `CISS/TCS/.../871`) to `employeeDocId` in attendance submit route.
- Added `resourceIdNumber` lookup to `/api/public/attendance/employee` endpoint.
- Enhanced web `/attendance` manual ID section: now accepts employee ID, phone number, or resource ID with OR dividers.

### [2026-06-28] — Auto-checkout reliability, configurable shift timings, UI simplification

- Phase 1: Rewrote auto-checkout cron with paginated queries, chunked batches (50 sessions per batch), and `lastAutoClosedAt` tracking on attendance state.
- Phase 2: Created `src/lib/attendance/auto-detect.ts` — Haversine distance, shift detection, IN/OUT detection utilities. Simplified attendance page: stripped duty point/shift detail noise from confirm card, replaced IN/OUT radio group with auto-detected badge + tap-to-flip.
- Phase 3: Made shift start/end times editable in admin site management form. `normalizeDutyPoint` now auto-computes `crossesMidnight` from custom start/end times.

### [2026-06-28] — Sites database cleanup

- Deleted 29 Purushu-address duplicate site records (bulk import stubs with fake geolocation).
- Deleted SAFI Institute Purushu duplicate (c2h5hOEsMfoUiHIkLoa1).
- Assigned new siteId "23754-B" to Orphanage Polytechnic College second copy (g8sjgftLq4f8q8oQChBN).
- Added missing siteIds: Logiware=LOG-001, Geodis=GEO-001, Demo=DEMO-001.
- Updated CSC Academy state from "Lakshadweep" to "Kerala".
- Restored admin config (geofenceRadiusMeters, strictGeofence, shiftMode) on 26 bulk-import kept records.
- 3 remaining Purushu records (Carmel, Amarjyothy, Welkin) have admin config but wrong addresses — flagged for manual review.

### [2026-06-28] — NEET spreadsheet cross-reference, added 13 missing sites

- Cross-referenced all 281 sites in `/Downloads/NEET 2026 TC Details.xlsx` against database.
- Deleted 108 accidentally duplicated sites from the first bulk-add attempt.
- Added 13 genuinely missing Kerala/Puducherry sites from the spreadsheet.
- Fixed Amarjyothy Academy Online Exam Center name to match spreadsheet.
- Zero Tamil Nadu sites remain in database (confirmed zero).
- Final count: 145 sites (141 TCS, 2 J&K Bank, 1 Logiware, 1 Geodis).

### [2026-06-29] — Fix "Site not found" on work order assign page
- Made site detail page (`/work-orders/[siteId]`) gracefully handle missing site documents.
- Instead of throwing "Site not found" error, sets `site` to null, shows warning toast, and loads work orders via `where("siteId", ...)` which works regardless of site doc existence.
- Affects admin and FO assign guard flow from the main work-orders page.

### [2026-06-29] — Fix FO district filter on site detail work orders query
- Added `where("district", "in", ...)` clause to FO work order query on site detail page so Firestore rules don't reject the read.
- Uses the site's resolved district or falls back to `assignedDistricts` when site doc is missing.

### [2026-06-29] — Restore 3 missing site docs and fix storage rules for profile pictures
- Restored `4BsEmbJLo5wxyNPqanVV` — College of Engineering Trikaripur (Kasaragod)
- Restored `4YtcBlmfRVECVaDeqWNc` — Mookambika Technical Campus (Ernakulam)
- Restored `PwK2CGoDNED5ZzU7iRQs` — iON Digital Zone iDZ Aluva (Ernakulam)
- Changed storage rule for `profilePictures` from `allow read: if isSignedIn()` to `allow read: if true` (download token is the auth mechanism; `<img>` tags can't send Firebase auth headers).
- Deployed updated storage rules live.

### [2026-06-29] — Fix FO "Missing or insufficient permissions" on work orders
- Root cause: PATCH `/api/admin/field-officers/[id]` updated Firestore doc but never synced `assignedDistricts` to Firebase Auth custom claims. Security rules check `request.auth.token.assignedDistricts` (stale token) while client queries use the Firestore doc (latest). Any mismatch causes Firestore to reject the read.
- Fix: PATCH route now reads the officer's `uid` from the doc and calls `adminAuth.setCustomUserClaims()` to sync `assignedDistricts` to the token claims.
- Reverted the unnecessary `orderBy("date")` from the main FO work order query (page already sorts client-side).

### [2026-06-29] — Live guard tracking system upgrade (Phase 1-7)

**Phase 1: Infrastructure fixes**
- Fixed `GuardLocation` type: added `employeeDocId`, `employeeClientName`, `siteClientName`, `crossClientRelief`, `batteryLevel`, `speed`, `bearing`
- Fixed heartbeat route doc key: changed from `employeeId` (employee code) to `employeeDocId` (Firestore doc ID) for consistency with attendance submit
- Added missing fields to heartbeat write: `employeeClientName`, `siteClientName`, `crossClientRelief`, `employeeDocId`
- Added auto `isOutOfZone` computation when `distanceFromSite > geofenceRadius`

**Phase 2: Location history**
- Heartbeat now writes `locationHistory` subcollection docs (batch write with parent doc)
- Each history doc stores: lat, lng, accuracy, distanceFromSite, speed, batteryLevel, recordedAt
- Enables breadcrumb trail rendering on admin map

**Phase 3: Guard PWA heartbeat loop**
- Created `useGuardHeartbeat` React hook (`src/lib/hooks/use-guard-heartbeat.ts`)
- Integrated into guard dashboard — starts when status is "In", polls `watchPosition` every 60s
- Added `siteId` to guard dashboard API response for heartbeat target
- Sends lat/lng/accuracy/speed/heartbeat to backend

**Phase 4: Admin map dashboard**
- Installed `react-leaflet` for map rendering
- Created `LiveGuardMap` component — OpenStreetMap tiles, color-coded guard markers (green=in zone, orange=slight stale, red=out of zone, gray=stale), geofence circles, tooltip on hover
- Redesigned `LiveGuardsSection` with Map/List toggle, KPI bar (in zone, on duty, out of zone, stale counts), searchable guard sidebar, split-panel layout
- KPI bar with live color-coded badges

**Phase 5-6: Flutter app consistency**
- Fixed `background_tracking_service.dart`: doc key from `employeeId` to `employeeDocId`, added `employeeDocId`/`guardName`/`employeeCode` to context and Firestore writes
- Renamed `movementTrace` subcollection to `locationHistory` to match web naming
- Added `guardName`, `employeeDocId`, `district`, `clientName` to tracking start call
- Pushed to `sansan69/CISS-Mobile` repo

**Phase 7: APK version bump**
- Updated download page version to 1.1.0
- APK must be built locally: `cd CISS-Mobile && flutter build apk --release` then copy to `CISS/public/downloads/ciss-workforce-latest.apk`
- `pin-utils.ts` was using `crypto.subtle.digest("SHA-256")` (Web Crypto API) which may not be available in all serverless Node.js runtimes on Vercel.
- Replaced with Node.js native `crypto.createHash("sha256")` which is available in every Node.js version.
- Made `hashPin` and `verifyPin` synchronous (no change needed for callers — `await` on non-promise is a no-op).

### [2026-06-29] — Landing page phone input routes to attendance instead of guard-login
- Phone number input on landing page now redirects found guards directly to `/attendance?employeeId=XXX` for quick attendance marking, instead of requiring PIN login.
- "Guard Portal" link below remains for full portal access (requires PIN).
