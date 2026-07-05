# CISS Workforce — System Overview (Memory)

> Living architectural memory for both the Next.js web platform (`CISS/`) and the
> Flutter Android app (`CISS-Mobile/`). Read this first when picking up work.
> Detailed per-change history lives in `CISS/MEMORY.md` and `CISS-Mobile/Memory.md`.
> Last refreshed: 2026-07-05.

---

## 1. What CISS Workforce is

A **workforce-management platform for a Kerala-based private security company**
(CISS). It runs guards' attendance, payroll, training, field operations, work
orders, and gives admins / clients / field officers real-time visibility.

It ships as **two products that share one Firebase + API backend**:

| Product | Repo | Stack | Role |
|---|---|---|---|
| Web platform | `/Users/mymac/Documents/CISS` | Next.js 15.5 (App Router), React 18, TypeScript, Firebase, ShadCN/Tailwind, Vercel | Admin / super-admin / field-officer / client / guard PWA + the **region control plane** |
| Mobile app | `/Users/mymac/Documents/CISS-Mobile` | Flutter 3 (Material 3), Riverpod, go_router, Firebase, Dio | Guard + field-officer + admin + client operations client (Android) |

Both point at the same backend: **`https://cisskerala.site`** (Firebase project
`ciss-workforce`, region/home = Kerala / `KL`).

### Runtime modes
The web app has two modes selected by `APP_MODE`:
- **`control-plane`** (default, KL) — the HQ deployment. Hosts the super-admin
  region automation + cross-region dashboards.
- **`regional`** — a per-state deployment provisioned by the control plane.

---

## 2. Roles & auth (shared model)

Six roles, **custom claims are the source of truth** (Firestore fallbacks repair stale tokens):

| Role | Identity | Login surface | Notes |
|---|---|---|---|
| `superAdmin` | email/password | web only | Runs the control plane; `requireSuperAdmin` gate |
| `admin` | email/password | web + mobile (admin shell) | Regional admin |
| `fieldOfficer` | email/password | web + mobile (FO shell) | **District-scoped** via `assignedDistricts` claim |
| `client` | email/password | web + mobile (client shell) | Scoped to one `clientId` |
| `guard` | synthetic email `{phone}@guard.{region}.ciss-regional.app` + PIN | web (portal) + mobile (guard shell) | PIN hashed with Node crypto; OTP reset |
| `user` | fallback | — | — |

Claim keys in use: `role`, `admin` (legacy bool), `stateCode`, `assignedDistricts`,
`clientId`, `clientName`, `employeeId`, `employeeDocId`.

Key files:
- Web: `src/lib/server/auth.ts` (`requireAdmin/requireSuperAdmin/requireAdminOrFieldOfficer/requireGuard`), `src/lib/server/guard-auth.ts`, `src/lib/auth/roles.ts`, `src/context/auth-context.tsx`, `src/lib/guard/pin-utils.ts`
- Mobile: `lib/features/auth/application/auth_controller.dart`, `lib/core/auth/` (biometric_*, saved_accounts_service), `lib/features/auth/presentation/*`
- Self-healing: `POST /api/admin/claims/repair` diffs claims vs Firestore and patches them.

---

## 3. Web platform (`CISS/`) — structure

### Route map
**Public**
- `/` landing (phone/QR → attendance), `/attendance`, `/record-attendance`, `/enroll`, `/profile/[id]`, `/download`, `/admin-login`, `/guard-login` (+setup/reset/forgot-pin)

**Guard portal** `(guard)/guard/*` — dashboard, attendance, payslips, evaluations, profile, training (+ quiz `[assignmentId]`)

**Admin/app** `(app)/*`
- Core: `dashboard`, `employees`(+`[id]`,`enroll`), `attendance-logs`, `leaderboard`, `field-officers`, `evaluations`(+`[id]`), `patrol-activity`, `training-reports`, `visit-reports`, `admin/notifications`, `wizard`
- Payroll: `payroll`, `payroll/run`, `payroll/cycles/[id]`, `.../entries/[entryId]`
- Work orders: `work-orders`(+`[siteId]`,`assigned-guards-export`,`imports`)
- Training: `training`, `training/assignments`, `training/banks`(+`[id]`)
- Settings hub (`settings/*`, recently reorganized commit `83ca60fd`): hub, `admin-tools`, `assigned-guards-export`, `bulk-import`, `client-locations`, `client-management`, `clients`(+`[clientId]`,`geocode-coordinates`), `data-export`, `enrollment-form`, `qr-management`, `reports`, `site-management`, **`state-management`** (region UI), `wage-config`, `work-order-imports`

### API surface (`src/app/api/`)
- **attendance**: `validate`, `submit`, `auto-checkout` (cron)
- **admin** (~70 endpoints): attendance, auth-users, claims/repair, clients(+wage-config), compliance-settings, dashboard, employees, evaluations, field-officers, notifications(+send), payroll (cycles/entries/run/validate, reports), sites(+verify/batch-geocode), states, training (assignments/banks/modules), training-reports, visit-reports, work-orders (import/preview/commit, backfill-*, bulk-delete, rename-exam, todos)
- **public**: `app-update` (Android manifest), `attendance`(+employee/upload/upload-token/verify-qr), `clients`, `download/android`, `enroll`(+upload), `enrollment-config`, `portal-context`, **`regions`**, **`region-config/[code]`**
- **guard**: `auth/*` (login/setup-pin/reset-pin/pin-status/send-reset-otp/verify-reset-otp), `attendance`, `dashboard`, `evaluations`, `incidents`, `patrol`, `payslips`, `profile`, **`tracking/heartbeat`**, `tracking/geofence-event`, `training`(+acknowledge, quiz submit)
- **field-officer**: `dashboard`, `guard-attendance`, `guards`, `sites`, `training-reports`, `upload`, `visit-reports`, `work-orders`(+`[id]`)
- **client**: `attendance`, `dashboard`, `guards`, `patrol-activities`, `work-orders`
- **super-admin**: `employees`, `overview` (cross-region), **`regions`** + `[id]` sub-routes: `automate`, `automation-retry`, `automation-status`, `check`, `create-admin`, `deployment-config`, `domain`, `provision-vercel`, `seed`, `validate`
- **wizard**: `profile`, `districts`, `enrollment-config`, `clients`, `field-officers`, `verify`, `complete`
- **internal**: `automation-worker` (cron, `maxDuration: 300`)
- **mobile**: `notifications`, `session`, `token`
- Top-level: `employees/enroll`, `employees/lookup`, `employees/public-profile/[id]`, `geocode-site`, `locations/geocode`

### Core libs (`src/lib/`)
- Firebase clients: `firebase.ts` (client, IndexedDB persistent + multi-tab), `firebaseAdmin.ts` (Admin SDK; credential chain ADC→Base64→JSON→split→ADC; separate `custom-token-signer` app)
- `attendance/`: `attendance-validation.ts` (shift-aware state machine, midnight-crossing), `auto-detect.ts` (GPS+time haversine), `public-attendance.ts`
- `payroll/`: `calculate.ts` (EPF/ESIC/PT slabs, TDS), `wage-template-parser.ts`/`-evaluator.ts`, `attendance-aggregator.ts`, `payslip.ts`
- `qr/`: `qr-token.ts` (HMAC-SHA256 signed tokens), `employee-qr.ts`, `scanner-engine.ts`
- `server/`: `auth.ts`, `guard-auth.ts`, `rate-limit.ts` (Firestore-tx limiter), **`region-automator.ts`** (14-step pipeline), `region-preflight.ts`, `firebase-management-client.ts`, `vercel-provisioner.ts`, `region-connections.ts` (AES-256-GCM encrypted SA JSON), `region-onboarding.ts`, `mobile-session.ts`, `upload-token.ts`, `location-geocode.ts` (OpenCage), `openrouter.ts`
- `shift-utils.ts` (2x12 day/night, 3x8 templates, `Asia/Kolkata`)
- `region-wizard.ts`, `enrollment-config.ts`, `districts.ts` (KERALA_DISTRICTS + index), `runtime-config.ts`, `vercel-region.ts`
- `hooks/`: `use-guard-heartbeat.ts` (live tracking loop), `use-clients.ts`, `use-sites.ts`
- `guard/`: `pin-utils.ts`, `otp-utils.ts`, `identity-utils.ts`
- `employees/visibility.ts` (FO district-scoping)

### Components (`src/components/`)
- `ui/` full shadcn/Radix set
- `dashboard/`: `live-guard-map.tsx` + `live-guards-section.tsx` (Leaflet), `client-operations-dashboard.tsx`, charts/stats/actions
- `field-officers/`: photo-capture, report-preview, site-report-upload, visit/training-reports-panel, work-orders-panel, detail sheets
- `guard/`: attendance-calendar, bottom-nav, header
- Plus `qr-scanner-dialog.tsx`, `pwa-loader.tsx`, `error-boundary.tsx`, location/patrol/work-orders panels

### Vercel config (`vercel.json`)
- Crons: `/api/attendance/auto-checkout` (daily 2 AM), `/api/internal/automation-worker` (daily 3:15 AM, hobby-compatible)
- Headers: content-type + caching for `public/downloads/*.apk` and the Android update manifest JSON

---

## 4. Mobile app (`CISS-Mobile/`) — structure

**Config**: `applicationId = co.in.ciss.ciss_mobile`, `minSdk 24 / compileSdk 36`, Kotlin/Java 17, NDK 27. **Version `1.0.14+14`**. Release-signed via `android/key.properties` (exists). Permissions: full location (incl. background), camera, foreground-service-location, notifications (POST_NOTIFICATIONS), biometrics, activity-recognition, battery-opt exemption.

**Architecture**: feature-first, layered presentationally. Riverpod for state, `go_router` for nav, `MobileRepository` facade over Dio + Firebase. Bundled **Inter** font (no google_fonts).

**Boot (`main.dart`)**: open two Hive boxes (`offline_queue` AES-encrypted via key in FlutterSecureStorage; `draft_box` plain) → init Firebase (default + regional if ≠KL) → on Android init `BackgroundTrackingService` only if POST_NOTIFICATIONS already granted (avoids Android 14 startForeground crash) → start SyncService, RefreshController, notifications.

### `lib/core/`
- `auth/`: `biometric_service.dart`, `biometric_credential_store.dart` (FlutterSecureStorage-backed; *not* true biometric-bound encryption — documented limitation), `saved_accounts_service.dart` (max 5)
- `location/`: `background_tracking_service.dart` (foreground service, 3-min heartbeat hybrid GPS→network→last-known, accuracy buffer, 2-consecutive-out debounce, 30s movement trace to `locationHistory`), `live_location_service.dart` (`guardLocations/{employeeDocId}`)
- `network/`: `api_config.dart` (baseUrl `https://cisskerala.site` from `CISS_API_BASE_URL`, overridable per active region), `api_client.dart` (Dio 30s/40s), `mobile_repository.dart` (1250 lines, all endpoints)
- `offline/`: `offline_queue.dart`, `offline_request.dart`, `draft_service.dart`
- `sync/`: `sync_service.dart` (replays queue on connectivity, handles photo upload substitution), `refresh_controller.dart` (15-min provider invalidation)
- `region/`: `region_service.dart` (multi-region Firebase + API switching)
- `update/`: `app_update_service.dart` + `app_update_gate.dart` (in-app APK self-update with manifest)
- `fcm/`: `notification_service.dart`, `models/` (13 model files)

### `lib/features/`
- **auth** (`auth_controller.dart` + 8 presentation screens): AuthGate with biometric lock → `/region-select` → `/login` hub → role login (`/login/guard`, `/login/field-officer`, `/login/admin`) → `/permissions` onboarding
- **guard** (`guard_shell.dart` 5 tabs + 10 screens): dashboard, attendance (**1514 lines** — site auto-pick by GPS, IN/OUT auto-default, photo proof, starts/stops background tracking, offline-queue on net fail), training (+detail), payslips, evaluations, incidents, leave, patrol, profile, More hub
- **field_officer** (`field_officer_shell.dart` 6 tabs + 7 screens): dashboard, work-orders (759 lines, assign guards), guards (+detail), attendance (867 lines), **reports (2054 lines)** visit/training tabs + multi-photo upload + offline fallback, tools vault
- **admin** (`admin_shell.dart` 4 tabs) + **client** (`client_shell.dart` 4 tabs) — read-mostly dashboards hitting `/api/admin/*` and `/api/client/*`
- **attendance_public** (`/attendance`, no-login 3-step wizard), **attendance_qr** (`/qr-attendance` via mobile_scanner), **enrollment** (`/enroll`), **region** (`/region-select`), **shared** (`notification_inbox_screen.dart`)

### `lib/app/theme/`
`app_tokens.dart` (`CissThemeTokens` ThemeExtension — primary `#0B4F82`, accent amber, success/warning/danger + softs; `AppSpacing/Radius/Shadows/Typography`), `app_theme.dart` (Material 3, seeded ColorScheme, bundled Inter), `theme_mode_controller.dart`.

---

## 5. The multi-state region automation system (centerpiece)

Lets a super-admin, from the KL control plane, **provision an entire new state's
Firebase project + Vercel deployment** end-to-end.

### What a "region" is
A region = a state (KL home). Each runs isolated: own Firebase project (Auth +
Firestore + Storage), own Vercel project, own `REGION_CODE`/`REGION_NAME`, own
admin. Stored as docs in **`regions`** collection keyed by region code. Type:
`RegionRecord` (`src/types/region.ts`) holds codes, status lifecycle, full SDK
config (web+android keys, appIds, storage bucket), `regionAdminEmail`,
onboarding checklist, validation/preflight/readiness summaries, Vercel project
name/URLs, `automationJobId`.

Status lifecycle: `draft → config_pending → validated → seeded → ready → live → suspended → error`

### Two entry surfaces
1. **State Management page** (`settings/state-management`) — super-admin UI: create region, onboarding checklist, guided setup, automation trigger buttons
2. **Regional setup wizard** (`/wizard`) — first-run 6-step wizard for a freshly-created regional admin (Profile → Districts → Enrollment Form → Clients & Sites → Field Officers → Verification), backed by `/api/wizard/*`

### The 14-step automation pipeline (`region-automator.ts`)
1. `preflight` — project-ID/region-code regex, secrets presence
2. `create_gcp_project` — Cloud Resource Manager (create-or-get, long-poll)
3. `enable_apis` — Service Usage
4. `add_firebase` — Firebase Management finalizeStatus
5. `provision_firestore` — `asia-south1`
6. `enable_auth` — Identity Platform (Identity Toolkit v2)
7. `create_apps` — Android `com.ciss.workforce` + Web; persist appIds + storage bucket
8. `collect_sdk_configs` — fetch Android + Web configs
9. `generate_service_account` — IAM key → **AES-256-GCM encrypt → `regionConnections` collection**; mark `persistentConnectionReady`
10. `deploy_rules` — deploy local firestore.rules/storage.rules/indexes into new project
11. `seed_defaults` — compliance settings, enrollment-form config, setup-progress
12. `create_admin` — regional admin user + claims + temp password (returned once)
13. `provision_vercel` — ensure project → set env (APP_MODE=regional, all Firebase keys, base64 SA JSON) → deploy → health check
14. `verify_ready` — re-validate Firestore/Auth/Storage → flip status to `ready`

### Execution model
- `startAutomation` writes queued `AutomationJob` doc (`automationJobs`) with 14 pending steps + audit trail
- Distributed lock (`systemConfig/region_automation_lock`, 30-min TTL); `claimNextAutomationJob` claims queued or stale-running (>15 min) via Firestore tx
- Runner = **`/api/internal/automation-worker`** (cron daily 3:15 AM, `CRON_SECRET`-guarded, `maxDuration: 300s`) → `processNextAutomationJob`. Resumable from failed step.
- Manual endpoints: `automate` (start), `automation-status` (poll), `automation-retry` (re-queue from step), `check`, `validate`, `seed`, `create-admin`, `provision-vercel`, `deployment-config`, `domain` (custom domain)

### Cross-region access
`region-connections.ts` lets control plane build **transient Firebase Admin apps**
from stored encrypted SA JSON → `/api/super-admin/overview` + `/api/super-admin/employees`
aggregate metrics across all regions.

### Flutter runtime region switching
- `/api/public/regions` lists all `live`/`ready` regions (always incl. synthetic KL)
- `/api/public/region-config/[code]` returns Android + Web config so Flutter (`region_service.dart`) re-initializes a per-region Firebase app at runtime.

### Android update delivery
- `public/downloads/ciss-workforce-android.json` — versioned manifest (`latestVersionName/Code`, `minimumSupportedVersionCode`, `apkPath`, `sha256`, `releaseNotes`, `mandatory`)
- `/api/public/app-update` serves manifest; `/api/public/download/android` redirects to versioned APK
- Flutter `app_update_service.dart` polls it; `AppUpdateGate` blocks on mandatory, dismissible otherwise
- APKs in `public/downloads/`: `ciss-workforce-latest.apk`, `ciss-workforce-1.0.14.apk`, `ciss-mobile.apk`

---

## 6. Major product features (both apps)

- **Attendance** — QR + manual ID/phone/resource lookup, photo proof, GPS geofence (strict/warn/loose), shift resolution (early/late/tail-end/overnight), auto-checkout cron, idempotent submit (`clientRequestId`), `attendanceState` + `attendanceSessions` + `attendanceLogs` (use `employeeDocId`)
- **Live guard tracking** — PWA `useGuardHeartbeat` (60s) + Flutter `BackgroundTrackingService` (3-min heartbeat, 30s trace) write to `guardLocations/{employeeDocId}` + `locationHistory` subcollection; admin `LiveGuardMap` (Leaflet) + `LiveGuardsSection` with KPIs
- **Payroll** — per-client wage templates (calc types: fixed/pct_of_basic/ctc/gross/epf_base/balancing/kerala_slab/tds_projected), `payrollCycles` + `payrollEntries`, EPF/ESIC/PT/TDS, PDF payslips (pdf-lib). No overtime/LOP/leave (removed May 2026).
- **Wage config** — `clientWageConfig/{clientId}`, builder with drag-drop sections + components
- **Training** — modules, question banks, quiz attempts, assignments + acknowledge; guard quiz flow
- **Work orders** — full lifecycle incl. sophisticated **TCS exam duty import** (parse/hash/diff/site-resolve, ~1,057 workbooks), bulk ops, todos, assigned-guards export
- **Field officer reports** — visit + training reports with photo capture/stamping, preview step, flexible upload (camera/gallery/files), 3-photo minimum for training, PDF client reports
- **Evaluations & awards** — criteria, guard scores, awards
- **Patrol** — patrol points, hourly checks, settings, activity
- **Client portal** — role-scoped dashboard (live attendance, shifts, sites, work orders, reports, patrol) with module permissions
- **Notifications** — FCM per role/district, in-app inbox
- **Biometric login** — all four roles (Flutter); credentials in FlutterSecureStorage
- **Offline** — encrypted Hive queue (max 100, retry >20 evicted) replays on connectivity; handles attendance + FO report photo substitution
- **Multi-state regions** — see §5

---

## 7. Key Firestore collections
`employees`, `attendanceLogs`, `attendanceState`, `attendanceSessions`, `guardLocations` (+`locationHistory` subcoll), `sites`, `clientLocations`, `clients`, `clientWageConfig`, `fieldOfficers`, `clientUsersByUid`, `workOrders`, `workOrderImports`, `payrollCycles`, `payrollEntries`, `complianceSettings`, `trainingModules`, `questionBanks`, `trainingAssignments`, `quizAttempts`, `trainingReports`, `visitReports` (a.k.a. `foVisitReports`/`foTrainingReports`), `evaluations`, `awards`, `patrolActivities`, `patrolSettings`, `incidents`, `leaveRequests`, `notifications`, `fcmTokens`, `appNotifications`, `enrollmentFormConfig`, `setupProgress`, **`regions`**, **`regionConnections`** (encrypted), **`automationJobs`**, `systemConfig` (locks), `auditEvents`.

---

## 8. Build / deploy / ops

### Web
- `npm run dev` (clears `.next`), `build`, `start`, `lint`, `test` (vitest), `typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`), `genkit:dev/watch`
- Deploys to Vercel on push to `main`. Crons in `vercel.json`.
- Firebase deploy: `firebase deploy --only firestore:rules,indexes,storage:rules`
- Node 22.x. `postinstall: patch-package`.

### Mobile
- `flutter run --dart-define-from-file=mobile.env`
- Release: `flutter build apk --release --split-per-abi` → copy arm64-v8a APK to `CISS/public/downloads/ciss-workforce-latest.apk` (+ versioned copy) → commit → Vercel serves it
- CI: `.github/workflows/build-apk.yml` (Java 17, Flutter 3.29.2, on `v*` tags + dispatch)
- Release-signed via `android/key.properties`
- Flutter 3.44-compatible (commit `5141c45`)

### Config / secrets
- Web `.env.*`: Firebase web config, `FIREBASE_ADMIN_*` (Base64/JSON/split/ADC), `SUPER_ADMIN_EMAIL`, `OPENCAGE_API_KEY`, OpenRouter/Gemini keys, `APP_MODE`/`REGION_CODE`/`REGION_NAME`/`GUARD_AUTH_EMAIL_DOMAIN`, `CRON_SECRET`, `REGION_CONNECTIONS_SECRET`, `VERCEL_TOKEN`
- Mobile `mobile.env`: `CISS_API_BASE_URL`, branding (`CISS_COMPANY_*`), Firebase web keys (named `NEXT_PUBLIC_FIREBASE_*` for parity), `NEXT_PUBLIC_SUPER_ADMIN_EMAIL`. **Admin SDK stays web-only.**

---

## 9. Critical conventions (don't break these)
- `attendanceLogs` keyed by `employeeDocId`, **not** `employeeId` (which contains slashes)
- `attendanceDate` is a `YYYY-MM-DD` string
- All composite indexes in `firestore.indexes.json`
- Wage config in `clientWageConfig/{clientId}`
- District values canonicalized via `canonicalizeDistrictList` (KERALA_DISTRICTS index)
- FO queries must include `where("district", "in", assignedDistricts)` or Firestore rules deny
- `assignedDistricts` written to doc **and** synced to custom claims (`setCustomUserClaims`) or read mismatch
- Guards: synthetic email `{phone}@guard.{region}.ciss-regional.app`, PIN hashed (Node crypto)
- Mobile repo stays isolated; only the built APK is committed to the web repo's `public/downloads/`
- `docs/app-context.md` is the canonical architecture doc — read first

---

## 10. Recent work trajectory (Jun–Jul 2026)
- Multi-state region automation rolled out in phases (`25831192` → `c8ecb74e`): runner → wizard → Firebase Management client → Vercel provisioner → custom domain → Flutter runtime region switching → Android update delivery → role-based settings hub
- Live guard tracking (`93ab7cff`) + reliability hardening (background service, offline queue)
- Biometric registration for all roles (mobile)
- Reports redesign (preview, photo stamping, 3-photo training minimum, flexible upload)
- FO district-claim sync fixes + work-order composite indexes
- Sites database cleanup (TCS NEET cross-reference; 145 sites final; zero TN)
- PIN hash moved Web Crypto → Node crypto (serverless safety)
