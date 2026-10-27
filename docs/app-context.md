# CISS Workforce App Context

Last updated: 2026-10-26

This file is the current architecture and product-memory snapshot for the repo. Use it as the first reference before older planning docs such as `README.md`, `docs/blueprint.md`, or `docs/hrm-upgrade-todo.md`.

## Current identity

- Main product: `CISS Workforce`, a Next.js 15 App Router PWA for workforce operations.
- Frontend stack: React 18, TypeScript, Tailwind CSS, Radix/ShadCN-style UI primitives.
- Backend/runtime: Firebase client SDK on the frontend plus Firebase Admin in Next.js API routes.
- Deployment assumption: standard Next.js runtime on Node `22.x`.

## Runtime modes

- `src/lib/runtime-config.ts` supports two modes:
  - `regional` (default)
  - `control-plane`
- Region-specific behavior is driven by:
  - `APP_MODE`
  - `REGION_CODE`
  - `REGION_NAME`
  - `GUARD_AUTH_EMAIL_DOMAIN`
- The repo now supports both a normal regional deployment and a super-admin control-plane flow for multi-region onboarding and overview reporting.
- Regional records with missing state metadata fall back to the deployment's `REGION_CODE`. State-code rules remain legacy-compatible. The architecture assumes a separate Firebase project per region; shared-database tenancy and cross-region isolation in a single project are unverified.
- **Selected multi-state model (2026-10-26):** every Indian state gets its own Firebase project under its own Google account, with its own regional deployment. Isolation is the project/account boundary; `stateCode` checks in rules and queries are defence-in-depth, not the tenant boundary. Consequences:
  - Each regional deployment is authoritative for its own region. `public/regions` advertises the deployment's own region (it no longer injects Kerala), and `public/region-config/[code]` serves the own region from env and only foreign regions from this project's registry.
  - Each region's Admin SDK credentials are a service account from that project's Google account. The control plane stores it AES-GCM-encrypted in `regionConnections` (requires `REGION_CONNECTIONS_SECRET` in production) and deploys it as `FIREBASE_ADMIN_SDK_CONFIG_BASE64`; use least-privilege roles, not Owner.
  - The mobile app picks a region at first launch, initialises Firebase from that region's config and keeps caches region-keyed. It must never mix two projects in one session.
  - Cross-state reporting is an explicit aggregation/export path, not an implicit shared database. Do not consolidate regions into one project without a separate rules and data-isolation design.

## Roles and auth model

- App roles: `admin`, `superAdmin`, `fieldOfficer`, `client`, `guard`, and fallback `user`.
- Firebase custom claims are the primary source of truth for role resolution.
- `src/lib/auth/roles.ts` also falls back to Firestore lookups:
  - `fieldOfficers` for district-scoped field officers
  - `clientUsersByUid` for client users
- Auth context is provided through `src/context/auth-context.tsx`.
- Admin shell: `src/app/(app)/layout.tsx`
- Guard shell: `src/app/(guard)/layout.tsx`
- Guard reset flow is now hardened:
  - `send-reset-otp` rate-limits to 3 requests per phone per 10 minutes
  - OTP requests only proceed for existing guard-enabled employees
  - OTP verification has its own endpoint: `src/app/api/guard/auth/verify-reset-otp/route.ts`
  - PIN reset hashes the new PIN and writes it back to the employee record (`guardPin`) while clearing lockout counters

## Route surface

### Public and login routes

- `/`
- `/enroll`
- `/attendance`
- `/profile/[id]`
- `/admin-login`
- `/guard-login`
- `/guard-login/setup`
- `/guard-login/reset`
- `/guard-forgot-pin`

### Authenticated admin app routes

Core modules now extend well beyond the original employee-directory MVP:

- `/dashboard`
- `/employees`
- `/employees/[id]`
- `/employees/enroll`
- `/attendance-logs`
- `/work-orders`
- `/work-orders/[siteId]`
- `/work-orders/assigned-guards-export`
- `/field-officers`
- `/training`
- `/training/assignments`
- `/evaluations`
- `/leaderboard`
- `/visit-reports`
- `/training-reports`
- `/settings`
- `/settings/clients`
- `/settings/clients/[clientId]`
- `/settings/clients/[clientId]/geocode-coordinates`
- `/settings/bulk-import`
- `/settings/data-export`
- `/settings/qr-management`
- `/settings/reports`
- `/settings/admin-tools`
- `/settings/state-management`

### Authenticated guard portal routes

- `/guard/dashboard`
- `/guard/profile`
- `/guard/attendance`
- `/guard/training`
- `/guard/evaluations`

### Retired payroll, leave, and compliance workflows

- Admin and guard operational leave pages, payroll runs/cycles, payslip pages, wage-configuration pages, and compliance-workflow surfaces are retired and removed from active navigation.
- Legacy API endpoints for payroll, leave, payslips, wage configuration, and compliance settings remain as stateless tombstones that return HTTP 410.
- Firestore client rules deny reads and writes for the retired collections, including `payrollEntries`, `payrollCycles`, `clientWageConfig`, `salaryStructures`, `employeeSalaries`, `complianceSettings`, `leaveRequests`, and `leaveBalances`.
- Historical payroll, leave, wage, and compliance records are retained; retirement does not delete historical data.
- Employee `OnLeave` status, EPF/UAN and ESIC identifiers, bank fields, and statutory-rights language remain in employment records and terms. Retiring an operational leave workflow does not remove legal leave entitlements or other statutory labor rights.

## Important route migrations

Several older settings pages are now compatibility redirects:

- `/settings/client-management` -> `/settings/clients`
- `/settings/client-locations` -> `/settings/clients`
- `/settings/assigned-guards-export` -> `/work-orders/assigned-guards-export`

The active source of truth for client, office, site, and client-user management is the new `settings/clients` surface.

## Major product areas

### Workforce core

- Employee enrollment, directory, and detailed profile pages are live.
- Attendance capture exists for both public capture and guard/mobile flows.
- Attendance identity model (2026-10-26):
  - **Self** — a signed-in guard submits their own attendance; no external proof.
  - **Assisted** — a signed-in guard marks a colleague who has no phone, using the colleague's signed QR badge, employee ID + phone, phone, or (TCS employees only) resource ID. The server binds a single-use proof to the actor and subject, records `assistedSubmission`, `markedByUid`, `markedByEmployeeDocId` and `attendanceMethod` on the attendance log, and keeps the normal photo/geofence checks.
  - **Kiosk** — a signed-out shared device may only use a signed QR badge; employee ID, phone and resource ID require a signed-in guard. Proofs are single-use (`attendanceVerificationProofs`, server-only, `expireAt` for a Firestore TTL policy).
- Admin attendance logs now expose richer detail:
  - employee phone number
  - shift metadata
  - captured photo
  - geofence distance
  - GPS accuracy
  - mock-location flags
  - device user agent

### Work orders and staffing

- Work orders are stored in Firestore and grouped by site in the admin UI.
- Assigned guard export now lives with work orders rather than settings.
- Field officers have district-scoped access to relevant work-order and reporting surfaces.

### Client, office, and site management

- Clients, client offices (`clientLocations`), and duty sites (`sites`) are now managed from a single client dashboard.
- The new client dashboard supports:
  - client metadata updates
  - office CRUD
  - site CRUD
  - client-user linking and creation
  - geocode repair for sites missing or holding bad coordinates

### Training, evaluation, and rankings

- Training, assignments, evaluations, and leaderboard routes are present.
- Training/evaluation is no longer a purely planned feature; it is part of the active app surface.

### Field operations

- Visit reports and training reports are part of the authenticated app through the unified `Field Officers` workspace.

### Super-admin and region control plane

- `superAdmin` is now a real role.
- `/settings/state-management` is the onboarding UI for region setup.
- `/api/super-admin/regions` manages region metadata.
- `/api/super-admin/overview` aggregates live metrics across regions.
- Cross-region credentials are stored encrypted through `src/lib/server/region-connections.ts`.

## Key technical implementation notes

### Firebase client

- `src/lib/firebase.ts` is the single frontend Firebase app initializer.
- Firestore uses IndexedDB-backed persistent local cache with multi-tab support in the browser.
- Auth persistence is pre-warmed on module load.

### Firebase admin

- `src/lib/firebaseAdmin.ts` supports:
  - `FIREBASE_ADMIN_SDK_CONFIG_BASE64`
  - `FIREBASE_ADMIN_SDK_CONFIG`
  - split admin env vars
  - application default credentials fallback

### Notifications

- `src/lib/fcm.ts` now reuses the existing Firebase app instead of attempting to initialize a second app for messaging.
- Web FCM tokens are stored in `fcmTokens`.

### Geocoding

- Server geocoding lives in `src/lib/server/location-geocode.ts`.
- Geocode lookup now accepts `state` in addition to `address` and `district`.
- `/api/admin/sites/batch-geocode` can:
  - scope to a `clientId`
  - target explicit `siteIds`
  - reprocess invalid coordinates outside an India bounding box
  - optionally re-geocode already geocoded sites

### Region overview plumbing

- Super-admin overview builds transient Firebase Admin apps for remote regions using stored service-account payloads.
- Region connection payloads are encrypted with AES-256-GCM using a key derived from `REGION_CONNECTIONS_SECRET` (or the admin secret fallback).

## Collections and domain entities

The app now works across a broader set of Firestore entities than the original docs describe. The most important current entities include:

- `employees`
- `attendanceLogs`
- `clients`
- `clientLocations`
- `sites`
- `workOrders`
- `fieldOfficers`
- `clientUsers`
- `clientUsersByUid`
- `trainingModules`
- `trainingAssignments`
- `evaluations`
- `trainingReports`
- `visitReports`
- `regions`
- `regionConnections`
- `fcmTokens`

Retired workflow collections remain in Firestore as historical records and are server-only under client rules: `payrollEntries`, `payrollCycles`, `clientWageConfig`, `salaryStructures`, `employeeSalaries`, `complianceSettings`, `leaveRequests`, and `leaveBalances`. Their presence does not indicate an active product workflow.

## Practical guidance for future work

- Start app-context reading here first, then inspect the relevant route or API namespace.
- Prefer the `settings/clients` area over the deprecated client-management and client-locations pages.
- Treat the super-admin and regional runtime work as active architecture, not future design.
