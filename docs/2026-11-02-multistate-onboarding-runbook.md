# Multi-state onboarding runbook

**Date:** 2026-11-02
**Model:** one Firebase project per state, one regional deployment per state, isolation by Google account and project boundary.

## Why this model

Rules-level `stateCode` checks are defence in depth, not the tenant boundary. Several writers
historically created documents without `stateCode`, guards carried no state claim, and
`stateClaimMatches` treats a missing field as a wildcard. Until all of that is closed, a
shared database would leak across states. A separate project per state makes the boundary
structural: a bug in a query cannot cross into another state's data.

Consequence: onboarding a state is an infrastructure task, not a database row.

## What a state project must have before this platform can use it

| # | Requirement | Why |
|---|---|---|
| 1 | **Blaze (pay-as-you-go) billing** on the project | Firestore in `asia-south1` and Cloud Storage are not available on Spark. This is the step that silently blocks everything else. |
| 2 | Firestore database `(default)`, native mode, `asia-south1` | The platform's only datastore |
| 3 | Authentication → Email/Password enabled | Staff, field officers and client logins |
| 4 | Storage bucket `<project>.firebasestorage.app` | Attendance selfies, documents, training material |
| 5 | Service account key with the roles below | Lets the control plane validate, seed, deploy rules/indexes and provision |
| 6 | Android app registered for `co.in.ciss.ciss_mobile` | Mobile dynamic region initialisation |
| 7 | Domains decided (exact host or `*.wildcard`) | Host lock; a regional deployment refuses every other host |

Service account roles: `roles/firebase.admin`, `roles/serviceusage.serviceUsageAdmin`,
`roles/datastore.user`, `roles/datastore.indexAdmin`, `roles/firebaserules.admin`,
`roles/firebaseauth.admin`, `roles/storage.admin`.

The default `firebase-adminsdk-*` key is **not** enough on its own: in the Tamil Nadu project it
could read apps and create an Android app, but could not enable APIs, create the database, or
create a bucket.

## Onboarding a state, end to end

### Step 1 — State side (owner of the state's Google/Firebase project)

1. Upgrade the project to Blaze and attach a billing account.
2. Firebase Console → Firestore Database → Create database → native mode → `asia-south1`.
3. Authentication → Get started → enable **Email/Password**.
4. Storage → Get started (creates the bucket).
5. Project settings → Your apps → add an **Android** app with package `co.in.ciss.ciss_mobile`.
6. Project settings → Service accounts → generate a new private key.
7. Grant that service account the roles listed above (IAM & Admin).

### Step 2 — Verify from this repo

```bash
npx tsx scripts/init-region-firebase.ts \
  --project <project-id> --credentials ~/path/key.json \
  --bucket <project-id>.firebasestorage.app
```

Dry-run by default. It reports Firebase link, Firestore, Identity Platform and bucket state.
Add `--apply` once the state has completed step 1.

### Step 3 — Provision the database

```bash
npx tsx scripts/onboard-region.ts \
  --project <project-id> --credentials ~/path/key.json \
  --region-code TN --region-name "Tamil Nadu" \
  --apply --rules --indexes --seed \
  --admin-email <regional-admin-email> --admin-password '<temporary-password>'
```

This releases `firestore.rules` and `storage.rules`, creates the composite indexes, seeds
`systemConfig/runtime`, `enrollmentFormConfig/global`, `regionSetupProgress/default`, and creates
the regional administrator with `role=admin`, `admin=true`, `stateCode=<code>`. Re-running is
safe.

### Step 4 — Register the region in the control plane

`/settings/state-management` → **New Region**: region code and name, the seven web values, the
service-account JSON (stored AES-256-GCM encrypted, never returned), the optional
`google-services.json`, and the locked domains. Then **Validate → Seed defaults → Create admin**.

The encrypted connection requires `REGION_CONNECTIONS_SECRET` to exist in the control-plane
deployment. It is not present in local `.env` files, so this step must run from the production
deployment or with the same secret supplied.

### Step 5 — Deploy and lock the host

**Provision Vercel** creates the regional project and injects `REGION_CODE`, `REGION_NAME`,
`NEXT_PUBLIC_*` Firebase web values, `FIREBASE_ADMIN_SDK_CONFIG_BASE64` and
`REGION_ALLOWED_DOMAINS`. Then add the CNAME shown by the domain action and let Vercel issue the
certificate. The deployment answers only on the enrolled domains; preview URLs are blocked by
design.

### Step 6 — State team activation

Sign in as the regional admin:

1. `/wizard` completes state profile, districts, enrollment form, clients and sites, field
   officers, verification.
2. `/settings/enrollment-form` for ongoing form changes (including per-client overrides).
3. `/settings/clients` for clients, offices, sites, client-user accounts and geocoding.
4. `/field-officers` to create field-officer logins (email + password) with district scope.
5. `/api/admin/claims/repair` when a token's claims drift from the stored profile.

## Known gaps to close before a second state is safe

These are app-side, not infrastructure, and apply to Tamil Nadu today.

1. **Staff roles are not assignable.** `hr`, `accounts` and `compliance` appear in UI checks but
   are absent from `AppRole`, `claimsToRole` and claims repair. A state team that needs HR and
   accounts logins cannot have them. There is also no user-management screen beyond field
   officers and client users.
2. **Payroll statutory values are Kerala's.** `src/lib/payroll/defaults.ts` hard-codes Kerala
   professional-tax slabs. Tamil Nadu, Karnataka and others differ. Payroll must read a
   per-region `complianceSettings` document with an editing screen.
3. **No server-side state scoping.** `requireScopedAdmin` exists and is called nowhere; admin
   APIs are deployment-wide. Acceptable only while each state has its own project.
4. **Setup wizard is dead in Kerala.** `systemConfig/runtime` and `regionSetupProgress/default`
   do not exist in `ciss-workforce`, so `/api/wizard/profile` returns 404.
5. **TCS is hard-coded as the only operational client.** A second operational client yields an
   empty duty list for field officers.
6. **`/leave` in admin navigation 404s.**
7. **Mobile is Kerala-bound in three places.** FCM uses the default (Kerala) app, the APK update
   allowlist is `cisskerala.site`, and background tracking falls back to the Kerala project and
   host when it loses region context. A TN device would receive no push, refuse to update, and
   could write location samples to the wrong project.
8. **Indexes have no `stateCode` prefix.** Any future state-scoped query needs composite indexes
   that include `stateCode` before the filter is enabled.

## Per-state go-live checklist

- [ ] Billing enabled, Firestore `asia-south1`, Auth email/password, Storage bucket
- [ ] Service account with provisioning roles
- [ ] Android app registered for `co.in.ciss.ciss_mobile`
- [ ] `init-region-firebase.ts` dry-run clean
- [ ] `onboard-region.ts --apply --rules --indexes --seed` complete
- [ ] Region registered, validated, seeded, admin created in State Management
- [ ] Vercel project provisioned; environment variables present; deployment green
- [ ] DNS CNAME added, certificate issued, host lock verified
- [ ] Regional admin signs in, wizard completed, districts match the state list
- [ ] Clients, sites and field officers created; guard enrolment tested end to end
- [ ] Payroll statutory values reviewed for the state
- [ ] Mobile guard device tested: login, attendance in/out with photo and geofence, push, update

## Tamil Nadu status (2026-11-02)

- Project `ciss-tcs`, web app present, Android app registered by this run
  (`1:10561765831:android:354a98534da31d2f6199e2`, package `co.in.ciss.ciss_mobile`).
- **Blocked:** no billing account, so no Firestore database, no Identity Platform configuration
  and no Storage bucket. The project's service account cannot enable APIs or create the
  database. Nothing can be seeded until the owning account completes step 1.
- Not yet registered in the control plane: the encrypted connection needs
  `REGION_CONNECTIONS_SECRET`, which is only present in the production deployment.
