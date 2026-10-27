# Input-flow persistence verification (2026-10-27)

**Method:** PENTA plan + the emulator acceptance harness (`tests/e2e/acceptance.mjs`), extended with four new read-after-write flows. Real Next.js route handlers run against Auth/Firestore/Storage emulators with the repository rules loaded; every write is followed by a direct Firestore read of the expected document/fields. Nothing touched the live project.

## Result

**128 checks · 125 pass · 0 fail · 0 product defects · 3 blocked.**

| Flow | Persistence verified | Verdict |
|---|---|---|
| F1 Region onboarding | `regions`, `regionConnections` (encrypted, no plaintext key), seeded defaults, admin claims, deployment-config | READY |
| F2 Guard enrollment + auth | Guard doc/claims/PIN link; **public enrollment API blocked** (needs Cloud KMS + Storage drafts) | PARTIAL |
| F3 Field officer | `fieldOfficers` doc + claims (`role`, `assignedDistricts`, `stateCode`), district scoping | READY |
| F4 Client / site / duty point | `clients` (+stateCode), `sites` (coords, dutyPoints via browser SDK), `clientLocations`; unauthenticated writes denied by rules | READY |
| F5 Work order upload + assignment | `workOrders` with `assignedGuards`, list + FO view, preview **and commit**, TCS sites auto-created with client/district/coordinate status | READY |
| F6 Notifications | `notifications` docs for guard + FO, inbox; **real FCM push blocked** (no emulator) | PARTIAL |
| F7 Training | module, assignment, guard acknowledgement (`status` advance) | READY |
| F8 Payslips | 410 tombstones — retired by design | BLOCKED |
| F9 DB integrity + rules | 11 collections written/read, encrypted connection, anon read denied | READY |
| F10 Multi-state | TN roster import + region registry | READY |
| **F11 Attendance marking (new)** | `attendanceLogs` under the idempotency key with employee/site/status/photo/actor; `attendanceState` IN → OUT; `attendanceSessions` open → closed with `outLogId` | **READY** |
| **F12 Employee record edit (new)** | edit through the admin browser SDK persists the changed field and keeps identity fields | **READY** |
| **F13 Client portal user (new)** | Auth user + claims (`role=client`, `clientId`, `clientName`, `stateCode`), `clientUsers` doc | **READY** |
| **F14 Guard evaluation (new)** | `evaluations` doc with employee, period, criteria total, normalised score and evaluator | **READY** |
| **F15 Bulk payslips (new)** | admin PDF upload → `payslipDocuments` + Storage object → guard list → guard download; non-guard refused | **READY** |

## Defect found and fixed

**Attendance could not be marked at an admin-created site.** `POST /api/admin/sites` stores `latitude`/`longitude`, but `parseSiteCoordinates()` in `src/app/api/attendance/submit/route.ts` only read `geolocation`, `lat`/`lng` or `latString`/`lngString`. A newly created site therefore failed with *"This site's location has not been configured yet"* even though its coordinates were saved. The parser now accepts numeric/string `latitude`/`longitude` as well; F11 proves IN and OUT now persist the log, state and session at such a site.

The run also surfaced a harness-only issue (re-initialising the Firestore SDK with different options), fixed by reusing the existing client connection.

## Blocked / not verifiable offline

- **Public guard self-enrolment** — Aadhaar encryption uses Cloud KMS and the flow needs draft-scoped Storage document references; both are unavailable in the emulator. Guard login/authentication after enrolment is proven.
- **Real FCM push** — no FCM emulator; notification documents are proven.
- **Payslips** — retired by decision (410). No salary-slip persistence exists to test.

## Gates

Web `npm test` **102 files / 687 tests**, typecheck, lint, production build pass; mobile `flutter analyze` clean + **331 tests**; acceptance suite **125 pass · 0 fail · 3 blocked**, exits 0. Mobile writes go through the same API endpoints (plus offline queue), so the API persistence evidence applies to both clients.

## Residual

- The `latitude`/`longitude` coordinate fallback now has a unit regression test.
- Field-officer visit/training report authoring is not yet in the acceptance harness; it was not part of this pass.
