# Firestore index and rules audit (15 October 2026)

## What was checked

**Indexes.** Every Firestore query in the web app and in the mobile app was
extracted and matched against `firestore.indexes.json`. The extractor follows
queries built up across statements (`let q = db.collection('x'); q = q.where(...)`)
and queries nested in `if`/`else` branches, then reports any query shape that no
declared index can serve. A query needs a composite index when it combines an
equality filter with an ordering or range on a different field; equality-only
queries are served by index merging and single-field ordering by the automatic
index, so neither was reported.

**Rules.** Every collection referenced anywhere in the codebase was compared
against the rules file, separately for collections touched by the browser
Firestore SDK and for server-only collections reached through the Admin SDK.

## Results

Two composite indexes were missing and are now declared and deployed:

| Collection | Fields | Used by |
| --- | --- | --- |
| `attendanceLogs` | `clientName` ASC, `reportedAt` DESC | `GET /api/client/attendance` (site-scoped half) |
| `attendanceLogs` | `employeeClientName` ASC, `reportedAt` DESC | `GET /api/client/attendance` (employee-scoped half) |

Both endpoints filter on the client field and sort by `reportedAt`, which cannot
be served by index merging, so each query failed with `FAILED_PRECONDITION`.

Rules changes:

* `guardLocations/{id}/locationHistory` now resolves the district from the
  parent `guardLocations` document (`officerOwnsGuardLocation`). A list rule is
  evaluated against the query, so the previous condition on the returned history
  document could never authorize the field-officer breadcrumb query.
* Direct client access is now explicitly denied for the server-only collections
  that were relying on the implicit default deny: `_diagnostics`, `appConfig`,
  `config`, `enrollmentIdentities`, `guardPinResetEvents`, `qrCodes`,
  `workOrderAssignmentEvents`, `workOrderRevisionEvents`.

No browser-accessed collection was missing rules, and no rule needed to be
loosened.

## Running the rules emulator tests

The rules integration tests are opt-in and read `FIRESTORE_EMULATOR_HOST`. They
must run under an **arm64 JDK**: the default `java` on some Macs is an x86_64
build and the emulator fails with `Bad CPU type in executable`. Each test file
uses its own demo project id, and `firebase.json` sets `singleProjectMode`, so
run them one at a time:

```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-21.jdk/Contents/Home
cd CISS

npx firebase-tools emulators:exec --only firestore --project demo-ciss-duty-rules \
  'npx vitest run src/duty-rules.emulator.test.ts'

npx firebase-tools emulators:exec --only firestore --project demo-ciss-tcs-category-rules \
  'npx vitest run src/tcs-category-rules.emulator.test.ts'

npx firebase-tools emulators:exec --only firestore --project demo-ciss-guard-location-rules \
  'npx vitest run src/guard-location-rules.emulator.test.ts'
```

### Emulator limitation

The emulator cannot serve a subcollection **list** query: a `:runQuery` with a
document `parent` hangs indefinitely, even for an owner-bypass request with no
rules involved. Because of that, the guarded breadcrumb *list* rule cannot be
exercised end to end here and is covered by the static assertion in
`src/database-config.test.ts`. The emulator tests do cover the parent-document
lookup helper on a single breadcrumb read, the district-scoped `guardLocations`
list contract the mobile live map depends on, and the duty and TCS category
rules.

## Deploying

```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project ciss-workforce
```

The release step validates the rules file before releasing it, so a syntax error
fails the deploy rather than reaching production.
