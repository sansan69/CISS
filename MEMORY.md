# MEMORY.md — CISS Workforce Codebase Changelog

This file is the authoritative log of all changes made to the codebase.
**Read this before implementing anything.** Update it after every change.

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
