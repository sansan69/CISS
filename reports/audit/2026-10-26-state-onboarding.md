# State onboarding (BYO Firebase) + per-region domain lock

**Date:** 2026-10-26
**Scope:** CISS web (`/Users/mymac/Documents/CISS`) and CISS-Mobile (`/Users/mymac/Documents/CISS-Mobile`)
**Model:** each state owns its Firebase project under its own Google account and shares its web app config, optional Android `google-services.json`, a service-account JSON for the Admin SDK, and the domain(s) that may serve it. Super Admin enrolls the state; the regional deployment runs on that state's database and refuses every other host.

## 1. What was built

### 1.1 Super Admin onboarding (`/settings/state-management` → New Region)

The create dialog now collects:

- region code + name, region admin email;
- the seven Firebase **web** values (`projectId`, `apiKey`, `appId`, `authDomain`, `storageBucket`, `messagingSenderId`, `measurementId`);
- the **service-account JSON** (validated, then stored AES-256-GCM encrypted in `regionConnections`; never returned to the browser again);
- an optional **`google-services.json`** for the Android app (parsed server-side into `androidAppId` / `androidApiKey` / `androidPackageName`);
- **locked domains**, one per line (exact host or `*.wildcard`), max 20.

`POST /api/super-admin/regions` now:

1. requires super-admin;
2. normalises and validates every domain (hostname only, no scheme/path/port/userinfo; wildcard only as a leading `*.`);
3. parses the Android JSON (BOM-tolerant, multi-client aware) and requires `project_info.project_id`, the app id, package name and current API key;
4. enforces **project agreement** across web config ↔ google-services ↔ service account before any write;
5. when a service account is supplied, validates Firestore/Auth/Storage access and stores the encrypted connection; on failure the region is saved as `config_pending` and the API returns **422** (the UI selects the saved region and points at validation instead of a 409-prone retry);
6. records onboarding mode (`byo_firebase` vs `automated`), android fields, domains and an audit event — never the credentials;
7. responses are passed through `stripRegionSecrets`.

### 1.2 Per-region host lock

- `src/lib/server/domain-lock.ts` normalises hosts and matches exact domains and `*.sub` wildcards; an empty allowlist means "not locked" so existing deployments keep working; loopback is allowed only in development.
- `src/middleware.ts` enforces the lock for **pages and every API path**, including prefetch requests and paths ending in an image extension (API routes are matched explicitly, so `/api/documents/photo.png` cannot slip past the static-asset exclusion). Disallowed hosts get 403 (JSON for `/api`, plain text otherwise) before any CSP work.
- `REGION_ALLOWED_DOMAINS` is written into the regional Vercel project at provisioning and updated + redeployed whenever domains are added.
- `upsertVercelEnvVar` updates the entry matching the requested target only, so preview/development assignments are not stripped.

### 1.3 Android / mobile

The Flutter app already initialises Firebase dynamically from `/api/public/region-config/<code>` (`android` + `web` blocks). The onboarding now fills those Android values from `google-services.json`; a state-specific APK build is **not required** for the app to use the state's database. The JSON is only needed if the state builds its own APK or uses build-time plugins that read it.

### 1.4 Deployment config

`/api/super-admin/regions/[id]/deployment-config` now emits `androidAppId/androidApiKey/androidPackageName`, `REGION_ALLOWED_DOMAINS`, `ONBOARDING_MODE` and the existing Firebase web values (still no service account). The provisioning step injects `FIREBASE_ADMIN_SDK_CONFIG_BASE64` from the encrypted connection, so the state's Admin SDK works inside its own deployment.

## 2. Operator runbook (per state)

1. **State side (their Google account):** create the Firebase project; enable Firestore (asia-south1), Authentication (Email/Password), Storage; add a Web app; optionally add an Android app with package `co.in.ciss.ciss_mobile` and download `google-services.json`; create a service account key with Firebase Admin + Storage permissions; decide the custom domain.
2. **Super Admin:** State Management → New Region → paste the web config, service account, optional google-services JSON, and the domains → Create. A 422 means the record was saved but validation failed: open it, fix credentials, use **Validate**.
3. **Seed + admin:** use the existing Validate → Seed defaults → Create admin actions.
4. **Provision Vercel:** creates the regional project and injects the Firebase web/admin env + `REGION_ALLOWED_DOMAINS`, then deploys.
5. **DNS:** add the CNAME(s) shown by the domain action; Vercel issues the certificate.
6. **Verify:** `GET /api/public/region-config/<CODE>` returns the state's web/android config; the regional URL answers only on the enrolled domain(s).

## 3. Verification

- Web: **95 files / 611 tests**, typecheck, lint, production build — all pass.
- Mobile: `flutter analyze` clean, **331 tests** pass.
- PENTA stage-5 review over the changed surface found six issues across two rounds (prefetch matcher bypass, API image-extension bypass, domain-cap truncation, UI 422 handling, target-aware Vercel env upsert, stale domain-result panel). All are fixed and covered by tests (`src/middleware.test.ts`, `domain-lock.test.ts`, region onboarding/route tests).
- No commit, deploy or live Firebase call was made by this feature work.

## 4. Residual risks / next steps

1. **Service-account permission probe.** Validation proves Firestore `listCollections`, `auth.listUsers(1)` and bucket metadata. A key that lacks `auth.createUser`/`setCustomUserClaims` (needed for seed/admin) or Storage write (attendance selfies) would still pass; add a permission-scoped probe before marking a region `ready`.
2. **Domain changes redeploy the regional project.** Expected, but a mistyped domain is live until corrected; use the documented CNAME and verify after each change.
3. **Preview URLs are blocked** once a lock is configured (by design). Use the enrolled production domains.
4. **Separate deployment per state remains the model.** A single deployment routing multiple states by Host is not implemented; it would require per-request Admin SDK selection.
5. **Region onboarding still needs a Vercel token** for automated deployment; states that host themselves can use the deployment-config endpoint manually and set `REGION_ALLOWED_DOMAINS` themselves.

## 5. End-to-end acceptance (Firebase emulators, 2026-10-26)

A 100-check acceptance harness now lives in `tests/e2e/` (`acceptance.mjs`, `verify.sh`, `report.md/json`). It runs the real Next.js route handlers against the Auth/Firestore/Storage emulators with the repository rules loaded, a synthetic per-run RSA service account, and an encrypted connection secret. No live project is touched. Current result after the fixes below: **96 pass, 0 defects, 0 harness failures, 4 blocked** (FCM push, guard self-enrolment needing KMS/Storage, payslips retired, and the F8 product decision).

**Fixed and re-verified by the harness:**
- **Broadcast notifications 500 when `data` is omitted.** `src/app/api/admin/notifications/send/route.ts` wrote `data: data || undefined` and `recipientDistrict: … ?? undefined`; Firestore rejects undefined field values, so any non-UI caller (mobile, scripts) got a 500 and no notification document. Optional fields are now omitted, and a regression test proves a payload without `data` and a recipient without a district both succeed.
- **Dev-only guard-login recursion.** On a localhost Host the login route checked the custom token, then POSTed to `NEXT_PUBLIC_APP_URL`; when that pointed at the same dev server it re-entered itself. The fallback now returns null when the target origin equals the request origin.

**Blocked / by design (not code defects to fix blindly):**
- Salary slips/payslips are retired tombstones (410) — this is the payroll retirement, and it needs a product decision, not a test.
- Guard self-enrolment cannot be proven offline: it needs approved draft-scoped Storage document references and Cloud KMS Aadhaar encryption. Guard *authentication* after enrolment was proven end to end.
- Real FCM delivery needs a device/credentialed project; in-app notification documents are what the harness proves.

**New caveats recorded by the harness:**
- Onboarding currently accepts a region without a `storageBucket`; document/training uploads then stay unconfigured until it is added. Add the bucket before marking a state ready (or require it in the onboarding form).
- `firestore.rules` still hardcodes `@guard.cisskerala.app` in `isGuard()` (role claim covers guards in practice) and non-Kerala district names are stored verbatim without canonicalisation. Multi-state edges, not current blockers.
- The PENTA `run` pipeline itself crashed in its own balancer (`choose_flexible_owner` is not defined); `penta review` completed four rounds and passed cleanly after the harness fixes. This is a PENTA CLI defect, not a product defect.

## 6. Database setup completion (2026-10-27)

**Storage bucket is now mandatory for BYO enrolment.** `POST /api/super-admin/regions` rejects a service-account enrolment without `storageBucket` (422 before any write) and rejects non-bare values (console URLs, `gs://` is normalised). The create dialog marks it required and blocks submission; the helper text explains that documents, attendance selfies and training material use it. The validation probe verifies bucket metadata with the state's credentials. (In the Firebase Storage emulator, which does not implement bucket management, the probe is skipped — real deployments still fail closed.)

**New `POST/GET /api/super-admin/regions/[id]/database-setup`.** Super-admin only; uses the region's **own** decrypted service account (never HQ ADC) to:

1. verify the bucket (fail-closed first step);
2. release `firestore.rules`;
3. release `storage.rules`;
4. create missing composite indexes from `firestore.indexes.json` (signature-idempotent, `409 ALREADY_EXISTS` counted as existing, unfinished builds reported `pending` inside a 60 s wait budget);
5. persist `onboardingChecklist.{rulesDeployed,indexesDeployed,storageBucketVerified}` and `databaseSetup{...}`, write a `region_database_setup` audit event.

Response contract: **200** all good · **207** partial (completed steps + failing step) · **500** first step failed · **422** no connection/bucket/project mismatch · **404** unknown region · **403** non-super-admin. No credential material is returned. `maxDuration = 300`; re-running is safe and finishes index builds. `next.config.ts` now traces `firestore.rules`, `storage.rules` and `firestore.indexes.json` into the route's serverless bundle.

**Index deployment now supports the region's service account.** `firebase-management-client.ts` mints a JWT (cloud-platform + firebase) when a service account is supplied; the ADC path used by the existing automation is unchanged.

**State service-account IAM required:** `roles/firebaserules.admin`, `roles/datastore.indexAdmin`, `roles/storage.legacyBucketReader` (+ `roles/storage.objectAdmin`), `roles/datastore.user`, `roles/firebaseauth.admin`; APIs `firebaserules`, `firestore`, `storage` enabled. A standard `firebase-adminsdk-*` key usually covers all of it.

**Verification:** web **97 files / 628 tests**, typecheck, lint, build all pass; mobile analyze clean + **331 tests**; emulator acceptance **96 pass · 0 fail · 0 defects · 4 blocked**, F1 onboarding READY (F2 guard self-enrolment needs KMS/Storage, F6 real FCM push, F8 payslips retired).
