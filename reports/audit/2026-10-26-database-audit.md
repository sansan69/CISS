# CISS Workforce — Database Audit (rules · indexes · storage · live data)

**Date:** 2026-10-26
**Project:** `ciss-workforce` — Firestore `(default)`, region `asia-south1`; Storage bucket `ciss-workforce.firebasestorage.app`
**Auditor:** db-auditor (shared task `task-6`)
**Mode:** strictly read-only. No writes, no deletes, no rule/index/storage deployment, no Storage object downloads. All live figures are aggregates; the only identifiers quoted are a single test-doc id and index/collection names. No names, phone numbers, Aadhaar numbers, bank details or service-account material appear in this report.

---

## 0. Provenance: what is deployed vs what is in the working tree

Two releases were read (read-only) from the Firebase Rules API, and the deployed index list was read with the Firebase CLI. This matters because the working tree is dirty (payroll/leave retirement + security fixes).

| Artifact | Deployed? | Evidence | Consequence for this audit |
|---|---|---|---|
| `firestore.rules` | **Yes — identical to the working tree** | release `cloud.firestore` → ruleset `edd3dc41-63de-4a74-b0b1-9e5a3b33e0a0`, `updateTime 2026-10-26T12:58:16Z`; `diff deployed firestore.rules` → **no output (empty)** | Every rule statement in §2 describes **production behaviour**, including the retired-collection denies and the `validTcsCategory` guard. |
| `firestore.indexes.json` | **Yes — 138/138 in sync** | `npx firebase-tools firestore:indexes` → 138 indexes, 1 `fieldOverrides` entry (`locationHistory.expiresAt`, `ttl: true`); declared list is semantically identical (only `__name__` normalisation differs) | No index in the working tree is pending deployment. §3 is production state. |
| `storage.rules` | **No — deployed version is from 2026-08-04** | release `ciss-workforce.firebasestorage.app` → ruleset `ad3e5930-05e9-4d79-bfd4-95ffb05e5148`, `updateTime 2026-08-04T14:12:25Z`; `diff` shows **44 changed lines** (new `isStaff()` + tightened `signatures`, `attendance`, `foReports` reads) | The PII fixes for selfies/signatures exist **only in the working tree**. §4.3 lists what is live today. |

> Prior dry-run note is confirmed: the payroll/leave retirement denies **are** deployed (identical ruleset). The `tcs` (`validTcsCategory`) and storage tightening are **not** deployed for Storage; `tcs` *is* live in Firestore rules.

---

## 1. Methodology and exact commands

### 1.1 Access test (read-only ADC)

```bash
cd /Users/mymac/Documents/CISS
node --env-file=.env.local -e "
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const app = initializeApp({credential: applicationDefault(), projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID});
getFirestore(app).listCollections().then(cs => console.log(cs.map(c => c.id).join('\n')));
"
# → OK project=ciss-workforce, 47 collections listed (§8.1)
```

### 1.2 Deployed rulesets (read-only GET on the Rules API, service-account ADC)

```bash
node --env-file=.env.local -e "
const {GoogleAuth} = require('google-auth-library');
(async () => {
  const c = await (new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']})).getClient();
  const p = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const rel = await c.request({url:'https://firebaserules.googleapis.com/v1/projects/'+p+'/releases'});
  for (const r of rel.data.releases) console.log(r.name.split('/').pop(), r.rulesetName, r.updateTime);
})();"
# then: GET https://firebaserules.googleapis.com/v1/<rulesetName>  → source.files[0].content
diff -u /tmp/deployed-firestore.rules firestore.rules   # → empty
diff -u /tmp/deployed-storage.rules   storage.rules     # → 44 changed lines
```

### 1.3 Deployed indexes

```bash
npx firebase-tools firestore:indexes --project ciss-workforce > /tmp/deployed-indexes.txt
# parsed the trailing JSON object {indexes:[…],fieldOverrides:[…]} and compared field-by-field
# with firestore.indexes.json (collectionGroup + queryScope + field/order tuples)
```

### 1.4 Static analysis of client-SDK and server surfaces

```bash
# client files = files importing the browser SDK
grep -rl "from ['\"]firebase/firestore['\"]" src --include=*.ts --include=*.tsx | wc -l   # 38
# collection names referenced per client file → inventory of client-accessed collections
for f in $(grep -rl "from ['\"]firebase/firestore['\"]" src --include=*.ts --include=*.tsx | grep -v test); do
  grep -oE "(collection|collectionGroup)\([^)]*\)" "$f" | sort -u; done
# storage path builders / upload call sites
grep -rn "ref(storage\|uploadBytes\|getDownloadURL\|deleteObject" src --include=*.ts --include=*.tsx | grep -v test
# composite-query shapes (where + orderBy chains), then validated live (see 1.6)
grep -rn "\.where(\|\.orderBy(" src --include=*.ts --include=*.tsx | grep -v test
```

Client-SDK collection inventory (the only collections a browser role can reach):

| Collection | Client reads | Client writes |
|---|---|---|
| `employees` | `getDocs`, `onSnapshot`, `getDoc` | `updateDoc`, `deleteDoc` (admin UI) |
| `clients` | `getDocs`, `onSnapshot` | — |
| `sites` | `getDocs`, `onSnapshot` | `addDoc`, `updateDoc`, `deleteDoc` (admin UI) |
| `clientLocations` | `getDocs`, `onSnapshot` | `addDoc`, `updateDoc`, `deleteDoc` (admin UI) |
| `clientUsers` | `getDocs` | — |
| `workOrders` | `getDocs`, `onSnapshot` | `addDoc` (admin UI) |
| `attendanceLogs` | `getDocs`, `onSnapshot` | — (server-only writes) |
| `fieldOfficers` | `getDocs` | — |
| `guardLocations` | `onSnapshot` | — |
| `notifications` | `onSnapshot` | `updateDoc` (`read`/`readAt` only) |
| `fcmTokens` | — | `setDoc('fcmTokens/{uid}')` |

Everything else in `src` goes through server routes on the Admin SDK (which bypasses rules).

### 1.5 Live data collection (paged/full reads, aggregate-only output)

Collector scripts read whole small collections (`employees` 1,961 docs; `attendanceState` 61; `attendanceSessions` 1,701; `attendanceLogs` 3,562; `sites` 180; `clientLocations` 3; `clients` 15; `rateLimits` 12,338; `resetOtps` 2) and emitted **counts only**. Per-collection sizes were first established with server-side aggregation:

```bash
node --env-file=.env.local -e "
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const db = getFirestore(initializeApp({credential: applicationDefault(), projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}));
(async () => { for (const c of await db.listCollections()) {
  const s = await c.count().get(); console.log(c.id, s.data().count); } })();"
```

The full reproducible collector is in Appendix A.

Auth-side checks used `getAuth().listUsers(1000)` (691 users; claim **key names and role counts only**, no values) and `getUsers()` on 20 sampled `guardAuthUid` values.

### 1.6 Query-shape validation (FAILED_PRECONDITION test)

100 distinct `where`/`orderBy` shapes were statically extracted from `src` and **executed against live Firestore with `limit(1)`** on the Admin SDK (Admin queries enforce the same composite-index requirement as client queries), so an index gap shows up as a real `FAILED_PRECONDITION` rather than as a guess:

```bash
node --env-file=.env.local /tmp/audit-queries.cjs   # 100 shapes → 97 OK, 3 exceptions (§3.2)
```

### 1.7 Storage metadata

```bash
node --env-file=.env.local -e "
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getStorage} = require('firebase-admin/storage');
const b = getStorage(initializeApp({credential: applicationDefault(), projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET})).bucket();
b.getFiles({autoPaginate:true}).then(([f]) => console.log(f.length));"
# metadata only (contentType/size/timeCreated/isPublic); no object bodies were downloaded
```

---

## 2. Firestore rules — client-SDK coverage

`rules_version = '2'` with **no catch-all** block, so any path without a `match` is denied by default. That default-deny is what protects the ~37 server-only collections; it is not a substitute for an explicit deny, because a future read path added to the client SDK would fail silently at runtime.

### 2.1 Collection coverage table (client-SDK paths)

Legend — **OK**: rule matches the app's real query/role shape. **STAFF-ONLY**: correct but unreachable by client/guest roles, as designed. **DENIED BY DESIGN**: explicit `if false`, Admin-SDK only. **MISCONFIGURED**: rule cannot ever pass for the role that needs it. **DEAD BRANCH**: a condition that is permanently false.

| Collection | Client ops (from §1.4) | Read rule (as written) | Write rule | Verdict |
|---|---|---|---|---|
| `employees` | list/get, update, delete | `readStateMatches() && (isAdmin \|\| isHR \|\| isAccounts \|\| isCompliance \|\| isFieldOfficerForEmployee() \|\| guard-own \|\| isOwnClientDoc('clientName'))` | create/delete `isAdmin`; update `isAdmin` + `validTcsCategory` | **OK** for staff + client (client filter `where('clientName','==',claim)` exists on `/employees`). **Over-exposes PII to clients (H4)**. `guard-own` branch unreachable in practice (guards use APIs). |
| `clients` | list (`orderBy name`), onSnapshot | `readStateMatches() && (isStaff() \|\| isOwnClientDoc('companyName') \|\| (isGuard() && guardAssignedSiteId() != null))` | `isAdmin` | **MISCONFIGURED (H1)** — clients docs have **no `companyName`** field (0/15), and **no user holds an `assignedSiteId` claim** (0/691). Client-role users have **no read path** to `clients`. |
| `sites` | list (`__name__ in`, unfiltered), onSnapshot | `readStateMatches() && (isStaff() \|\| isOwnClientDoc('clientName') \|\| (isGuard() && resource.data.siteId == guardAssignedSiteId()))` | `isAdmin` | **MISCONFIGURED (H2+H3)** — guard branch dead (no claim) and type-broken (`siteId` is `number` on 109/180 sites, `string` on 61). Client-role `where('__name__','in',…)` site lookups (§3.4) are **denied** because no `clientName` constraint is provable. Staff list OK. |
| `clientLocations` | list, addDoc/updateDoc/deleteDoc | `readStateMatches() && (isStaff() \|\| isOwnClientDoc('clientName') \|\| (isGuard() && guardAssignedSiteId() != null))` | `isAdmin` | **DEAD BRANCH (H2)** for guards; staff/client-name paths OK. |
| `clientUsers` | getDocs | `readStateMatches() && (isAdmin() \|\| own uid)` | `isAdmin` | **OK** (admin settings page only). |
| `workOrders` | list/onSnapshot, addDoc | `readStateMatches() && (isAdmin \|\| isFieldOfficerForDistrict(district) \|\| isOwnClientDoc('clientName'))` | `isAdmin` | **OK** — FO query `where('district','in',…)`, client query `where('clientName','==',claim)`; both provable, indexes present. |
| `attendanceLogs` | list/onSnapshot (admin, FO, client) | `readStateMatches() && (isAdmin \|\| isFieldOfficerForDistrict(district) \|\| isOwnClientDoc('clientName'\|'siteClientName'\|'employeeClientName') \|\| guard-own)` | create **`false`** (server-only); update/delete `isAdmin` | **OK**; indexes for all five shapes are deployed (§3.2). `create: false` is correct — the submit/upload routes write via Admin SDK. |
| `fieldOfficers` | getDocs (admin tab only) | `readStateMatches() && (isAdmin() \|\| resource.data.uid == uid)` | `isAdmin` | **OK** — the unfiltered `getDocs(collection(db,'fieldOfficers'))` sits behind `canAdminWorkOrders` (`work-orders/page.tsx:1589`). |
| `guardLocations` | onSnapshot (`status=='In'` + scope filter) | `readStateMatches() && (admin/hr/accounts/compliance \|\| FO-district \|\| client-own \|\| guard-own)` | create/update/delete **`false`** | **OK** — server-only writes; `status+clientName`, `status+district+clientName` indexes deployed. |
| `notifications` | onSnapshot (`recipientUid==uid`, `orderBy createdAt desc`, `limit 20`), updateDoc(`read`,`readAt`) | `readStateMatches() && (isAdmin \|\| resource.data.recipientUid == uid)` | create `isAdmin` and no `dutyEvent`; self-update limited to `['read','readAt']` | **OK**. |
| `fcmTokens` | `setDoc('fcmTokens/{uid}', {uid,token,platform,updatedAt}, merge)` | `isAdmin()` | self, `keys().hasOnly(['uid','token','platform','createdAt','updatedAt'])`, `uid == auth.uid` | **OK** — merge payload produces exactly the allow-listed keys. Read is admin-only (for targeted push). |
| `users` | none in current code | self or admin | self-create with field allowlist (no `role`), self-update minus `role/employeeDocId/employeeId/admin` | **OK**, but the collection **does not exist live** (0 docs) — dead surface. |
| `attendanceState` | none (API-owned) | `readStateMatches() && (isAdmin \|\| guard-own)` | `isAdmin` | **OK**. |
| `attendanceSessions` | none (API-owned) | `readStateMatches() && (isStaff \|\| guard-own)` | `isAdmin` | **OK**. |
| `attendanceStates` (legacy plural) | none | `isAdmin \|\| guard-own` | **create/update: `isAdmin` OR guard-own, any fields** | **RETIRED, NOT DENIED (M14)** — no code reads or writes it, and the collection does not exist, yet guards may create arbitrary documents there. Should be `if false` like the other retired collections. |
| `payrollEntries`, `leaveRequests`, `leaveBalances`, `complianceSettings`, `clientWageConfig`, `salaryStructures`, `employeeSalaries`, `payrollCycles`, `trainingModules`, `questionBanks`(+`questions`), `quizAttempts`, `trainingAssignments`, `evaluations`, `guardScores`, `awards`, `resetOtps`, `dutyWillingness`, `dutyRequests`, `guardAssignments`, `guardAssignmentSlots`, `foVisitReports`, `foTrainingReports`, `foReportEvents`, `workOrderImports`, `enrollments`, `employeeIds`, `enrollmentIdentities`, `guardPinResetEvents`, `rateLimits`, `regionConnections`, `roleClaimRepairAudit`, `clientUserAudit`, `fieldOfficerAudit`, `guardPatrolActivities`, `incidents`, `notificationReadStates`, `regionAutomationJobs`, `branchExpenses`, `systemConfig`, `_diagnostics`, `appConfig`, `config`, `qrCodes`, `workOrderAssignmentEvents`, `workOrderRevisionEvents`, `sensitiveDocumentAuditLogs`, `employeeAadhaarPrivate`, `employees/*/{consents,documents,aadhaarCorrectionRequests}` | — | **`allow read, write: if false`** | — | **DENIED BY DESIGN (server-only via Admin SDK)** — verified correct; matches the retirement + hardening intent. |
| `systemMetrics`, `exportJobs` | — | `isAdmin` | `isAdmin` | **STAFF-ONLY, over-broad for a client-SDK path but no client usage.** |
| `districts`, `states` | — | **`if true`** (unauthenticated) | superAdmin/admin | Public reference data — intended; contains no PII (verified by schema: districts/states are reference lists). |
| `enrollmentFormConfig` | — | **`if true`** | admin/superAdmin | Public form schema — intended; no PII. |
| `branches`, `regions`, `regionOnboardingAudit`, `regionSetupProgress` | — | signed-in / superAdmin | superAdmin/admin | **STAFF-ONLY**, no client usage. |
| `neetPgAssignments`, `tcsQualificationRequirementRuns`, `adminRoleAudit`, `employeeAccessAudit`, `clientEnrollmentProfileRepairRuns`, `employeeDocumentRepairRuns`, `_codexChecks` | — | **no `match` block at all** | default deny | **Server-only in practice, but undocumented**: these 7 live collections rely on default-deny. Add explicit `if false` blocks so the intent survives refactors (L8). |

### 2.2 Broken / permanently-false rule branches (with evidence)

**H1 — `clients` client-user branch reads a field that does not exist.**
`firestore.rules:256` → `isOwnClientDoc('companyName')` → `resource.data['companyName'] is string && …`.
Live: `clients` has **15 docs, 0 of which have a `companyName` field** (the document key is `name`, confirmed by field enumeration). `companyName` appears **nowhere** in `src/`. Consequence: the single `client`-role account (691-user Auth census: role `client` ×1) and any future client user **cannot read `clients` at all** — including the `useClients()` hook used by `/employees` (`clientVisible: true` in `navigation.ts:49`). Fix: `isOwnClientDoc('name')`.

**H2 — `guardAssignedSiteId()` claim is never issued.**
`firestore.rules:40-42, 257, 265, 273`. Auth enumeration of all **691** users shows claim-key sets:
`guard :: employeeDocId,employeeId,role` (253), `guard :: clientId,clientName,district,employeeDocId,employeeId,role` (25), `fieldOfficer :: assignedDistricts,role[,stateCode]` (8), `client :: clientId,clientName,role,stateCode` (1), `admin :: admin,role,stateCode` (1), `superAdmin :: admin,role,stateCode,superAdmin` (1), no-claims (401+1), `admin`+`superAdmin` (1 each).
**No user has `assignedSiteId`** → every guard clause predicated on `guardAssignedSiteId() != null` (`clients`, `sites`, `clientLocations`) is permanently false. Fix: delete the branches (guards get site data through the signed-in server routes) or start issuing the claim in `setCustomClaims` (`src/app/api/guard/auth/setup-pin/route.ts:257`).

**H3 — `sites` guard branch is also type-broken.**
`firestore.rules:265` compares `resource.data.siteId == guardAssignedSiteId()`. Live `sites.siteId` types: **number 109, string 61, absent 10** (out of 180). A string claim would only ever match the 61 string documents; a numeric claim only the 109 numeric ones. There is no cardinally consistent identity for `siteId` in this collection — it is used as a *site code* (`buildSiteCodeDistrictKey(siteId, district)` in the work-order import) while the Firestore document id is the join key everywhere else. Fix: compare `siteId` (doc id) against the claim, and normalise `sites.siteId` to string.

### 2.3 Over-permissive rules

**H4 — `employees` read for client users returns the whole PII record.**
`firestore.rules:215` allows `isOwnClientDoc('clientName')`, i.e. any `client`-role user reads **full** employee docs for their client. Those docs contain `bankAccountNumber`, `ifscCode`, `bankName`, `panNumber`, `pfUan`/`esicNumber`, `fullAddress`, `phoneNumber`, `signatureUrl`, `bankPassbookStatementUrl`, `guardPin` (hash). A client is an external party (15 client organisations); bank/PAN/Aadhaar-adjacent data is not needed for the client portal (names, photo, deployment site, attendance). Fix: keep `employees` staff-only and add a server route (`/api/client/guards`) projecting an allow-listed field set, or a `clients/{clientId}/guards/{id}` projection collection.

**H5 — guard PIN hashes sit in a widely readable document.**
`employees.guardPin` is stored on the employee doc: **276 docs have it**; format distribution is `81` chars ×273 and `129` chars ×3 (a salted hash — **no plaintext 4-6 digit PINs were found**, good). But a PIN space of 4–6 digits is ≤10⁶ candidates, and the hash is readable by admin/HR/accounts/compliance, by FOs for their districts, and by client users (H4). Offline brute force is minutes of work → guard-account takeover. Fix: move `guardPin`/`guardPinSetAt`/`guardFailedAttempts` to a server-only collection (same pattern as `employeeAadhaarPrivate`, `allow read, write: if false`) and keep only a boolean `hasGuardPin` on `employees`.

**M-rule — `systemMetrics`/`exportJobs` are admin read/write via client SDK.** No client code uses them today; if a read path is ever added, these are internal telemetry. Low risk, noted for completeness.

### 2.4 Server-only collections (admin SDK only, explicit deny)

`employeeAadhaarPrivate` (1,646 docs), `sensitiveDocumentAuditLogs` (2,967), `employeeIds` (1,947), `enrollments` (203), `enrollmentIdentities` (20), `payrollCycles` (4), `employeeSalaries` (4), `salaryStructures` (1), `clientWageConfig` (1), `foVisitReports` (7), `foTrainingReports` (4), `foReportEvents` (15), `rateLimits` (12,338), `resetOtps` (2), `guardPinResetEvents` (15), `workOrderImports` (146), `workOrderAssignmentEvents` (1,404), `workOrderRevisionEvents` (4), `fieldOfficerAudit` (1), `roleClaimRepairAudit` (1), `regionOnboardingAudit` (17), `guardPatrolActivities`, `dutyRequests` (133), `notifications` create, `attendanceLogs` create. These are correct and must stay `if false`.

---

## 3. Indexes

### 3.1 Declared vs deployed

* Declared: **138** composite indexes, 1 field override (`locationHistory.expiresAt` → `ttl: true`).
* Deployed: **138** composite indexes, same override.
* Diff (after `__name__` normalisation): **none**. The 151-line uncommitted addition to `firestore.indexes.json` (`guardAssignments` ×2, `dutyWillingness`, `notifications recipientUid+pushStatus+createdAt`, `attendanceLogs` ×4 incl. `district+attendanceDate`, `clientName+reportedAt`) **is already deployed**.

**No index in this repository is pending deployment, so nothing fails today for a "forgot to deploy indexes" reason.**

### 3.2 Live-validated query shapes (100 tested, 3 exceptions)

| # | Query shape (from source) | Live result | Assessment |
|---|---|---|---|
| 1 | `attendanceLogs` where `date >=` & `date <=` & `clientId ==` — `src/app/api/admin/data-export/route.ts:29-48` | **FAILED_PRECONDITION: The query requires an index** | **Real bug (H6)** — see below. |
| 2 | `foTrainingReports` where `clientId`/`fieldOfficerId`/`stateCode` + `orderBy createdAt desc` — `src/app/api/admin/training-reports/route.ts:69` | `INVALID_ARGUMENT: order by clause cannot contain duplicate fields createdAt` | **Analysis artefact** — my extractor concatenated the three mutually exclusive branches (`where clientId` … `or where fieldOfficerId` … `or where stateCode`) into one shape. Run individually all three pass (indexes `clientId+createdAt desc`, `fieldOfficerId+createdAt desc`, `stateCode+createdAt desc` are all declared and deployed). |
| 3 | `foVisitReports` — same pattern, `src/app/api/admin/visit-reports/route.ts:96` | same artefact | Same conclusion. |

The other **97** distinct shapes (employees list/search/orderBy variants, attendanceLogs ×11 at all role scopes, workOrders ×4, sites ×5, guardLocations ×5, notifications ×2, clientLocations ×3, fieldOfficers, workOrderTodos, evaluations, payrollEntries, trainingAssignments, guardScores) executed successfully against live Firestore → **no other missing index**.

**H6 detail — `/api/admin/data-export` (attendance + employees) is broken twice over.**
`route.ts:29-48` filters `attendanceLogs` on `date` and `clientId`. Neither field exists in `attendanceLogs` (the collection uses `attendanceDate` (string `YYYY-MM-DD`) and `clientName`; live check: `date`/`clientId` present on 0 docs). `route.ts:59` filters `employees` on `clientId`, which **1,807 of 1,961** employees lack (only 154 have it — hence the `employees :: clientId+status` index is nearly dead). Consequences:
* `type=attendance` without `clientId` → runs, returns **0 rows** (silently empty export).
* `type=attendance` **with** `clientId` → **HTTP 500 / FAILED_PRECONDITION** (the index for `date+clientId` does not exist and never will, because the fields are wrong).
* `type=employees` with `clientId` → returns only the 154 docs that carry the field.

Fix: use `attendanceDate` (range) and `clientName`/`employeeClientName` (equality) in the export route — `(clientName, attendanceDate)` and `(employeeClientName, attendanceDate)` indexes already exist; or, if `clientId` is genuinely wanted, backfill `clientId` on `employees`/`attendanceLogs` first and then add `(clientId, attendanceDate)`.

### 3.3 Retained indexes for retired collections

Payroll and leave were retired in this working tree (`src/app/(app)/payroll/**` and guard payslips deleted, `/api/admin/payroll/*` retired). Their indexes are still deployed:

| Collection | Indexes | Live docs | Note |
|---|---|---|---|
| `payrollEntries` | 7 (`cycleId+employeeName`, `employeeDocId+period desc`, `employeeId+period desc`, `period+employeeName`, `cycleId+employeeId`, `employeeDocId/employeeId+createdAt desc`) | **collection does not exist** | Retain only if payroll data must be queried for historical payslips; otherwise remove on the next indexes release to cut write amplification. No data loss risk — dropping an index does not delete documents. |
| `leaveRequests` | 2 (`employeeDocId+createdAt desc`, `employeeId+createdAt desc`) | **collection does not exist** | Same. |
| `evaluations` (7), `trainingAssignments` (4), `questionBanks` (1), `quizAttempts` (1), `guardScores` (3), `workOrderTodos` (7), `regionAutomationJobs` (2), `dutyWillingness` (1), `guardAssignments` (2) | 28 indexes | **all zero docs** | Features present in code/rules but never used in production; indexes are idle (no cost if no writes, but they are the classic source of accidental future drift). |

### 3.4 Index/query gaps that are *not* FAILED_PRECONDITION but wrong

* `sites` client-role lookups use `where('__name__','in',chunk)` (`work-orders/page.tsx:467`) and one admin import path uses an unfiltered `getDocs(collection(db,'sites'))` (`:790`). The `__name__`-only query is **rejected for client-role users** (rule needs a provable `clientName` constraint) → the client's work-order site-district map is empty (caught and logged in the UI).
* `rateLimits`: **12,338 docs, 11,488 older than 7 days, 63 with no `windowStart`**, oldest `2026-06-01`. No TTL policy exists on this collection (only `locationHistory.expiresAt` has `ttl: true`). See M2.
* `resetOtps`: `expiresAt` and `createdAt` are **strings**, not timestamps → a Firestore TTL policy **cannot** be applied; both existing docs are already expired. See M3.

---

## 4. Storage

Bucket `ciss-workforce.firebasestorage.app`. **22,032 objects / 3.95 GB**, 57 objects ≥5 MB, 0 objects without `contentType`. No object body was downloaded.

### 4.1 Path → rule → verdict

Key observation: the `{employeeKey}` segment is **inconsistent in source** — admin edits write `employees/{phoneNumber}/{folder}/…` (`employees/[id]/page.tsx:1050-1058`, `employees/enroll/page.tsx:316`) while attendance writes `employees/{employeeDocId}/attendance/…` (`api/attendance/submit/route.ts:465`, `api/public/attendance/upload/route.ts:77`). The rules use a wildcard `{employeeKey}`, so both work today — but **any future per-employee tightening must account for both key types**.

| Path prefix | Live objects | Rule (working tree) | Rule **deployed today** | Verdict |
|---|---|---|---|---|
| `employees/*/profilePictures/*` | 1,680 | read `isSignedIn`; write `isAdmin` + `<5MB` + `image/*` | same | **OK** (profile photo is intrinsically public-to-staff); SVG admitted by `image/.*` → L6 |
| `employees/*/signatures/*` | 1,345 | read **`isStaff()`**; write `isAdmin` + `<5MB` + `image/*` | read **`isSignedIn()`** | **Deployed: CRITICAL (C1)** — every guard/client account can read any employee's signature image. Working tree fixes it; not deployed. Also 6 objects are `application/pdf` and 1 `image/heic`, violating the `isImage()` write rule (proves server-side Admin writes bypass it) — M6. |
| `employees/*/attendance/*` | 7,255 | read **`isStaff()`**; create **`false`**; update `isAdmin` + `<15MB` + `image/*` | read **`isSignedIn()`** | **Deployed: CRITICAL (C1)** — 7,255 attendance selfies readable by any of the 691 authenticated accounts (278 guards, 8 field officers, admin/superAdmin, 1 client, 401 no-claim accounts). Working tree fixes to staff-only; not deployed. |
| `employees/*/idProofs`, `addressProofs`, `serviceBooks`, `armsLicenses`, `panCards`, `passports`, `bankDocuments`, `policeCertificates`, `qualificationCertificates` | 1,726 / 1,730 / 155 / 14 / 16 / 0 / 1,202 / 117 / 18 | read `isAdmin`; write `isAdmin` + `<5MB` + (`image/*` or `application/pdf`) | same | **OK**. Note `addressProofs`/`bankDocuments` hold identity+bank documents but are admin-only. |
| `employees/*/aadharCards/*` | 0 | `read, write: if false` | same | **OK** (Aadhaar lives in `restrictedEmployeeAadhaar`, server-only). |
| `enrollments/*/{profilePictures,signatures,idProofs,addressProofs,serviceBooks,armsLicenses,panCards,passports,bankDocuments,policeCertificates,qualificationCertificates}` | 3,554 total (1,025 address, 775 id, 647 profile, 580 signatures, 335 bank, 171 qualification…) | read `isAdmin`; **create/update `false`**; delete `isAdmin` | same | **OK** — uploads only via `/api/public/enroll/upload` (Admin SDK). |
| `enrollments/*/aadharCards/*` | 0 | `if false` | same | **OK**. |
| `restrictedEmployeeAadhaar/*` | 3,189 | `match /restrictedEmployeeAadhaar/{employeeId}/{fileName}` → `if false` | same | **Covered, but the match never fires**: live objects are flat `restrictedEmployeeAadhaar/{uuid}.jpg` (one segment). Access is still denied by the catch-all. Cosmetic/schema mismatch — M12. |
| `restrictedAadhaarStaging/*` | 15 | `match /restrictedAadhaarStaging/{uid}/{fileName}` → `if false` | same | Same mismatch (live: `{uuid}.png` flat, staging leftovers retained — M12). |
| `restrictedEmployeeConsent/*` | 5 | `if false` | same | **OK** (flat layout, same caveat). |
| `foReports/{reportType}/{uid}/{reportId}/{file}` | 9 | read `isAdmin` **or `isFieldOfficer() && auth.uid == uid`**; create FO-own + metadata binding; delete only while report is draft | read **`isAdmin() \|\| isFieldOfficer()`** (any FO reads any FO) | **Deployed: MEDIUM (L1)** — cross-officer evidence read. Fixed in working tree, not deployed. |
| `foReports/{folder}/{uid}/{file}` (legacy 4-segment) | — | read admin or FO-own; write admin/FO-own | same | **OK**. |
| `trainingModules/*` | 0 | read `isSignedIn`; write `isAdmin` + `<100MB` + office/PDF types | same | **OK**. |
| `releases/*`, `codex-test/*`, any other prefix | 1 + 1 | **no rule → catch-all `allow read, write: if false`** | same | **Denied, private ACL** (verified `isPublic() === false` for both). `releases/ciss-workforce.apk` (74 MB, 2026-05, contentType `application/vnd.android.package-archive`) and `codex-test/lng-drive-sample.jpg` (Apr 2026) are **orphans** — the live APK is served by `/api/public/download/android` from `src/lib/android-release.ts`, not from this object. L3. |

### 4.2 Live sample statistics

* `employees/` — 15,258 objects: `attendance` 7,255 · `addressProofs` 1,730 · `idProofs` 1,726 · `profilePictures` 1,680 · `signatures` 1,345 · `bankDocuments` 1,202 · `serviceBooks` 155 · `policeCertificates` 117 · `qualificationCertificates` 18 · `panCards` 16 · `armsLicenses` 14.
* Content types (folder-level sample of the first 5,000 `employees/` objects): `image/jpeg` dominant; `image/webp` a minority; `application/pdf` in addressProofs 7, idProofs 15, bankDocuments 20, signatures 6, policeCertificates 8, qualificationCertificates 1; `application/octet-stream` 4–8 per folder (server-side uploads without a content type); **no `image/svg+xml`, no `text/html`, no JS** anywhere.
* Size: 57 objects ≥5 MB, including 6.7 MB `addressProofs/pan-front.jpg`, 5.8 MB `profilePictures/profile.jpg`, 6.0 MB `signatures/signature.jpg`, 5.3 MB `bankDocuments/passbook.jpg` — all above the 5 MB rule cap ⇒ written through the Admin SDK (M6). Largest bucket-relative risk is that phone-camera selfies run 5–15 MB while the selfie rule allows <15 MB and the admin-edit rule allows <5 MB.
* ACL: sampled objects (`addressProofs/*`, `idProofs/*`, `releases/*`, `codex-test/*`) return `isPublic() === false`. No object is public; access is via rules or signed URLs only.
* Orphans: 7,255 `employees/*/attendance/*` objects vs **1,928** `attendanceLogs` docs carrying `photoStoragePath` (1,634 logs have none) → **≥5,000 selfies have no referencing log** (failed submissions, reset states, retried uploads). Storage cost + PII-retention hygiene (M5).

### 4.3 What is live for Storage right now (opposite direction of §4.1)

Because the deployed `storage.rules` predates the working-tree hardening, **today** these reads succeed for **any authenticated user** — the 691-account Auth census here (278 `guard`, 8 `fieldOfficer`, 1 `admin`, 1 `superAdmin`, 1 `client`, 402 without a role claim):
`employees/*/signatures/*` (1,345 objects) and `employees/*/attendance/*` (7,255 objects) — see C1. The working tree already contains the fix (`read: if isStaff()`), so the remedy is a `firebase deploy --only storage:rules` by the owner — **not performed by this audit**.

---

## 5. Live data invariants

Method: full/paged document reads, aggregation in memory, counts only. Severity: **C**ritical / **H**igh / **M**edium / **L**ow.

### 5.1 `employees` (1,961 docs)

| Check | Result | Severity | Concrete fix |
|---|---|---|---|
| Count / status distribution | **1,961** — Active **1,905**, Exited **25**, PendingReview **31** | — | — |
| Missing `clientName` | **0** | — | — |
| Missing `district` | **0** | — | — |
| Missing `stateCode` | **1,188** (60.6%) | M7 | If the multi-state helper must be provable for list queries, backfill `stateCode` (or relax the helper — see M7). Kerala-only rollout is fine today. |
| Missing `clientId` | **1,807** (92.2%) | L2 / H6 | Backfill from `clients` name→id, or drop the `clientId` filters in `data-export`. |
| Missing `joiningDate` | **2** | L | Curate the two docs. |
| Missing `phoneNumber` | **0** | — | — |
| Duplicate `employeeId` (normalised, alnum/upper) | **0 groups** | — | — |
| Duplicate `phoneNumber` (last-10 digits) | **0 groups** | — | — |
| Duplicate `resourceIdNumber` | **0 groups** | — | — |
| Guards with credentials | `guardAuthUid` present on **276**; `guardPin` present on **276**; **0** with a UID but no PIN | — | — |
| **Active employees with no `guardAuthUid`** | **1,630 of 1,905 (85.6%)** — only 275 Active records can use the guard app | H (operational) | Either these are non-guard staff (no employee "type" field exists to tell them apart — add one) or guard onboarding is incomplete. Add a `role`/`category` field so "guard coverage" is measurable, then provision the rest. |
| Plaintext PINs | **0** — formats 81 chars ×273, 129 chars ×3 (hashed) | — | Good. Still see H5 for hash exposure. |
| `clientName` values not present in `clients` | **4 distinct client names** | M11 | Reconcile the 4 orphan labels to the 15 registry names (or add the missing clients); otherwise client-role users of those names see nothing. |

### 5.2 `attendanceState` (61 docs)

| Check | Result | Severity | Fix |
|---|---|---|---|
| Docs whose employee doc is missing | **1** — `dummyAttendanceEmp1776435824` (id echoed for evidence; it is a test record, no PII) | M4 | Delete after owner approval (never delete silently); add a server-side existence check in the submit route. |
| `lastStatus` outside `In`/`Out` | **0** (`Out` 57, `In` 4) | — | — |
| `openSessionId` → missing `attendanceSessions` doc | **0 dangling** (4 docs carry `openSessionId`, all resolve) | — | — |
| Stale open sessions (>48h) | **0** | — | — |

### 5.3 `attendanceSessions` (1,701 docs)

| Check | Result | Severity | Fix |
|---|---|---|---|
| Status distribution | `closed` **1,697**, `open` **4** | — | — |
| Open sessions older than 48 h | **0** | — | — |
| Missing `employeeDocId` / `siteId` / `attendanceDate` | **0 / 0 / 0** | — | — |
| Closed sessions without `outLogId` | **6** | L5 | Backfill from `attendanceLogs` by `attendanceSessionId`, or flag for review. |

### 5.4 `attendanceLogs` (3,562 docs; 638 in the last 30 days, cutoff `2026-09-26`)

| Check | Result | Severity | Fix |
|---|---|---|---|
| Last 30 days by status | `In` **321** / `Out` **317** | — | — |
| Missing `siteId` | **0** | — | — |
| Missing `photoStoragePath` | **1,634 (45.9%)** — includes all logs older than the photo-upload rollout | M (retention/GPS evidence gap) | Decide the retention policy: either backfill from Storage paths or record `photoStoragePath: null` explicitly and document that pre-rollout logs have no selfie. |
| Missing `district` | **291 (8.2%)** | M10 | Backfill from `sites.district` via `siteId`; without `district` these logs are invisible to field-officer district-scoped lists and to `isFieldOfficerForDistrict()`. |
| Missing `clientName` | **3** | L | Backfill from the site. |
| Duplicate `processedClientRequestId` | **0 groups** (idempotency holds) | — | — |
| Submissions where `submittedByUid` ≠ subject's `guardAuthUid` | **0 mismatches — but 638/638 recent logs have `submittedByUid: null`** | **H (M1)** | Attribution is absent, so "assisted/anonymous submission" is undetectable: a receptionist phone submitting for a guard leaves no trace. The submit route already knows the caller — persist `submittedByUid` + `submittedByRole` (fields exist and are null everywhere) and alarm when they are null for new writes. |

### 5.5 `sites` (180) / `clientLocations` (3) / `clients` (15)

| Check | Result | Severity | Fix |
|---|---|---|---|
| `sites` missing `geolocation` | **17** | M8 | Geocode (the page has a coordinate-status field: `coordinateStatus`), else geofence validation silently degrades for those sites. |
| `sites` missing `latString`/`lngString` | **18** | M8 | Same. |
| `sites` `siteId` type | **number 109 / string 61 / absent 10** | M13 / H3 | Normalise to string (site code) and stop using it as an identity; the doc id is the identity. |
| `sites` duplicate `clientName+siteName` | **0** | — | — |
| `sites` missing `clientName`/`district`/`siteName` | **0 / 0 / 0** | — | — |
| `clientLocations` missing `geofenceRadiusMeters` | **2 of 3** (`undefined`; the third is `150`) | M9 | Set explicit radii; the strict-geofence path should refuse to run on a missing radius instead of falling back. |
| `clientLocations` missing `geolocation` / `clientName` | **0 / 0** | — | — |
| `clients` normalised duplicate names | **0 groups** | — | — |
| `clients` docs with `companyName` | **0** | H1 | Rule references a non-existent field. |

### 5.6 TTL / hygiene

| Collection | Docs | Result | Severity | Fix |
|---|---|---|---|---|
| `rateLimits` | **12,338** | `<1h` 20 · `1–24h` 84 · `1–7d` 683 · **`>7d` 11,488 (93%)** · no `windowStart` **63**; oldest `2026-06-01` | **M2** | Add a TTL policy on `windowStart` (indexes/fieldOverrides, `ttl: true`) and let Firestore expire them; clean the 63 malformed docs with an owner-approved script. Rate-limit windows are meaningless after an hour, so this is pure cost. |
| `resetOtps` | **2** | both expired; `expiresAt`/`createdAt` are **strings** | M3 | Store Timestamps and add a TTL policy; until then, expiry is enforced only by application code. |
| `sensitiveDocumentAuditLogs` | 2,967 | no TTL — intended (audit) | — | Keep; consider an archive policy. |
| `locationHistory` (`expiresAt`) | — | TTL **configured and deployed** | — | Good — the one place TTL is set correctly. |

### 5.7 Auth-side samples

| Check | Result | Severity |
|---|---|---|
| Auth users | **691**: no role **402**, `guard` **278**, `fieldOfficer` **8**, `client` **1**, `admin` **1**, `superAdmin` **1** | — |
| Guard `guardAuthUid` → existing Auth user | sample of **20** → **20 found, 0 not found** | — |
| `assignedSiteId` claim | **0 users** (see H2) | H2 |
| `stateCode` claim holders | 8 (5 FO, 1 client, 1 admin, 1 superAdmin) | M7 |
| Employee docs with guard credentials vs guard Auth accounts | 276 vs 278 (2 Auth accounts without a matching employee `guardAuthUid`) | L | Reconcile orphan guard accounts. |

---

## 6. Verdict

**Not "everything works".** Client-SDK reads/writes for the staff surface (employees, sites, clients, workOrders, attendanceLogs, notifications, fieldOfficers, clientLocations, guardLocations, fcmTokens) are rule-covered, index-backed and live-verified — 97 of 100 extracted query shapes pass against production. The failures are specific and listed below, ranked.

### Critical

1. **C1 — Live Storage rules expose attendance selfies and signatures to every authenticated user** (`1,345` signature + `7,255` selfie objects). Deployed ruleset `ad3e5930…` (2026-08-04) has `read: if isSignedIn()` for `employees/*/signatures/*` and `employees/*/attendance/*`; the working tree already has `read: if isStaff()` but it is **not deployed**. Every guard account (`{phone}@guard.cisskerala.app`, 278 accounts) can enumerate and read any colleague's selfie/signature. Fix = deploy `storage.rules` (owner action; this audit deployed nothing).

### High

2. **H1 — `clients` unreadable by the client role** (`isOwnClientDoc('companyName')` vs a `name` field that exists on 15/15 docs, `companyName` on 0). Client users get no client list; `useClients()` on the `clientVisible` Employees page is denied.
3. **H4 — Client users can read full employee PII** (bank account, IFSC, PAN, PF/ESIC, address, signature URL, PIN hash) for their own client's guards — external-party exposure of data the portal does not need.
4. **H5 — `guardPin` hashes are stored on broadly readable `employees` docs** (276 docs, hashed 81/129 chars). A 4–6-digit PIN space is brute-forceable offline in minutes → guard account takeover.
5. **H6 — `/api/admin/data-export` is broken**: `attendance`/`employees` exports filter on `date` and `clientId`, which exist on 0 and 154 of 1,961 docs respectively; with `clientId` the attendance export throws **FAILED_PRECONDITION (500)**, without it, it returns an empty CSV.
6. **H2/H3 — Guard site-scoping rules are dead and type-broken**: no user carries `assignedSiteId` (0/691), and `sites.siteId` is `number` on 109/180 docs, so even with the claim the comparison cannot match.
7. **M1 (ranked High) — Attendance submission is unattributed**: `submittedByUid` is `null` on 638/638 logs from the last 30 days, so assisted/proxy submission cannot be detected.

### Medium

8. **M2 — `rateLimits` has no TTL**: 12,338 docs, 11,488 older than 7 days, 63 malformed.
9. **M3 — `resetOtps` uses string timestamps** → TTL impossible; 2 expired docs retained.
10. **M5 — ~5,000+ orphaned attendance selfies** in Storage (7,255 objects vs 1,928 referencing logs) — cost + unbounded PII retention.
11. **M6 — 57 objects ≥5 MB** violate the 5 MB rule cap (and 7 signature objects are PDFs/HEIC, not `image/*`); enforcement exists only in rules, not in the Admin-SDK write paths.
12. **M7 — Multi-state helper may deny list queries for the 8 users carrying `stateCode`** (`readStateMatches()` reads `resource.data` in a `list` rule; 1,188 employees and all sites/clients/logs lack `stateCode`). See §7 — needs a role-level test to confirm.
13. **M8 — 17 sites have no geolocation, 18 lack `latString`/`lngString`** → geofence validation cannot run there.
14. **M9 — 2 of 3 `clientLocations` have no `geofenceRadiusMeters`.**
15. **M10 — 291 attendance logs have no `district`** → invisible to field-officer district scoping.
16. **M11 — 4 employee `clientName` values are not in the `clients` registry.**
17. **M13 — `sites.siteId` type drift** (number/string/absent) breaks site-code joins in work-order import.
18. **M14 — retired `attendanceStates` collection is guard-writable** (no code reads/writes it; should be `if false`).
19. **L1 — Deployed `foReports` read lets any field officer read every officer's evidence** (working tree restricts to own `uid`; not deployed).
20. **L2 — `clientId` exists on only 154/1,961 employees** (92% missing) — every `clientId`-based filter/report silently under-reports.
21. **L3 — orphan/leftover objects** `releases/ciss-workforce.apk` (74 MB) and `codex-test/lng-drive-sample.jpg` in the production bucket, unreachable by rules, private ACL.
22. **L5 — 6 closed `attendanceSessions` have no `outLogId`.**
23. **L6 — `image/.*` admits `image/svg+xml`** for the admin-only profile/signature/selfie writes.
24. **L7 — 9 indexes are retained for retired payroll/leave collections and ~28 for collections with 0 documents** (§3.3).
25. **L8 — 7 live collections have no explicit `match` block** (`neetPgAssignments`, `tcsQualificationRequirementRuns`, `adminRoleAudit`, `employeeAccessAudit`, `clientEnrollmentProfileRepairRuns`, `employeeDocumentRepairRuns`, `_codexChecks`) and depend on default-deny.

---

## 7. Could not verify

1. **Per-role list-query behaviour under `readStateMatches()` (M7).** Firestore evaluates a `list` rule against the *query*, not each document; `'stateCode' in resource.data` is not provable from a query, so for the 8 users whose token carries `stateCode` the expression is unknown unless Firestore treats a missing `resource.data` presence check as `false`. The app has run in production with these rules since 2026-08-01, which suggests the permissive path, but I could not test it: it needs a Firestore-emulator run with per-role tokens (`@firebase/rules-unit-testing`), which is not installed here and would require downloading the emulator. Everything downstream of that assumption (whether FOs/admins with `stateCode` can still list `employees`, `sites`, `clients`, `attendanceLogs`) is therefore **unconfirmed**. A deliberately simple rewrite removes the doubt: replace the presence check with `resource.data.get('stateCode', null) == null || …`-style semantics (`resource.data.stateCode == null || resource.data.stateCode == userStateCode() || isSuperAdmin()`), which is provable and equivalent.
2. **Client-SDK acceptance of every rule-branch combination.** I verified rule text, fields and queries statically, and executed all query shapes on the Admin SDK, but I did not sign in as a guard/FO/client account to observe allow/deny outcomes (no test credentials were created — that would be a write). The specific unproven assertions are: client-role list queries with a `clientName` equality filter passing `isOwnClientDoc` (documented "secure query" pattern) and client-role denial for the `__name__`-only site lookup.
3. **Storage `downloadUrl` behaviour for denied paths.** The deployed rule denies `releases/**`; whether some legacy link still hands out a tokenised URL (tokens bypass rules) was not exhausted.
4. **Whether the 2 guard Auth accounts without an employee `guardAuthUid` and the 402 no-claim Auth accounts are stale.** Resolving that needs per-user inspection, which is outside the aggregate-only PII budget.
5. **Bucket-level settings** (uniform bucket-level access, CORS, Lifecycle rules, retention policy) — not readable with the available read-only ADC surface; only object ACLs were sampled.
6. **Firestore TTL enforcement status** for the one configured policy (`locationHistory.expiresAt`) — the config is deployed (`ttl: true`); actual expiry sweeps are invisible to the Admin SDK.
7. **Query-shape coverage is best-effort, not exhaustive.** The extractor matched literal `collection('x')`/`.collection('x')` names followed by chained `where`/`orderBy` within a 900-character window; shapes built through dynamic collection variables (`AUTOMATION_COLLECTION`, `REGION_CONNECTIONS_COLLECTION`, `collectionName`), `FieldPath` filters, or transaction bodies were not enumerated. 100 distinct shapes were validated; dynamic-name collections in `src` are: `regionAutomationJobs`, `regionConnections` and the `*Audit` repair collections.
8. **Index *usage* vs *existence*.** Presence is confirmed (all 138 deployed); whether Firestore's planner selects a given index for a specific query cannot be observed from outside.

---

## 8. Appendix

### 8.1 Collection inventory (live, doc counts)

```
rateLimits 12338 | attendanceLogs 3562 | sensitiveDocumentAuditLogs 2967 | workOrders 2397
employees 1961 | employeeIds 1947 | attendanceSessions 1701 | employeeAadhaarPrivate 1646
workOrderAssignmentEvents 1404 | notifications 265 | enrollments 203 | systemMetrics 190
sites 180 | workOrderImports 146 | dutyRequests 133 | neetPgAssignments 117 | fcmTokens 107
attendanceState 61 | guardLocations 57 | enrollmentIdentities 20 | regionOnboardingAudit 17
clients 15 | foReportEvents 15 | guardPinResetEvents 15 | exportJobs 13 | employeeAccessAudit 9
fieldOfficers 8 | foVisitReports 7 | employeeSalaries 4 | foTrainingReports 4 | payrollCycles 4
workOrderRevisionEvents 4 | clientLocations 3 | clientUsers 3 | clientUsersByUid 2 | resetOtps 2
systemConfig 2 | _codexChecks 1 | adminRoleAudit 1 | clientEnrollmentProfileRepairRuns 1
clientWageConfig 1 | employeeDocumentRepairRuns 1 | enrollmentFormConfig 1 | fieldOfficerAudit 1
roleClaimRepairAudit 1 | salaryStructures 1 | tcsQualificationRequirementRuns 1
```
47 collections; `users`, `attendanceStates`, `payrollEntries`, `leaveRequests`, `evaluations`, `trainingAssignments`, `questionBanks`, `quizAttempts`, `guardScores`, `workOrderTodos`, `regionAutomationJobs`, `dutyWillingness`, `guardAssignments`, `trainingModules`, `awards`, `incidents`, `branches`, `districts`, `states`, `regions`, `complianceSettings`, `qrCodes` etc. **do not exist live** despite having rules and/or indexes.

### 8.2 Reproducible collector (aggregate-only, read-only)

```javascript
// node --env-file=.env.local this-file.cjs   (run from the repo root;
// NODE_PATH=$PWD/node_modules if the file lives outside the repo)
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {getStorage} = require('firebase-admin/storage');
const {getAuth} = require('firebase-admin/auth');
const app = initializeApp({credential: applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET});
const db = getFirestore(app);
const norm = (s) => String(s ?? '').trim();
const has = (d, k) => k in d && d[k] !== null && d[k] !== undefined && String(d[k]).trim() !== '';

(async () => {
  // sizes (server-side aggregation, no document reads)
  for (const c of await db.listCollections()) {
    console.log('count', c.id, (await c.count().get()).data().count);
  }
  // employees invariants
  const emps = (await db.collection('employees').get()).docs.map(d => ({id: d.id, ...d.data()}));
  const dupKey = (arr) => arr.reduce((m, v) => (v ? (m[v] = (m[v] || 0) + 1) : 0, m), {});
  console.log('employees', emps.length,
    'active', emps.filter(e => norm(e.status) === 'Active').length,
    'noGuardUid(active)', emps.filter(e => norm(e.status) === 'Active' && !has(e, 'guardAuthUid')).length,
    'dupEmployeeId', Object.values(dupKey(emps.map(e => norm(e.employeeId).toUpperCase().replace(/[^A-Z0-9]/g, '')))).filter(n => n > 1).length,
    'dupPhone', Object.values(dupKey(emps.map(e => norm(e.phoneNumber).replace(/\D/g, '').slice(-10)))).filter(n => n > 1).length,
    'dupResourceId', Object.values(dupKey(emps.map(e => norm(e.resourceIdNumber).toUpperCase().replace(/[^A-Z0-9]/g, '')))).filter(n => n > 1).length);
  // attendance logs: last-30d status + attribution + missing fields
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const logs = (await db.collection('attendanceLogs').get()).docs.map(d => d.data());
  const recent = logs.filter(l => norm(l.attendanceDate) >= cutoff);
  console.log('logs', logs.length, 'last30d', recent.length,
    'byStatus', recent.reduce((m, l) => (m[norm(l.status)] = (m[norm(l.status)] || 0) + 1, m), {}),
    'noPhotoPath', logs.filter(l => !has(l, 'photoStoragePath')).length,
    'noDistrict', logs.filter(l => !has(l, 'district')).length,
    'nullSubmitter(last30d)', recent.filter(l => !has(l, 'submittedByUid')).length);
  // sessions / sites / states / ttl hygiene
  const sess = (await db.collection('attendanceSessions').get()).docs.map(d => d.data());
  console.log('openSessions', sess.filter(s => norm(s.status) === 'open').length);
  const sites = (await db.collection('sites').get()).docs.map(d => d.data());
  console.log('sites', sites.length,
    'noGeo', sites.filter(s => !has(s, 'geolocation')).length,
    'siteIdTypes', sites.reduce((m, s) => (m[typeof s.siteId] = (m[typeof s.siteId] || 0) + 1, m), {}));
  // storage aggregates (metadata only)
  const [files] = await getStorage(app).bucket().getFiles({autoPaginate: true});
  console.log('storageObjects', files.length, 'over5MB', files.filter(f => Number(f.metadata.size || 0) >= 5 * 1024 * 1024).length);
  // auth role/claim-key census (no values)
  const users = await getAuth(app).listUsers(1000);
  console.log('authUsers', users.users.length,
    'roles', users.users.reduce((m, u) => (m[String(u.customClaims?.role || 'none')] = (m[String(u.customClaims?.role || 'none')] || 0) + 1, m), {}),
    'withAssignedSiteId', users.users.filter(u => u.customClaims && 'assignedSiteId' in u.customClaims).length);
})();
```

### 8.3 Owner actions implied by this audit (none performed here)

| Priority | Action |
|---|---|
| 1 | `firebase deploy --only storage:rules` — closes C1 (selfie/signature PII read by any authenticated user). |
| 2 | Fix `clients` rule → `isOwnClientDoc('name')`; delete or issue `assignedSiteId`; compare `siteId` doc id not the code field. |
| 3 | Move `guardPin` (hash) off `employees` into a server-only collection; stop returning bank/PAN fields to client users (server route projection). |
| 4 | Repair `/api/admin/data-export` field names (`attendanceDate`, `clientName`) — it currently 500s or exports nothing. |
| 5 | Persist `submittedByUid`/`submittedByRole` on attendance submissions. |
| 6 | Add TTL on `rateLimits.windowStart`; convert `resetOtps` timestamps to Timestamp; owner-approved cleanup of >7-day windows, orphan selfies, `dummyAttendanceEmp1776435824`, `codex-test/*`, `releases/*`. |
| 7 | Backfill `stateCode`, `clientId`, `attendanceLogs.district`; normalise `sites.siteId` to string; set geofence radii and geolocations. |
| 8 | Add explicit `if false` blocks for the 7 unlisted collections and retire the `attendanceStates` guard-write rule. |

*No product code was edited and no live data, rules, indexes or Storage objects were modified by this audit.*
