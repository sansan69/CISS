# CISS Workforce Full App Architecture Map

Last mapped: 2026-04-29

This document is a code-grounded architecture map of the current application state in `/Users/mymac/Documents/CISS`.
It complements, and is newer than, [docs/app-context.md](/Users/mymac/Documents/CISS/docs/app-context.md).

## 1. Product Identity

- Product: `CISS Workforce`
- Stack:
  - Next.js 15 App Router
  - React 18
  - TypeScript
  - Tailwind CSS
  - Radix/ShadCN-style UI primitives
  - Firebase client SDK
  - Firebase Admin inside Next.js API routes
- Deployment target:
  - Node `22.x`
  - Vercel-style Next.js deployment
  - PWA / mobile-first webapp

## 2. Runtime Topology

Primary runtime config lives in [src/lib/runtime-config.ts](/Users/mymac/Documents/CISS/src/lib/runtime-config.ts).

Two runtime modes exist:

- `regional`
  - default mode
  - current Kerala app behavior
- `control-plane`
  - HQ/super-admin mode for multi-region onboarding and overview

Key environment-driven runtime identity:

- `APP_MODE`
- `REGION_CODE`
- `REGION_NAME`
- `GUARD_AUTH_EMAIL_DOMAIN`
- `ROOT_DOMAIN`
- `NEXT_PUBLIC_ROOT_DOMAIN`

## 3. High-Level App Surfaces

The app is not one surface. It is four connected surfaces:

1. Public operational surface
2. Authenticated admin / field officer / client shell
3. Authenticated guard portal
4. Super-admin control-plane APIs and onboarding tools

### 3.1 Public surface

Main public pages:

- `/`
- `/enroll`
- `/attendance`
- `/profile/[id]`
- `/admin-login`
- `/guard-login`
- `/guard-login/setup`
- `/guard-login/reset`
- `/guard-forgot-pin`

Purpose:

- self-enrollment
- public attendance capture
- public employee profile / QR-linked profile viewing
- admin and guard authentication entry
- client portal subdomain entry

### 3.2 Admin / field officer / client shell

Main authenticated app shell:

- layout: [src/app/(app)/layout.tsx](/Users/mymac/Documents/CISS/src/app/(app)/layout.tsx)
- nav definition: [src/app/(app)/navigation.ts](/Users/mymac/Documents/CISS/src/app/(app)/navigation.ts)

This shell is shared, but the visible modules change by role:

- `admin`
- `fieldOfficer`
- `client`
- `superAdmin`

Core app routes include:

- `/dashboard`
- `/employees`
- `/employees/[id]`
- `/attendance-logs`
- `/work-orders`
- `/field-officers`
- `/training`
- `/training/assignments`
- `/evaluations`
- `/leaderboard`
- `/payroll`
- `/leave`
- `/visit-reports`
- `/training-reports`
- `/settings/*`

### 3.3 Guard portal

Guard shell:

- layout: [src/app/(guard)/layout.tsx](/Users/mymac/Documents/CISS/src/app/(guard)/layout.tsx)

Guard routes:

- `/guard/dashboard`
- `/guard/profile`
- `/guard/attendance`
- `/guard/payslips`
- `/guard/training`
- `/guard/training/quiz/[assignmentId]`
- `/guard/evaluations`
- `/guard/leave`

Purpose:

- PIN-based guard login
- attendance review / attendance quick actions
- training consumption and quiz answering
- leave requests
- payslip viewing
- personal profile access

### 3.4 Super-admin control-plane

Present through:

- `/settings/state-management`
- `/api/super-admin/*`

Purpose:

- region onboarding
- remote region credential management
- consolidated multi-region overview

## 4. Role and Auth Model

Client-side role resolution:

- [src/lib/auth/roles.ts](/Users/mymac/Documents/CISS/src/lib/auth/roles.ts)

Server-side auth checks:

- [src/lib/server/auth.ts](/Users/mymac/Documents/CISS/src/lib/server/auth.ts)

Shared auth context:

- [src/context/auth-context.tsx](/Users/mymac/Documents/CISS/src/context/auth-context.tsx)

### 4.1 Roles

Supported roles:

- `admin`
- `superAdmin`
- `fieldOfficer`
- `client`
- `guard`
- fallback `user`

### 4.2 Primary identity source

Primary source of role truth:

- Firebase Auth custom claims

Examples of active claim usage:

- `role`
- `admin`
- `stateCode`
- `assignedDistricts`
- `clientId`
- `clientName`
- `employeeId`
- `employeeDocId`

### 4.3 Firestore fallback mapping

Role resolution also falls back to Firestore:

- `fieldOfficers`
- `clientUsersByUid`

This means the app currently uses a hybrid identity model:

- Firebase claims for authorization
- Firestore role-linked metadata for scoping and display

### 4.4 Client portal host-based context

Client portal host parsing:

- [src/lib/client-portal.ts](/Users/mymac/Documents/CISS/src/lib/client-portal.ts)

Important behavior:

- `cisskerala.site` is the root app
- `*.cisskerala.site` can act as client portal hostnames
- examples:
  - `tcs.cisskerala.site`
  - `logiware.cisskerala.site`
  - `lng.cisskerala.site`

The subdomain is a portal routing hint, not the only source of access control.
Actual access still depends on the Firebase-authenticated client user and `clientUsersByUid` linkage.

## 5. Primary Firestore Domain Model

Current key collections visible in code:

- `employees`
- `attendanceLogs`
- `attendanceState`
- `clients`
- `clientLocations`
- `sites`
- `workOrders`
- `workOrderImports`
- `fieldOfficers`
- `clientUsers`
- `clientUsersByUid`
- `foVisitReports`
- `foTrainingReports`
- `trainingModules`
- `trainingAssignments`
- `evaluations`
- `payrollCycles`
- `payrollEntries`
- `leaveRequests`
- `regions`
- `regionConnections`
- `fcmTokens`
- `rateLimits`

The app is now organized around these domain groups:

1. Workforce identity
2. Attendance operations
3. Client / office / site topology
4. TCS work-order operations
5. Training and evaluations
6. Payroll and wage configuration
7. Field officer reporting
8. Region control-plane

## 6. Module Map

## 6.1 Enrollment and Employee Lifecycle

Main routes:

- public self-enrollment page: [src/app/enroll/page.tsx](/Users/mymac/Documents/CISS/src/app/enroll/page.tsx)
- admin enrollment shortcut: [src/app/(app)/employees/enroll/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/employees/enroll/page.tsx)
- employee detail: [src/app/(app)/employees/[id]/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/employees/[id]/page.tsx)
- public profile page: [src/app/profile/[id]/page.tsx](/Users/mymac/Documents/CISS/src/app/profile/[id]/page.tsx)

Main APIs:

- enroll submit: [src/app/api/employees/enroll/route.ts](/Users/mymac/Documents/CISS/src/app/api/employees/enroll/route.ts)
- employee lookup: [src/app/api/employees/lookup/route.ts](/Users/mymac/Documents/CISS/src/app/api/employees/lookup/route.ts)
- public profile API: [src/app/api/employees/public-profile/[id]/route.ts](/Users/mymac/Documents/CISS/src/app/api/employees/public-profile/[id]/route.ts)
- public enrollment upload: [src/app/api/public/enroll/upload/route.ts](/Users/mymac/Documents/CISS/src/app/api/public/enroll/upload/route.ts)

Supporting libraries:

- employee ID generation: [src/lib/employee-id.ts](/Users/mymac/Documents/CISS/src/lib/employee-id.ts)
- QR generation: [src/lib/qr.ts](/Users/mymac/Documents/CISS/src/lib/qr.ts)
- enrollment file helpers: [src/lib/enrollmentFiles.ts](/Users/mymac/Documents/CISS/src/lib/enrollmentFiles.ts)
- enrollment typing: [src/types/enrollment.ts](/Users/mymac/Documents/CISS/src/types/enrollment.ts)
- employee typing: [src/types/employee.ts](/Users/mymac/Documents/CISS/src/types/employee.ts)

Important current behavior:

- public self-enrollment is active
- duplicate phone and email checks are enforced
- QR data is generated on enrollment
- LNG Petronet has special enrollment behavior
  - `legacyUniqueId`
  - fallback auth email generation
  - client-specific fields

Architectural note:

- Enrollment, admin employee profile, and public profile all share the same underlying employee dossier model.
- PDF/profile export logic is duplicated across multiple pages and is a clear future extraction target.

## 6.2 Attendance System

Main pages:

- public attendance page: [src/app/attendance/page.tsx](/Users/mymac/Documents/CISS/src/app/attendance/page.tsx)
- admin attendance logs: [src/app/(app)/attendance-logs/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/attendance-logs/page.tsx)
- guard attendance page: [src/app/(guard)/guard/attendance/page.tsx](/Users/mymac/Documents/CISS/src/app/(guard)/guard/attendance/page.tsx)

Main APIs:

- attendance submit: [src/app/api/attendance/submit/route.ts](/Users/mymac/Documents/CISS/src/app/api/attendance/submit/route.ts)
- public attendance site list: [src/app/api/public/attendance/route.ts](/Users/mymac/Documents/CISS/src/app/api/public/attendance/route.ts)
- public attendance employee lookup: [src/app/api/public/attendance/employee/route.ts](/Users/mymac/Documents/CISS/src/app/api/public/attendance/employee/route.ts)
- public attendance upload: [src/app/api/public/attendance/upload/route.ts](/Users/mymac/Documents/CISS/src/app/api/public/attendance/upload/route.ts)
- guard attendance history: [src/app/api/guard/attendance/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/attendance/route.ts)
- attendance photo analysis: [src/app/api/attendance/analyze-photo/route.ts](/Users/mymac/Documents/CISS/src/app/api/attendance/analyze-photo/route.ts)

Supporting libraries:

- public attendance normalization: [src/lib/attendance/public-attendance.ts](/Users/mymac/Documents/CISS/src/lib/attendance/public-attendance.ts)
- offline queue support: [src/lib/attendance-offline.ts](/Users/mymac/Documents/CISS/src/lib/attendance-offline.ts)
- geolocation math: [src/lib/geo.ts](/Users/mymac/Documents/CISS/src/lib/geo.ts)
- shift and duty point logic: [src/lib/shift-utils.ts](/Users/mymac/Documents/CISS/src/lib/shift-utils.ts)
- attendance typing: [src/types/attendance.ts](/Users/mymac/Documents/CISS/src/types/attendance.ts)
- location typing: [src/types/location.ts](/Users/mymac/Documents/CISS/src/types/location.ts)

Current business model:

- attendance is geofence-aware
- attendance stores photo and metadata
- non-TCS clients can use:
  - site
  - duty point
  - shift selection
- shift selection is validated against configured site / duty-point shift templates
- previous attendance state is tracked in `attendanceState`
- TCS attendance can depend on active work-order assignment
- non-TCS attendance does not depend on TCS work-order rules

Important current architectural split:

- `sites` are true duty sites
- `clientLocations` can also act as public attendance locations in some flows
- TCS and non-TCS rules diverge inside submission logic

## 6.3 Site, Client, and Duty-Point Topology

Main settings pages:

- clients list: [src/app/(app)/settings/clients/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/settings/clients/page.tsx)
- client detail: [src/app/(app)/settings/clients/[clientId]/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/settings/clients/[clientId]/page.tsx)
- site management: [src/app/(app)/settings/site-management/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/settings/site-management/page.tsx)
- geocode repair: [src/app/(app)/settings/clients/[clientId]/geocode-coordinates/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/settings/clients/[clientId]/geocode-coordinates/page.tsx)

Main APIs:

- clients CRUD: [src/app/api/admin/clients/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/clients/route.ts), [src/app/api/admin/clients/[id]/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/clients/[id]/route.ts)
- batch geocode: [src/app/api/admin/sites/batch-geocode/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/sites/batch-geocode/route.ts)
- unverified sites: [src/app/api/admin/sites/unverified/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/sites/unverified/route.ts)
- verify site coordinates: [src/app/api/admin/sites/[id]/verify-coordinates/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/sites/[id]/verify-coordinates/route.ts)

Supporting libraries:

- site typing: [src/types/location.ts](/Users/mymac/Documents/CISS/src/types/location.ts)
- duty-point/shift derivation: [src/lib/shift-utils.ts](/Users/mymac/Documents/CISS/src/lib/shift-utils.ts)
- site directory helpers: [src/lib/sites/site-directory.ts](/Users/mymac/Documents/CISS/src/lib/sites/site-directory.ts)
- location identity helpers: [src/lib/location-utils.ts](/Users/mymac/Documents/CISS/src/lib/location-utils.ts)
- geocode utilities: [src/lib/site-gps-repair.ts](/Users/mymac/Documents/CISS/src/lib/site-gps-repair.ts), [src/lib/geocode-report.ts](/Users/mymac/Documents/CISS/src/lib/geocode-report.ts)

Current business model:

- one client can own many sites
- one site can contain many duty points
- each duty point can define:
  - coverage mode
  - duty hours
  - shift mode
  - shift templates
  - geofence override

This is now the core non-TCS attendance topology.

## 6.4 TCS Work Orders and Staffing

Main pages:

- board: [src/app/(app)/work-orders/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/work-orders/page.tsx)
- site detail: [src/app/(app)/work-orders/[siteId]/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/work-orders/[siteId]/page.tsx)
- imports page: [src/app/(app)/work-orders/imports/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/work-orders/imports/page.tsx)
- assigned guards export: [src/app/(app)/work-orders/assigned-guards-export/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/work-orders/assigned-guards-export/page.tsx)

Main APIs:

- work-order CRUD/update: [src/app/api/admin/work-orders/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/route.ts), [src/app/api/admin/work-orders/[id]/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/[id]/route.ts)
- import preview: [src/app/api/admin/work-orders/import/preview/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/import/preview/route.ts)
- import commit: [src/app/api/admin/work-orders/import/commit/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/import/commit/route.ts)
- rename exam: [src/app/api/admin/work-orders/rename-exam/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/rename-exam/route.ts)
- bulk delete: [src/app/api/admin/work-orders/bulk-delete/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/bulk-delete/route.ts)
- backfill exam names: [src/app/api/admin/work-orders/backfill-exam-names/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/backfill-exam-names/route.ts)
- todos: [src/app/api/admin/work-orders/todos/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/work-orders/todos/route.ts)

Supporting libraries:

- TCS parser: [src/lib/work-orders/tcs-exam-parser.ts](/Users/mymac/Documents/CISS/src/lib/work-orders/tcs-exam-parser.ts)
- hash logic: [src/lib/work-orders/tcs-exam-hash.ts](/Users/mymac/Documents/CISS/src/lib/work-orders/tcs-exam-hash.ts)
- diff engine: [src/lib/work-orders/tcs-exam-diff.ts](/Users/mymac/Documents/CISS/src/lib/work-orders/tcs-exam-diff.ts)
- assignment matching: [src/lib/work-orders/assignment-match.ts](/Users/mymac/Documents/CISS/src/lib/work-orders/assignment-match.ts)
- work-order gate helpers: [src/lib/work-orders.ts](/Users/mymac/Documents/CISS/src/lib/work-orders.ts)
- work-order types: [src/types/work-orders.ts](/Users/mymac/Documents/CISS/src/types/work-orders.ts)

Current architectural truth:

- Work orders are currently TCS-only.
- Identity model for imported exam rows is:
  - `site + date + examCode`
- Import pipeline stages:
  1. parse workbook
  2. normalize exam rows
  3. hash workbook/content
  4. fetch comparable existing TCS rows
  5. build diff
  6. detect duplicate / overlap state
  7. resolve site matching and create missing TCS sites
  8. commit per-exam records
  9. write import history / audit

UI behavior differs from storage:

- storage keeps per-exam rows separate
- board can merge same center + same date totals in display
- exam names are still shown together in the merged display

Important mapped internal cores:

- `buildTcsExamDiff()` is the add/update/unchanged/cancel decision engine
- `resolveCommitRows()` + `fetchSites()` are the TCS site-resolution engine
- `fetchExistingRows()` + identity matching helpers are the duplicate/revision engine

## 6.5 Guard Authentication and Portal

Main entry pages:

- [src/app/guard-login/page.tsx](/Users/mymac/Documents/CISS/src/app/guard-login/page.tsx)
- [src/app/guard-login/setup/page.tsx](/Users/mymac/Documents/CISS/src/app/guard-login/setup/page.tsx)
- [src/app/guard-login/reset/page.tsx](/Users/mymac/Documents/CISS/src/app/guard-login/reset/page.tsx)
- [src/app/guard-forgot-pin/page.tsx](/Users/mymac/Documents/CISS/src/app/guard-forgot-pin/page.tsx)

Main APIs:

- login: [src/app/api/guard/auth/login/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/auth/login/route.ts)
- PIN setup: [src/app/api/guard/auth/setup-pin/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/auth/setup-pin/route.ts)
- PIN status: [src/app/api/guard/auth/pin-status/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/auth/pin-status/route.ts)
- change PIN: [src/app/api/guard/auth/change-pin/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/auth/change-pin/route.ts)
- send reset OTP: [src/app/api/guard/auth/send-reset-otp/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/auth/send-reset-otp/route.ts)
- verify reset OTP: [src/app/api/guard/auth/verify-reset-otp/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/auth/verify-reset-otp/route.ts)
- reset PIN: [src/app/api/guard/auth/reset-pin/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/auth/reset-pin/route.ts)

Supporting libraries:

- PIN hashing/verify: [src/lib/guard/pin-utils.ts](/Users/mymac/Documents/CISS/src/lib/guard/pin-utils.ts)
- OTP helpers: [src/lib/guard/otp-utils.ts](/Users/mymac/Documents/CISS/src/lib/guard/otp-utils.ts)
- guard identity utils: [src/lib/guard/identity-utils.ts](/Users/mymac/Documents/CISS/src/lib/guard/identity-utils.ts)
- server guard auth helpers: [src/lib/server/guard-auth.ts](/Users/mymac/Documents/CISS/src/lib/server/guard-auth.ts)

Current auth model:

- guard signs in with phone number or employee ID plus PIN
- app verifies PIN against employee record
- server creates Firebase custom token with:
  - `role: "guard"`
  - `employeeId`
  - `employeeDocId`
- local dev has special fallback behavior for custom-token acceptance
- failed attempts are rate-limited and lockouts are tracked on employee record

## 6.6 Client Dashboard and Portal Access

Main client dashboard page:

- route entry uses shared app shell at `/dashboard`
- data API: [src/app/api/client/dashboard/route.ts](/Users/mymac/Documents/CISS/src/app/api/client/dashboard/route.ts)
- UI: [src/components/dashboard/client-operations-dashboard.tsx](/Users/mymac/Documents/CISS/src/components/dashboard/client-operations-dashboard.tsx)

Main support pages visible to clients:

- `/employees`
- `/attendance-logs`
- `/visit-reports`
- `/training-reports`
- `/work-orders` for TCS operational client only

Supporting pieces:

- client scope resolver: [src/lib/server/client-access.ts](/Users/mymac/Documents/CISS/src/lib/server/client-access.ts)
- client permissions types: [src/types/client-permissions.ts](/Users/mymac/Documents/CISS/src/types/client-permissions.ts)
- dashboard payload types: [src/types/client-dashboard.ts](/Users/mymac/Documents/CISS/src/types/client-dashboard.ts)
- client portal utilities: [src/lib/client-portal.ts](/Users/mymac/Documents/CISS/src/lib/client-portal.ts)

Current behavior:

- client access is read-only / scoped by `clientId` and `clientName`
- client dashboard modules can be toggled from client config
- work orders are visible only for operational TCS client portal users
- client users are managed separately from clients

Client user provisioning:

- client users API: [src/app/api/admin/client-users/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/client-users/route.ts)
- mapping collections:
  - `clientUsers`
  - `clientUsersByUid`

Important identity detail:

- client login IDs are transformed into synthetic auth emails for Firebase Auth account creation
- portal host and authenticated client mapping both matter

## 6.7 Field Officer Reporting

Main pages:

- `/field-officers`
- `/visit-reports`
- `/training-reports`

Main APIs:

- field officers CRUD: [src/app/api/admin/field-officers/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/field-officers/route.ts)
- visit reports: [src/app/api/admin/visit-reports/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/visit-reports/route.ts)
- training reports: [src/app/api/admin/training-reports/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/training-reports/route.ts)

Components:

- [src/components/field-officers/visit-reports-panel.tsx](/Users/mymac/Documents/CISS/src/components/field-officers/visit-reports-panel.tsx)
- [src/components/field-officers/training-reports-panel.tsx](/Users/mymac/Documents/CISS/src/components/field-officers/training-reports-panel.tsx)
- [src/components/field-officers/work-orders-panel.tsx](/Users/mymac/Documents/CISS/src/components/field-officers/work-orders-panel.tsx)

Mapped architecture note:

- visit and training report APIs share a very similar route skeleton
- repeated helpers include:
  - field officer profile resolution
  - site snapshot resolution
  - client scope filtering
  - district filtering
  - Firestore timestamp serialization

This is a real reuse/refactor opportunity.

## 6.8 Training, Quiz, Evaluation, Leaderboard

Main pages:

- `/training`
- `/training/assignments`
- `/training/banks`
- `/training/banks/[id]`
- `/evaluations`
- `/evaluations/[id]`
- `/leaderboard`

Guard pages:

- `/guard/training`
- `/guard/training/quiz/[assignmentId]`
- `/guard/evaluations`

Main APIs:

- training modules CRUD: [src/app/api/admin/training/modules/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/training/modules/route.ts)
- question banks CRUD: [src/app/api/admin/training/banks/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/training/banks/route.ts)
- assignment APIs: [src/app/api/admin/training/assignments/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/training/assignments/route.ts)
- guard training feed: [src/app/api/guard/training/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/training/route.ts)
- guard quiz fetch/submit:
  - [src/app/api/guard/training/quiz/[assignmentId]/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/training/quiz/[assignmentId]/route.ts)
  - [src/app/api/guard/training/quiz/[assignmentId]/submit/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/training/quiz/[assignmentId]/submit/route.ts)
- evaluations:
  - [src/app/api/admin/evaluations/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/evaluations/route.ts)
  - [src/app/api/guard/evaluations/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/evaluations/route.ts)
- leaderboard: [src/app/api/admin/leaderboard/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/leaderboard/route.ts)

Current model:

- admin uploads module content
- assignments link content to guards
- quizzes support evaluation
- reports surface field-officer-led training submissions separately from content delivery

## 6.9 Payroll and Wage Configuration

Main pages:

- `/payroll`
- `/payroll/run`
- `/payroll/cycles/[id]`
- `/payroll/cycles/[id]/entries/[entryId]`
- `/settings/wage-config`

Guard pages:

- `/guard/payslips`

Main APIs:

- payroll run: [src/app/api/admin/payroll/run/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/run/route.ts)
- cycles:
  - [src/app/api/admin/payroll/cycles/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/cycles/route.ts)
  - [src/app/api/admin/payroll/cycles/[id]/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/cycles/[id]/route.ts)
  - [src/app/api/admin/payroll/cycles/[id]/worksheet/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/cycles/[id]/worksheet/route.ts)
  - [src/app/api/admin/payroll/cycles/[id]/finalize/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/cycles/[id]/finalize/route.ts)
  - [src/app/api/admin/payroll/cycles/[id]/payslips/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/cycles/[id]/payslips/route.ts)
- entry detail:
  - [src/app/api/admin/payroll/entries/[id]/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/entries/[id]/route.ts)
  - [src/app/api/admin/payroll/entries/[id]/payslip/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/entries/[id]/payslip/route.ts)
- validation: [src/app/api/admin/payroll/validate/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/payroll/validate/route.ts)
- client wage config APIs:
  - [src/app/api/admin/clients/[id]/wage-config/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/clients/[id]/wage-config/route.ts)
  - [src/app/api/admin/clients/[id]/wage-config/upload/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/clients/[id]/wage-config/upload/route.ts)
- guard payslip APIs:
  - [src/app/api/guard/payslips/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/payslips/route.ts)
  - [src/app/api/guard/payslips/[id]/payslip/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/payslips/[id]/payslip/route.ts)

Supporting libraries:

- payroll calculations: [src/lib/payroll/calculate.ts](/Users/mymac/Documents/CISS/src/lib/payroll/calculate.ts)
- attendance aggregation: [src/lib/payroll/attendance-aggregator.ts](/Users/mymac/Documents/CISS/src/lib/payroll/attendance-aggregator.ts)
- leave aggregation: [src/lib/payroll/leave-aggregator.ts](/Users/mymac/Documents/CISS/src/lib/payroll/leave-aggregator.ts)
- payslip generation: [src/lib/payroll/payslip.ts](/Users/mymac/Documents/CISS/src/lib/payroll/payslip.ts)
- wage template parser: [src/lib/payroll/wage-template-parser.ts](/Users/mymac/Documents/CISS/src/lib/payroll/wage-template-parser.ts)
- wage template evaluator: [src/lib/payroll/wage-template-evaluator.ts](/Users/mymac/Documents/CISS/src/lib/payroll/wage-template-evaluator.ts)
- payroll typing: [src/types/payroll.ts](/Users/mymac/Documents/CISS/src/types/payroll.ts)

Current model:

- supports structured wage components
- supports parser-driven client-specific wage templates
- wage config can derive rules/constants from uploaded wage sheet headings/formulas
- payroll uses attendance and leave aggregation plus template evaluation

## 6.10 Leave Management

Main pages:

- admin leave page: [src/app/(app)/leave/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/leave/page.tsx)
- guard leave page: [src/app/(guard)/guard/leave/page.tsx](/Users/mymac/Documents/CISS/src/app/(guard)/guard/leave/page.tsx)

Main APIs:

- guard leave: [src/app/api/guard/leave/route.ts](/Users/mymac/Documents/CISS/src/app/api/guard/leave/route.ts)
- admin leave review:
  - [src/app/api/admin/leave/requests/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/leave/requests/route.ts)
  - [src/app/api/admin/leave/requests/[id]/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/leave/requests/[id]/route.ts)

Current model:

- guards submit leave
- admin reviews and updates status
- leave feeds payroll calculations

## 6.11 Notifications and PWA

Supporting pieces:

- FCM integration: [src/lib/fcm.ts](/Users/mymac/Documents/CISS/src/lib/fcm.ts)
- generic notifications: [src/lib/notifications.ts](/Users/mymac/Documents/CISS/src/lib/notifications.ts)
- PWA loader: [src/components/pwa-loader.tsx](/Users/mymac/Documents/CISS/src/components/pwa-loader.tsx)

Current state:

- web push token registration is present
- `fcmTokens` collection stores device registrations

## 6.12 Region Control Plane

Main admin page:

- [src/app/(app)/settings/state-management/page.tsx](/Users/mymac/Documents/CISS/src/app/(app)/settings/state-management/page.tsx)

Main APIs:

- overview: [src/app/api/super-admin/overview/route.ts](/Users/mymac/Documents/CISS/src/app/api/super-admin/overview/route.ts)
- regions CRUD: [src/app/api/super-admin/regions/route.ts](/Users/mymac/Documents/CISS/src/app/api/super-admin/regions/route.ts)
- region detail and setup:
  - [src/app/api/super-admin/regions/[id]/route.ts](/Users/mymac/Documents/CISS/src/app/api/super-admin/regions/[id]/route.ts)
  - [src/app/api/super-admin/regions/[id]/create-admin/route.ts](/Users/mymac/Documents/CISS/src/app/api/super-admin/regions/[id]/create-admin/route.ts)
  - [src/app/api/super-admin/regions/[id]/seed/route.ts](/Users/mymac/Documents/CISS/src/app/api/super-admin/regions/[id]/seed/route.ts)
  - [src/app/api/super-admin/regions/[id]/validate/route.ts](/Users/mymac/Documents/CISS/src/app/api/super-admin/regions/[id]/validate/route.ts)
  - [src/app/api/super-admin/regions/[id]/deployment-config/route.ts](/Users/mymac/Documents/CISS/src/app/api/super-admin/regions/[id]/deployment-config/route.ts)

Supporting libraries:

- remote connection encryption/storage: [src/lib/server/region-connections.ts](/Users/mymac/Documents/CISS/src/lib/server/region-connections.ts)
- onboarding helpers: [src/lib/server/region-onboarding.ts](/Users/mymac/Documents/CISS/src/lib/server/region-onboarding.ts)
- region typing: [src/types/region.ts](/Users/mymac/Documents/CISS/src/types/region.ts)

Current model:

- current region can be treated as one card in a larger network
- remote region credentials are stored encrypted
- overview builds transient Firebase Admin apps to query remote regions live

## 7. API Namespace Map

Current API namespaces:

- `/api/public/*`
  - public attendance / upload
  - public enrollment upload
  - portal context
  - public clients
- `/api/employees/*`
  - employee enrollment
  - lookup
  - public profile
- `/api/attendance/*`
  - submission
  - photo analysis
- `/api/guard/*`
  - auth
  - dashboard
  - profile
  - attendance
  - leave
  - training
  - evaluations
  - payslips
- `/api/client/*`
  - client dashboard
- `/api/admin/*`
  - clients
  - client users
  - employees
  - field officers
  - reports
  - training
  - payroll
  - work orders
  - sites
  - states
  - tools/fixes
- `/api/super-admin/*`
  - regions
  - cross-region overview

## 8. Major End-to-End Flows

## 8.1 Public enrollment flow

1. user opens `/enroll`
2. uploads files through `/api/public/enroll/upload`
3. submits payload to `/api/employees/enroll`
4. server validates district and uniqueness
5. employee record is created
6. QR data URL is generated and stored with employee
7. employee later appears in:
   - admin employee directory
   - public profile
   - guard provisioning flows

## 8.2 Attendance capture flow

1. user opens `/attendance`
2. frontend fetches selectable site/location options
3. frontend fetches employee by QR / phone / employee lookup
4. frontend captures:
   - location
   - photo
   - site
   - duty point
   - shift
5. submit to `/api/attendance/submit`
6. server validates:
   - employee
   - site
   - district
   - client
   - geofence
   - shift
   - TCS assignment rules if TCS
7. writes:
   - `attendanceLogs`
   - `attendanceState`

## 8.3 Guard login flow

1. guard opens `/guard-login`
2. enters phone or employee ID + PIN
3. `/api/guard/auth/login` validates employee and PIN
4. Firebase custom token is created
5. client signs into Firebase with custom token
6. guard shell loads with `role=guard` claims

## 8.4 Client portal flow

1. user opens `*.cisskerala.site`
2. subdomain is parsed as client portal context
3. login page is shown
4. admin-created client user signs in
5. client dashboard resolves `clientUsersByUid`
6. client-scoped data loads across dashboard/reports/pages

## 8.5 TCS work-order import flow

1. admin uploads exam workbook
2. preview route parses workbook and hashes content
3. preview fetches existing TCS rows
4. preview builds diff and duplicate state
5. admin confirms commit
6. commit resolves or creates TCS sites
7. commit writes per-exam work-order docs
8. board merges same center/date in display

## 8.6 Payroll generation flow

1. admin configures or uploads wage template per client
2. payroll run loads attendance and leave aggregates
3. wage template rules are evaluated
4. statutory deductions are computed
5. cycle and entries are created
6. payslips become available to admin and guards

## 9. Real Architectural Boundaries

The codebase currently has these genuine boundaries:

### Boundary A: public vs authenticated

Public pages and uploads are separate from admin/guard/client authenticated surfaces.

### Boundary B: client SDK vs admin SDK

- frontend uses [src/lib/firebase.ts](/Users/mymac/Documents/CISS/src/lib/firebase.ts)
- server routes use [src/lib/firebaseAdmin.ts](/Users/mymac/Documents/CISS/src/lib/firebaseAdmin.ts)

### Boundary C: role-scoped shell vs domain APIs

The UI shell determines visibility, but real authorization happens in API routes.

### Boundary D: regional runtime vs control-plane runtime

Kerala deployment and multi-region HQ logic coexist in one repo.

### Boundary E: TCS operational work-order system vs general workforce system

The work-order subsystem is now intentionally TCS-specific.

## 10. Duplications and Refactor Hotspots

These are the strongest real refactor hotspots found during tracing:

### 10.1 Profile-kit / PDF export duplication

Repeated across:

- enrollment page
- admin employee detail
- public profile
- bulk export settings

Recommended extraction:

- `src/lib/profile-kit/*`

### 10.2 Visit report and training report API skeleton duplication

Shared helper structure appears in:

- [src/app/api/admin/visit-reports/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/visit-reports/route.ts)
- [src/app/api/admin/training-reports/route.ts](/Users/mymac/Documents/CISS/src/app/api/admin/training-reports/route.ts)

Recommended extraction:

- `src/lib/server/field-officer-report-shared.ts`

### 10.3 TCS import identity helper duplication

Identity logic is duplicated between preview and commit routes:

- identity key builders
- fallback matching
- existing row normalization

Recommended extraction:

- `src/lib/work-orders/tcs-import-identity.ts`

### 10.4 TCS site-resolution core buried in route file

`resolveCommitRows()` and `fetchSites()` are important enough to extract.

Recommended extraction:

- `src/lib/work-orders/tcs-site-resolution.ts`

### 10.5 Mixed `clientId` and `clientName` matching model

The app has moved toward `clientId`, but fallback `clientName` matching still exists in many places.

This is workable today, but still a long-term consistency risk.

## 11. Graph-Mapping Reliability Notes

From tracing the graphify output:

- generic `GET()` / `POST()` route handlers are noisy graph hubs
- helper-level and domain-level named functions are much more trustworthy
- the most reliable architectural findings came from:
  - named domain helpers
  - diff engines
  - route-side repeated helper structures

## 12. Current State Summary

This app is no longer a small employee-attendance tool.
It is currently a multi-surface operational platform with:

- workforce enrollment and employee lifecycle
- guard PIN auth and portal
- public and guarded attendance flows
- site/duty-point/shift configuration
- TCS-specific work-order import and assignment operations
- client-scoped dashboards and portals
- field-officer reporting
- training and evaluation
- payroll and wage template processing
- super-admin regional control-plane support

In short, the repo currently behaves like:

- a regional operations platform for Kerala
- plus a super-admin HQ control plane
- plus a client portal layer
- plus a guard mobile web portal

## 13. Best Next Documentation Additions

If this architecture map is going to be maintained well, the next most useful docs would be:

1. `docs/attendance-flow-map.md`
2. `docs/client-portal-and-role-model.md`
3. `docs/tcs-work-order-import-architecture.md`
4. `docs/payroll-and-wage-template-architecture.md`

