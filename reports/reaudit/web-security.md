# CISS Workforce — Web Security Re-Audit (verification of the 2026-10-06 assessment)

**Target:** `/Users/mymac/Documents/CISS` — Next.js 15 App Router (Node runtime), Firebase Auth / Firestore / Storage (`ciss-workforce`), Vercel.
**Type:** white-box re-verification of the prior audit **plus** an independent pass over the current web surface.
**Date:** 2026-10-26
**Verdict scope:** every first-order finding of `reports/audit/VULNERABILITY-REPORT.md` — **C-1…C-4, H-1…H-10, M-1…M-15, L-1…L-15** (44 findings).

> **Nothing was sent to `cisskerala.site` or to Firestore.** No writes, no deletes, no deploys, no product-code edits. No emulator was started. The only network traffic was to the npm registry (`npm audit --omit=dev`, `npm view next`), which is read-only. No secret value from any `.env*` file was printed; only key **names** were enumerated.

---

## 0. Method and evidence rules

1. Read the whole prior report and all three companions (`public-api-findings.md` PA-*, `rules-findings.md` R-*/S-*, `file-export-ssrf-findings.md` FL-*/FS-*/FE-*) before touching code.
2. Re-read **every** file the prior audit cites, in the current working tree, and grepped for the decisive predicate. No finding is called "fixed" on the strength of a remediation note, a test name, or a comment — only on the code path that decides it.
3. For each finding I recorded: (a) was it real at the audited revision; (b) its status **now**, with `file:line`; (c) whether any change came from a `HEAD..origin/main` commit, from the **Oct 26 working tree** (payroll/leave retirement + region work), or was never applied.
4. Branch attribution was done mechanically: for each affected file, `git diff HEAD origin/main -- <file>` was run; a non-zero diff means origin/main differs, an empty diff means the finding is untouched on both branches.
5. Where source cannot decide (Vercel header handling, live env vars, live data), the item is marked **UNVERIFIED** and moved to §7 rather than guessed.

### Repo state observed

| Fact | Value |
|---|---|
| `git rev-parse HEAD` | `cad17132` ("Checkpoint: guard auth/PIN, enrollment, field-officer routes, …") |
| Working tree | **dirty** — payroll/leave retirement, region work, guard-auth rework, deleted payroll pages and APKs |
| Local `origin/main` | `c81f4a68`, 16 commits ahead of HEAD (includes `b13ba8f9` "close the 15 Oct audit findings", `1de78a97` "close index and rules gaps", `c81f4a68` duty hardening) |
| Audited revision | `72b55601` + uncommitted mods (2026-10-06) |
| Files changed since audit (`72b55601..worktree`) | 25 files in the security-relevant set; `firestore.rules` ±100 lines, `storage.rules` **unchanged**, `middleware.ts`/`next.config.ts` **unchanged** |
| `next` | `package.json:74` `"^15.5.22"`; installed `15.5.22`; **identical on origin/main** |
| `sharp` | `package.json:108` `0.35.3`; installed `0.35.3` |

### Branch-attribution key used below

- **WT** = fixed/changed by the uncommitted Oct 26 working tree.
- **OM** = fixed/changed by a commit that exists only on `origin/main`.
- **NONE** = no fix on either branch.

No finding in the prior report is fixed on `origin/main` alone. The only fixes that exist anywhere are in the **working tree**, and both of them are side-effects of the payroll retirement, not of targeted remediation.

---

## 1. Delta since the audited revision (what actually moved)

| Area | Change | Security effect |
|---|---|---|
| `firestore.rules:382-443` (WT) | `payrollEntries`, `complianceSettings`, `clientWageConfig`, `salaryStructures`, `employeeSalaries`, `payrollCycles` → `allow read, write: if false` | **Closes H-4 and H-5** (as a side-effect of retiring payroll). `origin/main` still ships the permissive versions (`git show origin/main:firestore.rules` → `:433-434`, `:437-439`, `:450-452`). |
| `firestore.rules:461-467, 610-643` (WT) | new server-only denies: `dutyWillingness`, `dutyRequests`, `guardAssignments`, `guardAssignmentSlots`, `leaveBalances`, `_diagnostics`, `appConfig`, `config`, `enrollmentIdentities`, `guardPinResetEvents`, `qrCodes`, `workOrderAssignmentEvents`, `workOrderRevisionEvents` | Correct hardening; nothing in the prior report regressed. |
| `firestore.rules:199-220` (WT) | `validTcsCategory()` + separate create/update branches on `employees` | Correct: constrains `tcsCategory`/`clientName` mutation. |
| `firestore.rules:142-151, 668-674` (WT) | `officerOwnsGuardLocation()` for `locationHistory` (provable via parent doc) | Correct functional/hardening fix. |
| `firestore.rules:92-97` | `writeStateMatches()` **unchanged** on both branches | H-6 remains open. |
| `storage.rules` | **byte-identical** on both branches | H-7, M-5, L-12, L-13 remain open. |
| `src/lib/qr/qr-token.ts` | **byte-identical** on both branches | C-3 remains open. |
| `src/app/api/public/attendance/identify/route.ts` | **byte-identical** on both branches | C-2 remains open. |
| `src/lib/server/rate-limit.ts` | **byte-identical** on both branches | H-3 remains open. |
| payroll/leave UI + 16 API modules | retired to stateless `410` tombstones (16 files) | Sound: see §4.1; makes L-9, L-11 moot. |
| `src/app/api/public/clients/route.ts` (WT) | full `employees` collection read → per-client `.count()` aggregation | M-14 partly mitigated (cost), exposure unchanged. |
| guard auth (`login`, `setup-pin`, `change-pin`, `pin-status`) | reworked: scrypt intact, transactional PIN reservation, DOB second factor, duplicate-UID link fails closed | Net improvement; no regression found (§4.2). |
| `public/downloads/*.apk` | **all deleted** in WT, manifest still references them | New low-severity regression, N-3. |
| dependencies | **no change** on either branch | C-1, L-14 open — and the `next` advisory set has *widened* since the audit (§2.1). |

---

## 2. Finding-by-finding verification

Legend — **Valid?**: *valid* / *valid but conditional* / *overstated* / *incorrect*.
**Status now**: *fixed* / *partial* / *open* / *regressed* / *not-applicable*.

### 2.1 Critical

---

#### C-1 · `next@15.5.22` below the patch line for unauthenticated RCE — **VALID (severity now higher)**

- **Prior:** Critical · `package.json:74`.
- **Valid at audited revision?** Yes. `next@15.5.22` was inside both advisory ranges.
- **Status now: OPEN — never applied (NONE).**
- **Evidence:** `package.json:74` still `"next": "^15.5.22"`; `node -p "require('./node_modules/next/package.json').version"` → `15.5.22`; `git diff HEAD origin/main -- package.json` is **empty**, so origin/main does not fix it either. `next.config.ts:57-73` has no `images.unoptimized`, so the Image Optimization API is live, and `next.config.ts:59-72` permits `firebasestorage.googleapis.com` remote images (the parser path is reachable).
- **Material update — the prior remediation target is now insufficient.** `npm audit --omit=dev` (2026-10-26) reports `next` **critical**, range `9.5.6-canary.0 - 15.5.27 || 15.6.0-canary.0 - 16.3.0-preview.10`, with **six** advisories, three of which post-date the audit:
  - GHSA-p293-qw3h-jr36 (Windows RCE, `<15.5.24`) — unchanged;
  - GHSA-2xp9-vwfh-vxw4 (AVIF image-optimizer RCE, `<15.5.24`) — unchanged;
  - **GHSA-2464-fhr4-w9xw — "Unauthenticated RCE in Image Optimization API when SVG files are used", `>=10.0.0 <=15.5.27`** — new, and it is the same class as the one the audit considered material. Upgrading to the audit's recommended `15.5.24` would **not** close it;
  - GHSA-4jqv-mc3x-m676 / GHSA-mcj8-r9mp-w47p (SSG/ISR cache poisoning, `<15.5.27`) — new;
  - GHSA-p3m5-59mp-jv5r (App Router Server Actions DoS, `<=15.5.27`) — new.
- **Correct fix now:** `next@15.5.28` (published, `backport` dist-tag) or `next@16.4.3` (`latest`). `npm view next dist-tags` → `backport: 15.5.28`.
- **Note:** `sharp@0.35.3` (`package.json:108`) is also still in the vulnerable range `<=0.35.5-rc.1` (GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w) — that is L-14, and it feeds the same image optimizer.

---

#### C-2 · Unauthenticated attendance forgery for any employee (complete chain) — **VALID**

- **Prior:** Critical · `identify/route.ts:126-135,197-207,221-230` → `submit/route.ts:321-341`.
- **Valid at audited revision?** Yes.
- **Status now: OPEN — never applied (NONE).** Both files are byte-identical to the audited revision (`git diff HEAD origin/main --` empty for both).
- **Evidence (all current line numbers):**
  - Token minted for any caller, no second factor: `src/app/api/public/attendance/identify/route.ts:126-135`
    ```ts
    return NextResponse.json({
      found: true,
      authenticated: method === "authenticated",
      verificationToken:
        method === "authenticated" ? null
          : generateAttendanceVerificationToken({ employeeDocId: employeeDoc.id, method }),
    ```
  - `employeeId` method needs only the code: `:197-207` (`matches = await findByEmployeeId(input.value)`, phone filter is optional at `:199`).
  - QR branch still **fails open** when the payload has no `Token:` line: `:221-231`
    ```ts
    if (qr.token && (!qr.phoneNumber || !(await verifyQrToken(...)))) { 401 }
    matches = await findByEmployeeId(qr.employeeId);   // token-less QR accepted
    ```
  - Anonymous submit accepts the minted token and writes the record: `src/app/api/attendance/submit/route.ts:322-338`
    ```ts
    const verification = payload.attendanceVerificationToken
      ? verifyAttendanceVerificationToken(payload.attendanceVerificationToken) : null;
    if (!verification || verification.employeeDocId !== payload.employeeDocId) { 401 }
    ```
  - Live GPS is also written on that anonymous path: `attendance/submit/route.ts:974` (`.collection("guardLocations")`).
- **Only partial mitigation present:** `buildResponse` refuses employees whose `status` is set and `!== "Active"` (`identify/route.ts:111-116`). That stops minting for `PendingReview` records but does nothing for the ~all-Active guard population.
- **Rate limit:** 15/min per spoofable IP (`identify/route.ts:181-191`) — see H-3.
- **Escalation found in the fresh pass:** the chain no longer requires the QR secret at all, and does not require guessing a phone number — see **N-1** and the H-10 verdict below.

---

#### C-3 · QR HMAC signing key falls back to a public value — **VALID**

- **Prior:** Critical · `src/lib/qr/qr-token.ts:6-9`.
- **Valid at audited revision?** Yes.
- **Status now: OPEN — never applied (NONE).** `git diff HEAD origin/main -- src/lib/qr/qr-token.ts` is empty.
- **Evidence:** `src/lib/qr/qr-token.ts:6-9`
  ```ts
  const QR_SECRET =
    process.env.CISS_QR_SECRET ||
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    "ciss-default-qr-secret";
  ```
  - `CISS_QR_SECRET` still has exactly **one** repo-wide occurrence (that line): `grep -rn CISS_QR_SECRET` (excluding `node_modules`, `.next`, `reports/audit`).
  - It is still absent from `.env.example` (key list enumerated: `ATTENDANCE_VERIFICATION_SECRET`, `UPLOAD_TOKEN_SECRET`, `CRON_SECRET`, … — no `CISS_QR_SECRET`) and from `.env.local`, `.env.vercel`, `.env.vercel.local` (key names only inspected).
  - The fallback key is served anonymously for `KL`: `src/app/api/public/region-config/[code]/route.ts:26-30` (android) and `:33-36` (web `apiKey`).
  - Token is still a 16-char truncation of `HMAC-SHA256(secret, "<employeeId>:<phone>")` — `qr-token.ts:35-43`.
- **Contrast that still holds:** `attendance-verification-token.ts:20-33` and `upload-token.ts:5-12` both throw in production when their secret is unset, i.e. the correct pattern exists one directory away and was not copied.
- **UNVERIFIED:** whether Vercel has `CISS_QR_SECRET` set (would make the code defect latent rather than active). See §7.

---

#### C-4 · Any guard can read the entire `clients`, `sites`, `clientLocations` collections — **VALID (latent)**

- **Prior:** Critical (latent) · `firestore.rules:40-42, 230-236, 238-244, 246-252`.
- **Valid at audited revision?** Yes — predicate is site-*presence*, not site-*match*, and the claim is never minted.
- **Status now: OPEN — never applied (NONE).** The rules block is unchanged on both branches (`firestore.rules` diff for `clients`/`sites`/`clientLocations` is empty).
- **Evidence (current lines):**
  - helper still present: `firestore.rules:40-42` `function guardAssignedSiteId() { return request.auth.token.assignedSiteId; }`
  - `firestore.rules:255-257` (`clients`) — `(isGuard() && guardAssignedSiteId() != null)` — no comparison to the document;
  - `firestore.rules:270-273` (`clientLocations`) — same presence-only branch;
  - `firestore.rules:262-266` (`sites`) — `resource.data.siteId == guardAssignedSiteId()`, but a `sites` document is keyed **by** its id and carries no `siteId` field, so this branch can never be satisfied. The audit's "guards cannot read their own site" functional break therefore also still holds.
- **Claim still never minted:** `grep -rn assignedSiteId src --include=*.ts --include=*.tsx` (excluding tests) → **no matches**; only `firestore.rules:40,41,257,265,273`. Guard claims are `role`, `employeeId`, `employeeDocId` (`src/app/api/guard/auth/login/route.ts:282-289`; `setup-pin/route.ts:262-266`).
- **New comment, same defect:** the block comment at `firestore.rules:240-247` now claims "Guard: only their assigned site / client the site belongs to", which is not what `:255-257` and `:270-273` implement. The comment makes the latent defect *more* likely to be activated by a future reader.

---

### 2.2 High

---

#### H-1 · Anonymous PII + live duty status + free `employeeDocId` oracle — **VALID**

- **Status now: OPEN — never applied (NONE).**
- **Evidence:** `src/app/api/public/attendance/employee/route.ts` imports only `NextRequest`, `NextResponse`, `db` and `buildPublicAttendanceEmployee` (`:1-3`) — **no rate-limit helper, no auth**. Query params read at `:9-13`; `attendanceState` read at `:105`; response built at `:110-145`. The builder still emits doc id, phone, client and hint: `src/lib/attendance/public-attendance.ts:116-143`, with `phoneNumber` at `:134-138` and `id` at the object head.
- **Impact chain intact:** the returned `id` is the `employeeDocId` that C-2/C-4/H-10 need.

#### H-2 · Anonymous dump of sites, clients, GPS coordinates, duty points, shifts — **VALID**

- **Status now: OPEN — never applied (NONE).**
- **Evidence:** `src/app/api/public/attendance/route.ts:31-45` reads `sites` and `clientLocations` in full with no filter; the builder exports `clientName`, `clientId`, `lat/lng`, `geofenceRadiusMeters`, `strictGeofence`, `shiftPattern`, `dutyPoints` (`src/lib/attendance/public-attendance.ts:82-119`, coords spread at `:117`). Response is CDN-cacheable at `:49` (`public, s-maxage=300`). Only a 30/min per-IP limit exists (`:11-29`).

#### H-3 · Rate limiting bypassable via spoofable left-most `X-Forwarded-For` — **VALID**

- **Status now: OPEN — never applied (NONE).** `git diff HEAD origin/main -- src/lib/server/rate-limit.ts` empty.
- **Evidence:** `src/lib/server/rate-limit.ts:108-131`
  ```ts
  export function getClientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const raw = forwarded.split(",")[0]?.trim() ?? "";   // left-most = caller-controlled
  ```
  and `x-real-ip` is only consulted when XFF is absent (`:119-123`). `src/middleware.ts:46-56` still excludes `api` from the matcher, so nothing normalises the header before the route sees it.
- **Secondary defect intact:** every `checkRateLimit` still writes one `rateLimits` document per distinct key (`rate-limit.ts:19-90`) and there is still no TTL/sweep anywhere in the repo (`grep -rn "rateLimits" src` → limiter + the deny-all rule only).
- **UNVERIFIED:** whether Vercel strips/rewrites a client-supplied left-most XFF (§7 item 2).

#### H-4 · Statutory compliance settings client-writable by non-super admins — **VALID, NOW FIXED (WT, by retirement)**

- **Valid at audited revision?** Yes — `allow write: if isAdmin() || isCompliance()` against a superAdmin-only API.
- **Status now: FIXED (WT only).**
- **Evidence:** `firestore.rules:425-427`
  ```javascript
  match /complianceSettings/{docId} {
    allow read, write: if false;
  }
  ```
  No client role can write it; the writer API is now a tombstone (`src/app/api/admin/compliance-settings/route.ts`, 9 lines, `410`).
- **Caveat for the Lead:** this is a *retirement*, not a hardening. `origin/main` still ships the vulnerable rule (`git show origin/main:firestore.rules:432-435`). If payroll ever comes back and this file is taken from main, the finding returns. The correct hardening, if the collection is ever reintroduced, is `allow write: if isSuperAdmin()`.

#### H-5 · `accounts` can write client billing config, salary structures, payroll cycles — **VALID, NOW FIXED (WT, by retirement)**

- **Status now: FIXED (WT only).**
- **Evidence:** `firestore.rules:429-443` — `clientWageConfig`, `salaryStructures`, `employeeSalaries`, `payrollCycles` are all `allow read, write: if false;`; `payrollEntries` likewise (`:382-384`). The corresponding APIs are `410` tombstones.
- **Caveat:** same as H-4 — `origin/main:firestore.rules:437-453` still has `isAdmin() || isAccounts()` writes.

#### H-6 · `writeStateMatches()` decided by the incoming document — **VALID**

- **Status now: OPEN — never applied (NONE).**
- **Evidence:** `firestore.rules:92-97` (unchanged in WT and OM):
  ```javascript
  function writeStateMatches() {
    return !('stateCode' in request.resource.data) ||
      userStateCode() == null ||
      request.resource.data.stateCode == userStateCode() ||
      isSuperAdmin();
  }
  ```
  Still consumed by every write rule that needs state scoping (`clients:258`, `sites:266`, `clientLocations:274`, `employees:217-219`, `attendanceLogs`, `attendanceState`, `workOrders:309`, `notifications`, `districts:503`, `enrollmentFormConfig:527`, …). A replacement `setDoc` that omits `stateCode` still passes *and* deletes the field, which then makes the document readable through `readStateMatches()` (`:85-90`).
- **UNVERIFIED:** whether more than one state is populated (§7 item 5). Impact is latent if Kerala is the only live state.

#### H-7 · Any authenticated account can bulk-download every signature / photo / attendance selfie — **VALID**

- **Status now: OPEN — never applied (NONE).** `storage.rules` is byte-identical on both branches.
- **Evidence:** `storage.rules:113-118` (`profilePictures`), `:120-126` (`signatures`), `:128-134` (`attendance`) — all `allow read: if isSignedIn();`. In Storage rules `read` still grants `get` **and** `list`, so enumeration of `employees/` is possible for any token, including a 4-digit-PIN guard and a client-portal user.
- **Contrast that still holds:** the sibling sensitive tiers are `isAdmin()` (`storage.rules:136-201`: `idProofs`, `addressProofs`, `aadharCards`, `panCards`, `passports`, `bankDocuments`, `policeCertificates`).

#### H-8 · Cross-tenant document disclosure via client-name normalisation — **VALID but conditional**

- **Status now: OPEN — never applied (NONE).**
- **Evidence:** `src/lib/server/client-access.ts:17-23` (`normalizeClientKey` strips every non-alphanumeric) and the *third* fallback at `:52-54`:
  ```ts
  return recordClientNames.some(
    (clientName) => normalizeClientKey(clientName) === normalizeClientKey(scope.clientName),
  );
  ```
  `matchesClientScope` is used by the document route chain (`src/lib/server/guard-profile-view.ts` → `src/app/api/employees/profile/[id]/document/route.ts`) **and** by every client API route (`client/attendance:67`, `client/guards:49`, `client/work-orders:70`, `client/dashboard`, `admin/reports/attendance:190`…), so the over-match is broader than the document path the audit named.
- **Conditional:** requires two client names that collide under the normaliser. **UNVERIFIED** against live data (§7 item 10).

#### H-9 · `fix-email-verified` bulk-verifies emails as an identity step for the Aadhaar administrator — **VALID**

- **Status now: OPEN — never applied (NONE).**
- **Evidence:** `src/app/api/admin/fix-email-verified/route.ts:7` `await requireAdmin(request);` (not superAdmin), `:10` `adminAuth.listUsers(1000)`, `:22-25` `if (!user.emailVerified) { await adminAuth.updateUser(user.uid, { emailVerified: true }); … }`. Still no audit record and no UID scoping; guard domains are only skipped by suffix (`:16-21`).
- Confirms the policy relevance: `src/lib/aadhaar-admin-policy.ts` gates reveal on `email_verified` (consumed by `src/lib/server/auth.ts:73-89`).

#### H-10 · `public-profile/[id]` IDOR, fallback ignores `publicProfile`/status — **VALID, severity should be raised to High (escalation now proven)**

- **Status now: OPEN — never applied (NONE).**
- **Evidence:** `src/app/api/employees/public-profile/[id]/route.ts:62-73` (curated branch) then the unconditional fallback at `:75-84` returning `data.qrCodeUrl` with no auth path at all (the handler never calls an auth helper; `:5-10`).
- **The prior audit's one open question — "is `qrCodeUrl` the attendance badge?" — is now settled from source, and the answer makes this a High:**
  - `src/app/api/employees/enroll/route.ts:302-305` writes `qrCodeUrl = await generateQrCodeDataUrl(employeeId, fullName, normalizedPhone)` onto the employee document, and `generateQrCodeDataUrl` (`src/lib/qr.ts:8-21`) returns `QRCode.toDataURL(await buildQrContent(...))` — i.e. a base64 **PNG of the signed attendance QR**.
  - `public-profile` returns that string verbatim (`:82`).
  - So an anonymous caller with a Firestore employee doc id receives a scannable attendance badge: decode the PNG (any offline QR decoder) → `Employee ID` + `Phone` + `Token` → present it to `identify` with `method:"qr"` (`identify/route.ts:214-231`) → receive a `verificationToken` → `POST /api/attendance/submit`. No secret recovery, no phone-number guessing, no badge needed.
  - Doc ids are handed out anonymously by H-1 (`public/attendance/employee`), or by enumerating `employeeId` codes (999/client/FY, `src/lib/employee-id.ts:33-41`).
- **Practical consequence:** H-10 + C-2 is an *independent* complete forgery chain, so **fixing C-3 alone does not close anonymous attendance forgery.** Reported as new finding **N-1** with the chain enumerated.

---

### 2.3 Medium

---

| ID | Prior claim | Valid? | Status now | Decisive current evidence |
|---|---|---|---|---|
| **M-1** | `Host`-header re-queue leaks `Bearer $CRON_SECRET` | valid but conditional | **open** (NONE) | `src/lib/server/self-queue.ts:226-232` — `buildSelfUrl` returns `url.origin + pathname` where `url = new URL(requestUrl)`; `:206-213` then does `fetch(selfUrl, { headers: { authorization: "Bearer " + cronSecret } })`. Callers unchanged. UNVERIFIED whether Vercel lets `Host` reach `request.url` (§7-3). |
| **M-2** | Anonymous per-region Firebase config (`apiKey`/`appId`) for every ready region | valid | **open** (NONE) | `src/app/api/public/region-config/[code]/route.ts:14-36` (KL from `NEXT_PUBLIC_*`), `:59-88` (any `ready`/`live` region, `web.apiKey` at `:70`); `src/app/api/public/regions/route.ts:16-29` publishes other deployments' `vercelProductionUrl`. This is what makes C-3's fallback key public. |
| **M-3** | CSV formula injection in the attendance report | valid | **open** (NONE) | `src/app/api/admin/reports/attendance/route.ts:13-23` — `toCsv` still only doubles quotes (`:19-20`), no `= + - @ \t \r` guard; attacker-controlled cells (`employeeName`, `siteName`, `locationText`, `complianceWarnings`) at `:149-165`; served at `:185-190`. |
| **M-4** | Stored XSS via echoed `Content-Type` + `inline` | valid | **open** (NONE) | `src/app/api/guard/profile/documents/route.ts:96-112` — `getMetadata()`, then `"Content-Type": metadata.contentType` (`:108`), `"Content-Disposition": "inline"` (`:109`). `nosniff` is present (`:111`) but does not stop an `image/svg+xml` document being *rendered* as SVG. `storage.rules:136-149, 196-201` still admit `image/*` (incl. SVG) into those prefixes. |
| **M-5** | Any field officer reads every other FO's report evidence | valid | **open** (NONE) | `storage.rules:96-107` — `allow read: if isAdmin() \|\| isFieldOfficer();` on the 3-segment `foReports/{folder}/{uid}/{fileName}` path; no `request.auth.uid == uid`. (The 4-segment path above it is correctly `allow read: if false`, `:80-93`.) |
| **M-6** | Client users read raw `employees` docs (bank/PAN/UAN/ESIC) | valid | **open** (NONE) | `firestore.rules:209-215`, branch at `:214` `isOwnClientDoc('clientName')` on the **raw** doc; no field projection. |
| **M-7** | FO reads not district-scoped for `attendanceSessions`/`workOrderTodos` | valid | **open** (NONE) | `firestore.rules:365-368` `allow read: if readStateMatches() && (isStaff() \|\| …)`; `isStaff()` includes `isFieldOfficer()` (`:167-169`). `workOrderTodos` same shape at `:457-458`. Note the WT *did* add `officerOwnsGuardLocation()` for `locationHistory` only (`:142-151`) — the same fix was not applied to these two collections. |
| **M-8** | Any staff role creates/updates `workOrderTodos` from the client SDK | valid | **open** (NONE) | `firestore.rules:457-461` — `allow create: if isStaff() && writeStateMatches();` no field allowlist; `:460` lets the creator update by setting `assignedTo` to their own uid. |
| **M-9** | Unauthenticated enrollment-draft creation for arbitrary phones | valid | **open** (NONE) | `src/app/api/public/enroll/draft/route.ts:27-37` limit key is `${ip}:${phoneNumber}` (both attacker-chosen), `:40-51` creates the document; no CAPTCHA/OTP. |
| **M-10** | Enrollment upload: no rate limit, permanent bearer URLs, client MIME | valid | **open** (NONE for the security substance) | `src/app/api/public/enroll/upload/route.ts` still imports no limiter; `:110-113` `contentType: file.type` echoed; `:104,119-122` issues a permanent `firebaseStorageDownloadTokens` URL for everything except `aadharCards`. Type allowlist is still `file.type.startsWith("image/")` (`src/lib/enrollmentFiles.ts:11-18`) → `image/svg+xml` passes. The only WT change is `:117` `FieldValue.increment(1)` (atomic counter) and a `413` on oversize (`:90-94`) — neither is security-relevant. |
| **M-11** | `verify-qr` leaks identity + live duty hint anonymously; `includes` phone filter | valid | **open** (NONE) | `src/app/api/public/attendance/verify-qr/route.ts:73` `return phone.includes(parsed.phoneNumber!);`; anonymous branch returns `id`, `employeeId`, `fullName`, `clientName`, `district` at `:120-133` and the full `attendanceHint` (incl. `openSessionId`) at `:145-158`. |
| **M-12** | Attendance/upload capability tokens not single-use | valid | **open** (NONE) | `src/lib/server/attendance-verification-token.ts:42-59` still mints `nonce: crypto.randomUUID()` and `:82-96` only shape/`exp`-checks it — nothing stores or consumes it. `src/lib/server/upload-token.ts:66-76` likewise. |
| **M-13** | SSRF-shaped reachability oracle via `vercelProductionUrl` | valid | **open** (NONE) | `src/app/api/super-admin/regions/[id]/check/route.ts:12-19` `fetch(url, { method: "HEAD", redirect: "manual" })` — no scheme/host allowlist, no `AbortSignal`; `:157-167` reports `passed` and echoes the URL. Write side unvalidated: `src/app/api/super-admin/regions/[id]/route.ts:111-114`. |
| **M-14** | Anonymous client roster with headcounts, no rate limit, `O(#clients)` aggregation | **valid but overstated** (headcounts were never in the payload) | **partial** (WT changed the cost, not the exposure) | `src/app/api/public/clients/route.ts:23-49` still returns `{ clients: [{id,name,enrollmentProfile}] }` with no counts *and* still sorts by an internal per-client `.count()` — so relative workforce size remains inferable from ordering, and each cache-busted request still costs one aggregation per client (`:32-43`). No rate limit (`:21`). WT replaced a full `employees` collection download with aggregations, which **reduces** the abuse cost the audit described; the disclosure is unchanged. |
| **M-15** | `isGuard()` accepts any account on `@guard.cisskerala.app` without the claim | valid but conditional | **open** (NONE) | `firestore.rules:15-20` still has the email arm. Inert as long as guard identity is claim-minted (`guard/auth/login/route.ts:282-289` sets `role:"guard"`; `guard-auth.ts:15-17` requires it server-side). Becomes real only if Identity Toolkit self-signup is open for that domain — **UNVERIFIED** (§7-8). |

---

### 2.4 Low / informational

---

| ID | Prior claim | Valid? | Status now | Evidence / note |
|---|---|---|---|---|
| **L-1** | `users/{uid}` self-update lets scope fields be attached | valid | **open** (NONE) | `firestore.rules:186-188` — update still only deny-lists `['role','employeeDocId','employeeId','admin']`; the create path *does* have a `hasOnly` allowlist (`:181-185`). `clientName`, `stateCode`, `assignedDistricts`, `uid` are still attachable. No consumer today (authorization reads token claims). |
| **L-2** | `districts`, `states`, `enrollmentFormConfig` world-readable | valid | **open** (NONE) | `firestore.rules:501-505` (`allow read: if true`), `:507-510`, `:525-529`. |
| **L-3** | Legacy `attendanceStates` guard write with no field allowlist | valid | **open** (NONE) | `firestore.rules:373-377` — still `allow create, update: if (isAdmin() \|\| (isGuard() && guardEmployeeDocId() == employeeId)) && writeStateMatches();`. Dead collection (only singular `attendanceState` used). |
| **L-4** | Client-SDK list queries the rules cannot satisfy (functional) | valid | **partial** | The payroll half is moot (pages deleted). Still live: `src/app/(app)/settings/data-export/page.tsx:146,226`, `src/app/(app)/settings/qr-management/page.tsx:38,53`, `src/app/(app)/work-orders/[siteId]/page.tsx:589-594` all list `employees`/`workOrders` via `getDocs(query(collection(db,…)))`, while `firestore.rules:209-215` / `:306-309` stay resource-scoped predicates a `list` cannot prove. Safe-direction failure. |
| **L-5** | `CRON_SECRET` compared with `===` and accepted in the query string | valid | **open** (NONE) | `src/app/api/internal/enrollment-draft-cleanup/route.ts:9-21` — `bearerSecret === expectedSecret \|\| querySecret === expectedSecret`; still no `timingSafeEqual`, still `?key=`. |
| **L-6** | `/api/health` echoes Admin SDK/Firestore error strings | valid | **open** (NONE, marginally reduced) | `src/app/api/health/route.ts:18-24` still interpolates the Firestore error into `checks.firestoreRead` and returns it (503 at `:30-33`); `:34-40` still returns the raw `error` message on the outer catch. Names `systemConfig/_health`. |
| **L-7** | `/api/employees/lookup` phone→guard membership oracle | valid | **open** (NONE) | `src/app/api/employees/lookup/route.ts:15-45` — 5/min per spoofable IP, 3/min per phone; `:47-63` returns `{found:true/false}`. Small WT improvement: the per-phone key is now a SHA-256 fingerprint (`:36-39`) instead of the raw number. Oracle intact. |
| **L-8** | Firestore doc-path injection via unvalidated `row.siteId` | valid | **open** (NONE) | `src/app/api/admin/work-orders/import/commit/route.ts:251-256` `siteToken = row.siteId?.trim()` concatenated into the id; `:693-694` `.doc(targetId)`. Admin-only. |
| **L-9** | Payslip ownership falls back to non-unique `employeeId` | valid at the time | **not-applicable** (WT retirement) | `src/app/api/guard/payslips/[id]/payslip/route.ts` is now a 5-line `410` tombstone (`grep -c 410` → 1; no db/auth imports). |
| **L-10** | XLSX caps applied only after the full workbook parse | valid | **partial** | The wage-config upload half is retired (`admin/clients/[id]/wage-config/upload/route.ts` = 410). The import preview half is unchanged: `src/app/api/admin/work-orders/import/preview/route.ts:74` `readXlsxFile(buffer)` **before** the row/column/sheet caps at `:82-98`. |
| **L-11** | `Content-Disposition` filename from unsanitised employee fields | valid at the time | **not-applicable** (WT retirement) | Both payslip routes are `410` tombstones. |
| **L-12** | Storage `isImage()` admits SVG; 100 MB training content | valid | **open** (NONE) | `storage.rules:17-19` `request.resource.contentType.matches('image/.*')`; `:12-14` `isAllowedTrainingSize()` = 100 MB; `:204-208` `trainingModules`. |
| **L-13** | Report-bound metadata checks only on the 4-segment `foReports` path | valid | **open** (NONE) | `storage.rules:80-93` (metadata + uid + `read:false`) vs `:96-107` (no metadata, `isFieldOfficer()` read). Unchanged. |
| **L-14** | Dependency hygiene; two worth acting on (`next`, `sharp`) | valid | **open and slightly worse** (NONE) | `npm audit --omit=dev` → **90 vulnerabilities (65 moderate, 22 high, 3 critical)**; `next` critical (6 advisories, see C-1), `sharp` high `<=0.35.5-rc.1`, plus `handlebars` critical and `proxy-addr` critical pulled in by the dev/genkit tree. Nothing changed in `package.json`/lockfile on either branch. |
| **L-15** | Secrets hygiene passes; env files are `644` | valid | **open** (hardening item unchanged) | `.gitignore:43,60` still ignores `.env*`; `git ls-files \| grep -i '\.env'` → only `.env.example` (no secret tracked; matches the prior "passed" verdict). Permissions unchanged: `.env.local`, `.env.vercel`, `.env.vercel.local` are `-rw-r--r--` (octal `644`). |

---

## 3. Summary table (all 44 findings)

| ID | Prior sev | Valid? | Status now | Fix location | One-line evidence |
|---|---|---|---|---|---|
| C-1 | Critical | valid | **open** | NONE | `package.json:74` → 15.5.22; advisories now up to 15.5.27 |
| C-2 | Critical | valid | **open** | NONE | `identify/route.ts:129-135,221-231`; `submit/route.ts:322-338` |
| C-3 | Critical | valid | **open** | NONE | `qr-token.ts:6-9` fallback chain |
| C-4 | Critical (latent) | valid | **open** | NONE | `firestore.rules:40-42,255-257,270-273` |
| H-1 | High | valid | **open** | NONE | `public/attendance/employee/route.ts:9-13,105,110-145` |
| H-2 | High | valid | **open** | NONE | `public/attendance/route.ts:31-45`; `public-attendance.ts:82-119` |
| H-3 | High | valid | **open** | NONE | `rate-limit.ts:108-131`; `middleware.ts:46-56` |
| H-4 | High | valid | **fixed** | WT (retirement) | `firestore.rules:425-427` `if false` |
| H-5 | High | valid | **fixed** | WT (retirement) | `firestore.rules:429-443` `if false` |
| H-6 | High | valid | **open** | NONE | `firestore.rules:92-97` `request.resource.data` |
| H-7 | High | valid | **open** | NONE | `storage.rules:113-134` `isSignedIn()` reads |
| H-8 | High | valid but conditional | **open** | NONE | `client-access.ts:52-54` |
| H-9 | High | valid | **open** | NONE | `fix-email-verified/route.ts:7,22-25` |
| H-10 | Medium→**High** | valid *(+escalation proven)* | **open** | NONE | `public-profile/[id]/route.ts:75-84`; `enroll/route.ts:302,325` |
| M-1 | Medium | valid but conditional | **open** | NONE | `self-queue.ts:206-213,226-232` |
| M-2 | Medium | valid | **open** | NONE | `region-config/[code]/route.ts:14-36,59-88` |
| M-3 | Medium | valid | **open** | NONE | `reports/attendance/route.ts:13-23,185-190` |
| M-4 | Medium | valid | **open** | NONE | `guard/profile/documents/route.ts:96-112` |
| M-5 | Medium | valid | **open** | NONE | `storage.rules:96-107` |
| M-6 | Medium | valid | **open** | NONE | `firestore.rules:214` |
| M-7 | Medium | valid | **open** | NONE | `firestore.rules:365-368,457-458` |
| M-8 | Medium | valid | **open** | NONE | `firestore.rules:457-461` |
| M-9 | Medium | valid | **open** | NONE | `public/enroll/draft/route.ts:27-51` |
| M-10 | Medium | valid | **open** | NONE | `public/enroll/upload/route.ts:104,110-122`; `enrollmentFiles.ts:11-18` |
| M-11 | Medium | valid | **open** | NONE | `verify-qr/route.ts:73,120-158` |
| M-12 | Medium | valid | **open** | NONE | `attendance-verification-token.ts:42-59,82-96` |
| M-13 | Medium | valid | **open** | NONE | `super-admin/regions/[id]/check/route.ts:12-19,157-167` |
| M-14 | Medium | **overstated** | **partial** | WT (cost only) | `public/clients/route.ts:23-49` |
| M-15 | Medium/Low | valid but conditional | **open** | NONE | `firestore.rules:15-20` |
| L-1 | Low | valid | **open** | NONE | `firestore.rules:186-188` |
| L-2 | Low | valid | **open** | NONE | `firestore.rules:501-510,525-529` |
| L-3 | Low | valid | **open** | NONE | `firestore.rules:373-377` |
| L-4 | Low | valid | **partial** | WT (payroll pages only) | data-export / qr-management / work-orders pages still list via SDK |
| L-5 | Low | valid | **open** | NONE | `internal/enrollment-draft-cleanup/route.ts:9-21` |
| L-6 | Low | valid | **open** | NONE | `health/route.ts:18-24,34-40` |
| L-7 | Low | valid | **open** | NONE | `employees/lookup/route.ts:15-63` |
| L-8 | Low | valid | **open** | NONE | `import/commit/route.ts:251-256,693-694` |
| L-9 | Low | valid at the time | **not-applicable** | WT (retired) | guard payslip routes = 410 |
| L-10 | Low | valid | **partial** | WT (wage-config only) | `import/preview/route.ts:74` before `:82-98` |
| L-11 | Low | valid at the time | **not-applicable** | WT (retired) | both payslip routes = 410 |
| L-12 | Low | valid | **open** | NONE | `storage.rules:17-19,204-208` |
| L-13 | Low | valid | **open** | NONE | `storage.rules:80-93` vs `:96-107` |
| L-14 | Low | valid | **open** | NONE | npm audit: 90 vulns, 6 `next` advisories |
| L-15 | Low | valid | **open** | NONE | `.env*` ignored & untracked; mode 644 |

**Counts:** fixed **2** · partial **3** · open **37** · regressed **0** · not-applicable **2** (total 44).

---

## 4. Fresh independent pass

### 4.1 Retirement surface (payroll / leave / wage-config / payslips)

The retirement is **sound**. Verified rather than assumed:

- The 16 retired modules contain **only** a `NextResponse.json({…}, {status: 410})` per exported method (5-9 lines each); `grep -c "firebaseAdmin\|adminDb\|\.collection(\|\.doc(\|requireAdmin\|requireGuard"` over those files returns **nothing**. `src/app/api/admin/payroll/run/route.ts:1-5`, `src/app/api/guard/leave/route.ts:1-13`, `src/app/api/field-officer/upload/route.ts:1-16` are representative.
- They do not authenticate — correct: a 410 leaks no identity information and cannot be used as an oracle beyond "this route once existed".
- The retirement's own regression test asserts the same invariants and asserts the 410 is served **without auth** (`src/app/api/payroll-leave-retirement.test.ts:70-101`).
- Backing collections are now deny-all for clients (`firestore.rules:382-384, 425-443, 584-587` for `leaveRequests`/`leaveBalances`), so retiring the API did not leave the data client-readable.
- No dashboard route still returns payroll/leave payload fields (`admin|client|field-officer|guard/dashboard` checked; test at `payroll-leave-retirement.test.ts:104-116`).

### 4.2 Guard authentication (reworked in the working tree)

Checked for regressions; **no auth bypass found**:

- `setup-pin` requires phone **and** DOB to match the same employee doc, refuses non-`active` employees, refuses when a PIN already exists, and elects one winner through a compare-and-set reservation (`src/app/api/guard/auth/setup-pin/route.ts:150-186, 186-235`).
- Identity for all guard APIs is resolved from the **linked profile**, not from the token claims: `linked-profiles.ts:34-76` matches `guardAuthUid`, fails closed on duplicate links (`:63`), and rejects inactive/deprovisioned profiles (`:26-32`).
- PIN verification is still scrypt N=16384 with per-PIN salt and `timingSafeEqual` (`src/lib/guard/pin-utils.ts:14-55`), with dummy-KDF equalisation and transactional lockout in `guard/auth/login/route.ts:234-266`.
- Every guard route I sampled enforces `role === "guard"` server-side (`src/lib/server/guard-auth.ts:15-17`), not the Firestore email-suffix helper.
- No session cookies are used anywhere (`grep -rn "cookies()\|Set-Cookie\|createSessionCookie" src` → 0 hits); auth is `Authorization: Bearer <ID token>` only, so there is no CSRF surface for the API.

### 4.3 Authz helper coverage

Scanned all 167 `src/app/api/**/route.ts` for routes that neither import an auth helper nor are deliberately public:

- **Public by design / token-gated (verified individually):** the 15 `public/*` routes, `employees/lookup`, `employees/public-profile/[id]`, `health`, `guard/auth/{login,setup-pin,send-reset-otp,verify-reset-otp,pin-status}`, `public/attendance/{upload,upload-token}`, `public/enroll/{draft,upload}`, `internal/enrollment-draft-cleanup` (CRON_SECRET), `attendance/submit` (token or auth), `employees/enroll` (draft token *or* designated Aadhaar admin — `employees/enroll/route.ts:103-122`).
- **Super-admin cluster is uniformly `requireSuperAdmin`** (14/14 routes under `super-admin/*`), and the wizard cluster is `requireAdminLike` with `verifyRequestAuth` (7/7).
- **Field-officer routes** that re-export admin handlers (`field-officer/work-orders/[id]` → admin `PATCH`, `field-officer/visit-reports` → admin GET/POST) were traced into the admin handler: the PATCH is `requireAdminOrFieldOfficer` and then district-scoped and field-allowlisted (`admin/work-orders/[id]/route.ts:87-103,124,145,172-196`); the report handlers scope FOs to `fieldOfficerId == uid` (`admin/training-reports/route.ts:44-76`). No IDOR.
- Aadhaar routes are the narrowest: `requireAadhaarAdministrator` (+ `requireRecentAuthentication` on reveal) — `admin/employees/[id]/aadhaar/route.ts`, `admin/aadhaar/stage/route.ts`.
- Client-role routes all go through `resolveClientScope` + `matchesClientScope` (`client/attendance:18,67`; `client/guards:19,49`; `client/work-orders:20,70`; `client/dashboard:87`) — **but** see H-8: that predicate contains the fuzzy fallback.

### 4.4 Upload / download / export / outbound fetch

- Outbound `fetch` inventory re-derived: only **one** variable-destination fetch remains in server code — `super-admin/regions/[id]/check/route.ts:14` (M-13). All others are pinned: `vercel-provisioner.ts:8-17` (`api.vercel.com`), `firebase-management-client.ts:48`, `location-geocode.ts:116-188` (`api.opencagedata.com`), `aadhaar.ts:84` (Cloud KMS), `openrouter.ts:83`, `region-preflight.ts:72`, `guard/auth/login/route.ts:69,90` (own host), `self-queue.ts:208` (M-1, destination from `Host`). `pdf-utils.ts:72` still unvalidated but still unimported.
- Upload paths: `public/enroll/upload` (M-10) and `public/attendance/upload` (token-bound, 10/min) are the only anonymous writes to the bucket. `guard/profile/documents` POST sniffs magic bytes; its **GET** is M-4.
- Exports: attendance CSV (M-3). `write-excel-file` XLSX paths still cannot emit formulas (no `{type:'Formula'}` call sites in `src`).
- CORS: `cors.json` pins five origins; the only route that rewrites bucket CORS is `admin/deploy-cors` (N-4).

### 4.5 Headers / CSP / CORS

- `next.config.ts:28-56` unchanged: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `poweredByHeader: false`. `middleware.ts:3-25` still builds a nonce-based CSP with `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- Two weaknesses worth recording (N-5): `connect-src 'self' https: wss:` and `img-src 'self' data: blob: https:` are wildcards, so any of the stored-XSS vectors in this report (M-3 handoff, M-4, M-8) can exfiltrate to an arbitrary host; and `middleware.ts:46-56` excludes `/api` from the CSP matcher entirely, so **API responses carry no CSP at all** — which matters for M-4, since the SVG is served from an API route.

### 4.6 Mass assignment / IDOR sweep

- `admin/clients/[id]` PATCH, `admin/field-officers/[id]`, `admin/notifications/send`, `admin/work-orders/[id]` all gate on `requireAdmin`/`requireAdminOrFieldOfficer` and validate payloads; the employee write surface is rules-bounded to `isAdmin` with the new `validTcsCategory` constraint (`firestore.rules:199-220`).
- `admin/employees/[id]` exports **GET only** (`grep "export async function"` → 1 hit), so there is no server-side employee PATCH to mass-assign through; employee mutation stays admin-only via rules.
- The new `guard/leaderboard` route is the only new IDOR-adjacent surface — see N-2.

---

## 5. New findings (since the audited revision / previously unreported)

### N-1 · **High** — Anonymous attendance credential (QR badge) disclosure completes a forgery chain that needs neither the phone number nor the QR secret

**Files:** `src/app/api/employees/public-profile/[id]/route.ts:75-84` · `src/app/api/employees/enroll/route.ts:302-305,325` · `src/lib/qr.ts:8-21` · `src/app/api/public/attendance/employee/route.ts:9-13` · `src/app/api/public/attendance/identify/route.ts:214-231` · `src/app/api/attendance/submit/route.ts:322-338`.

**What:** Non-admin enrollment stores `qrCodeUrl` = `QRCode.toDataURL(buildQrContent(employeeId, fullName, phone))` on the employee document, i.e. a PNG of the **signed attendance badge**. `GET /api/employees/public-profile/{employeeDocId}` is unauthenticated and returns `data.qrCodeUrl` verbatim in its fallback branch. Employee doc ids are themselves handed out anonymously by `/api/public/attendance/employee`.

**Chain (no credentials at any step):**
1. `GET /api/public/attendance/employee?employeeId=CISS/…/871` → `{ employee: { id: "<empDocId>", phoneNumber, attendanceHint } }` (H-1).
2. `GET /api/employees/public-profile/<empDocId>` → `qrCodeUrl` = `data:image/png;base64,…` (H-10).
3. Decode the PNG offline (any QR library) → `Employee ID` / `Phone` / `Token` — a **valid**, currently-signed badge.
4. `POST /api/public/attendance/identify {"method":"qr","value":"<decoded text>"}` → `verificationToken` (verifyQrToken passes because the token is genuine).
5. `POST /api/attendance/submit` with that token → attendance log + `attendanceState` + `attendanceSessions` + live `guardLocations` (`submit/route.ts:974`) for that guard.

**Impact:** identical to C-2, but with **zero** reliance on C-3's fallback secret and zero guessing of the 999-value employee-id space. It also survives a C-3 fix. `PendingReview` self-enrolled records are rejected by `identify:111-116`, so the target set is the existing Active workforce — which is the payroll source of record.

**Fix:** delete the fallback branch in `public-profile/[id]` (return 404 unless an explicitly-published, Active `publicProfile` exists), never emit `qrCodeUrl` from any route reachable without an authenticated owner/admin, and treat badge images as credentials (regenerate on rotation, store an object reference not the payload). Fixing C-2 (real second factor on `identify`) also breaks the chain.

---

### N-2 · **Medium** — `guard/leaderboard` hands every guard the `employeeId` of up to 50 peers, i.e. the C-2 identification key

**File:** `src/app/api/guard/leaderboard/route.ts:50-120` (new in the Oct 26 tree).

**What:** any guard (`requireGuard:52`) queries `employees where district == <own district>` (`:66`), `limit(1000)` (`:74`), maps each peer to `{ id, employeeId, employeeCode, clientId, clientName, district, profilePicUrl, trainingScore, … }` (`:93-105`) and returns the top 50 (`:120`).

**Impact:** `employeeId` is precisely the value `POST /api/public/attendance/identify {"method":"employeeId","value":…}` needs (C-2). The prior audit characterised the attack as a ~999-request sweep per client/FY; this route converts it into a single authenticated GET that returns named, real codes for an entire district, including the `id` (doc id) that H-10 then turns into a badge. It also discloses peer names, employer and district to a 4-digit-PIN account.

**Fix:** return only the caller's own row plus an anonymous rank, or replace `employeeId`/`id` with an opaque leaderboard key; keep `clientId`/`clientName` out of a guard-facing payload. Real fix remains C-2.

---

### N-3 · **Low** — APK download/update endpoints now advertise (and redirect to) deleted artifacts

**Files:** `public/downloads/ciss-workforce-android.json:6-9` (`apkPath: "/downloads/ciss-workforce-1.0.21.apk"`, `sha256`, `sizeBytes`) · `src/app/api/public/download/android/route.ts:11-19` · working tree `git status` → `D public/downloads/*.apk` (10 files, `ls public/downloads/` now shows only `README.md` and the manifest).

**Impact:** `/api/public/download/android` 302s to a path that no longer exists → guards following the documented install link get a 404; `/api/public/app-update` advertises a version/size/hash for an artifact the origin cannot serve. No memory-safety or auth impact, but it is a distribution-integrity and availability regression introduced by the retirement commit set, and it **does not** mitigate M-11/PA-11: the redirect origin is still `new URL(request.url).origin`.

**Fix:** restore the artifacts (or point `apkPath` at wherever they moved), keep `sha256`/`sizeBytes` in sync, and pin `apkPath` to an absolute HTTPS URL so `resolveAndroidApkUrl` (`src/lib/android-release.ts:70-75`) cannot be re-based by `Host`.

---

### N-4 · **Low** — Bucket CORS configuration is rewritten by a `GET` (state-changing safe method)

**File:** `src/app/api/admin/deploy-cors/route.ts:8-20`.

**What:** `GET` → `requireAdmin` → `readFileSync("cors.json")` → `bucket.setCorsConfiguration(...)`. Every successful call mutates production bucket CORS; there is no confirmation, no audit document, and a `GET` is cacheable/prefetchable by browsers, link scanners and proxies.

**Impact:** any admin (not just superAdmin) can change who may read/write Storage from a browser; an accidental crawl of the URL re-applies config. `cors.json` also includes `https://fo.cisskerala.site` — fine, but the set is now security-relevant config without an audit trail.

**Fix:** make it `POST`, gate on `requireSuperAdmin`, write an audit event, and prefer applying CORS from CI rather than a runtime route.

---

### N-5 · **Low** — CSP does not apply to `/api` and uses wildcard `connect-src`/`img-src`, so the stored-XSS vectors can exfiltrate anywhere

**Files:** `src/middleware.ts:6-14, 46-56`.

**What:** `connect-src 'self' https: wss:` and `img-src 'self' data: blob: https:` permit beacon/image exfiltration to any HTTPS host; the matcher `"/((?!api|…).*)"` excludes every `/api/*` response, so the SVG served by M-4 (`/api/guard/profile/documents`) and the CSV from M-3 arrive with **no** CSP header at all.

**Impact:** materially raises the value of the stored-XSS surface from "script runs" to "token exfiltrates in one request" — M-4 (SVG rendered from an API route with no CSP), M-8 (attacker-authored `workOrderTodos` content), and the CSV handoff in M-3. Mitigating factor: Firebase ID tokens are in memory, not cookies, so the thief must also read `localStorage`/IDB — which script on the origin can do.

**Fix:** serve API responses with at least `Content-Security-Policy: default-src 'none'; sandbox` (or `X-Content-Type-Options` + attachment), restrict `connect-src` to the Firebase/Google endpoints actually used, and never serve user-influenced `image/svg+xml` inline (M-4).

---

### N-6 · **Low** — Anonymous enrollment can create employee documents (roster/queue pollution), bounded only by a per-`ip:phone` counter

**Files:** `src/app/api/public/enroll/draft/route.ts:27-51` · `src/app/api/employees/enroll/route.ts:160-186, 300-330`.

**What:** with only a draft token for a phone number the caller chose, `POST /api/employees/enroll` creates a real `employees` document (`status: "PendingReview"` for non-admin submissions, `:320`), with a generated `employeeId`, a `qrCodeUrl`, an encrypted-Aadhaar field and a `consents` sub-document (`:306-330`). Nothing verifies the phone number (no OTP at draft time).

**Impact:** unbounded creation of plausible employee records (and consents) in the operational roster, each of which is then visible through `public-profile` (H-10) and listable by admins. `PendingReview` status correctly prevents it from being identified/attended (`identify:111-116`), which bounds the damage to data pollution and cost; it does **not** bound volume, because the only limit is `ip:phone` (M-9, H-3).

**Fix:** require an OTP or reCAPTCHA before the draft, and cap outstanding drafts per phone globally. (This is the *creation* half of M-9; recorded separately because the prior audit graded M-9 as a cost/draft issue and did not note that the draft leads to a persisted employee record.)

---

### N-7 · **Info** — `admin/states` GET falls back to scanning `employees`, and `POST` mints a `states` document from caller input

**File:** `src/app/api/admin/states/route.ts:17-44, 51-78`.

Admin-gated (`:19-22`) and superAdmin-gated for write (`:53-56`), so not a vulnerability today; recorded because the fallback derives `stateCode` values from an arbitrary 500-employee sample (`:35-41`), which can present a misleading state list to the wizard, and `POST` accepts any `stateCode` string without validation (`:70-76`). Low/informational.

---

## 6. Checked and found sound (fresh pass) — do not re-report

| Area | Evidence | Verdict |
|---|---|---|
| Retirement tombstones | 16 modules, no auth/db imports; `payroll-leave-retirement.test.ts:70-101` asserts 410-without-auth | Sound |
| Guard identity resolution | `linked-profiles.ts:34-76` linked by `guardAuthUid`, duplicate links fail closed, inactive rejected | Sound |
| PIN crypto | `pin-utils.ts:14-55` scrypt N=16384, per-PIN salt, `timingSafeEqual`, dummy KDF on lookup miss | Sound |
| `setup-pin` identity binding | `setup-pin/route.ts:150-186` phone **and** DOB must match the same doc; CAS reservation elects one winner | Sound |
| Session handling | no cookies anywhere; bearer tokens only → no CSRF surface | Sound |
| Super-admin surface | 14/14 routes `requireSuperAdmin` | Sound |
| Aadhaar surface | `requireAadhaarAdministrator`, `requireRecentAuthentication` on reveal, deny-all rules | Sound |
| FO work-order PATCH | `admin/work-orders/[id]/route.ts:87-103,145` district-scoped + field allowlist | Sound |
| FO attendance range (new) | `field-officer/guard-attendance/range/route.ts:70-108` district allowlist + `MAX_RANGE_DAYS=62` | Sound |
| Client route scoping | `resolveClientScope` + `matchesClientScope` on all client routes (fuzzy fallback is H-8) | Sound modulo H-8 |
| Outbound fetch inventory | one variable destination (M-13); all others pinned hosts | Sound |
| XLSX formula injection | no `{type:'Formula'}` call sites in `src` | Sound |
| `admin/deploy-cors` origin list | `cors.json` pins 5 origins (but see N-4 for the GET/audit issue) | Sound modulo N-4 |
| Client-SDK writes to server-owned collections | `enrollments`, `payrollEntries`, `duty*`, `leave*`, `qrCodes`, `appConfig` … all `if false` | Sound |

---

## 7. Verdict lists

### 7.1 Correctly identified **and genuinely fixed** (2)

1. **H-4** — statutory settings client-writable by `compliance`/non-super `admin`. Now `allow read, write: if false` (`firestore.rules:425-427`) + 410 API.
2. **H-5** — `accounts` writing wage config / salary structures / payroll cycles. Now deny-all (`firestore.rules:429-443`) + 410 APIs.

> Both are **fixed only in the working tree**, and only because the feature was retired. `origin/main` still contains the vulnerable rules. If payroll returns, so do H-4/H-5 unless the rules are tightened to `isSuperAdmin()`/`isAdmin()`.

### 7.2 Correctly identified and **still open** (37)

- **Critical (4):** C-1, C-2, C-3, C-4.
- **High (8):** H-1, H-2, H-3, H-6, H-7, H-8, H-9, **H-10 (now High)**.
- **Medium (14):** M-1, M-2, M-3, M-4, M-5, M-6, M-7, M-8, M-9, M-10, M-11, M-12, M-13, M-15.
- **Low (11):** L-1, L-2, L-3, L-5, L-6, L-7, L-8, L-12, L-13, L-14, L-15.

### 7.3 Correctly identified but **now partially mitigated / moot** (5)

- **M-14** — *overstated in the summary line* ("with headcounts"): the payload never contained counts; ordering only. Its cost vector was **improved** in the working tree (full `employees` read → per-client `.count()`), but the roster + relative-size disclosure and the absence of a rate limit remain.
- **L-4** — payroll pages gone; the remaining client-SDK list paths still fail closed.
- **L-10** — wage-config upload retired; import preview still unbounded before parse.
- **L-9, L-11** — *not-applicable*: the affected routes are 410 tombstones.

### 7.4 Judged wrong / overstated (1, plus one narrow nuance)

- **M-14** — summary claim "anonymous client roster **with headcounts**" is wrong as written; counts were never serialised (verified against the audited revision via `git diff 72b55601 -- src/app/api/public/clients/route.ts`, where the response is `{ clients }`). The auditor's own evidence paragraph ("via the ordering") was accurate, so this is an overstatement of impact, not a fabricated finding.
- **Narrow nuance, not an error:** C-4 is graded Critical-latent; that is fair, but the audit's paired claim that guards "cannot read their own site" is also still true for the same reason (`firestore.rules:262-266` compares `resource.data.siteId`, a field `sites` documents do not carry) — it should not be read as "partially fixed".

No prior finding is judged *incorrect* in its mechanism. Every mechanism I re-derived from source reproduced as described; the differences are impact grading (M-14), severity escalation (H-10, C-1), and remediation status.

---

## 8. Needs live verification (exact check for each)

Each item below is marked **UNVERIFIED** in this report. Nothing here was tested against the live deployment.

1. **C-3 — is `CISS_QR_SECRET` set on Vercel?** Decides whether the fallback is active.
   *Check:* `vercel env ls` (read-only) for `CISS_QR_SECRET` in Production/Preview; **or** forge a token from `region-config/KL`'s `web.apiKey` and present it to `POST /api/public/attendance/verify-qr` — `verified:true` ⇒ fallback active, `verified:false` ⇒ secret is set.
2. **H-3 — does Vercel pass a client-controlled left-most `X-Forwarded-For`?**
   *Check:* 20 `POST /api/public/attendance/identify` requests with 20 distinct left-most XFF values vs. 20 with a fixed value; count `429`s (0 vs ≥5 ⇒ spoofable).
3. **M-1 — does `request.url` reflect a spoofed `Host`?**
   *Check:* `POST /api/admin/payroll/run` (now 410, so use `POST /api/admin/claims/repair`) with `Host: <unique>.dnslog.example` and a valid admin token; watch for the DNS hit carrying `Authorization: Bearer $CRON_SECRET`.
4. **C-4 — has any guard token ever carried `assignedSiteId`?**
   *Check:* decode one live guard ID token in the app (custom claims only) after a normal PIN login; if `assignedSiteId` is absent anywhere, C-4 stays latent. Optionally re-run probes B2-B4 against the deployed ruleset.
5. **H-6 — is more than one `stateCode` populated?**
   *Check:* `firestore:databases:get`-level read of `states`/`regions` counts, or an admin query counting distinct `stateCode` in `employees`/`clients`.
6. **H-7 / M-5 / N-1 — do live objects exist at those prefixes, and do real employee docs carry a `qrCodeUrl`?**
   *Check:* `gsutil ls -r "gs://ciss-workforce.firebasestorage.app/employees/*/signatures/**"` (admin-side, read-only) and a Firestore read of one employee doc's `qrCodeUrl` — then decode the returned PNG to confirm it contains a `Token:` line.
7. **Does the deployed ruleset equal the working-tree ruleset?**
   *Check:* Firebase rules release history vs. `firebase deploy` timestamps for `firestore.rules`/`storage.rules`. Every `R-*`/`S-*`-derived verdict assumes the repo ruleset is the deployed one — and note the working tree's ruleset is **not** yet deployed.
8. **M-15 — is Identity Toolkit email/password signup open?**
   *Check:* `POST https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=<web API key>` with `{"email":"probe@guard.cisskerala.app","password":"…"}` — `EMAIL_EXISTS`/`OPERATION_NOT_ALLOWED` ⇒ closed; a token ⇒ M-15 becomes live.
9. **M-8 — is `workOrderTodos` title/body rendered unsanitised?**
   *Check:* grep/read `src/app/(app)/work-orders/*` + `src/components/**` for the todo render path; a raw `{todo.title}` in JSX is safe (React escapes); `dangerouslySetInnerHTML` is not.
10. **H-8 — do any two client names collide under `normalizeClientKey`?**
    *Check:* group `clients` rows by `name.toLowerCase().replace(/[^a-z0-9]/g,'')` and look for groups of size > 1; likewise across `employees.clientName`.
11. **N-1 — is `public-profile` reachable in production, and is the env `NEXT_PUBLIC_APP_URL`/`Host`-independent?**
    *Check:* `curl -s https://cisskerala.site/api/employees/public-profile/<known doc id>` (needs a doc id) — confirm 200 + `qrCodeUrl` present; a 404/401 for missing-auth would mean a gate was added that the repo does not show.
12. **C-1 — confirm the deployed image optimizer is enabled**
    *Check:* request `/_next/image?url=<remote>&w=64&q=75` and observe a 200 with an optimized body (the audit already established `images.unoptimized` is absent; this confirms the runtime).

---

## 9. Updated remediation order

**Now (small diffs, highest leverage)**
1. `next` → **15.5.28** (or 16.x) and `sharp` → `>0.35.5-rc.1` — C-1, L-14. The prior target `15.5.24` is no longer sufficient (GHSA-2464 SVG-optimizer RCE reaches 15.5.27).
2. Delete the `publicProfile` fallback and `qrCodeUrl` from every anonymous payload — **N-1/H-10**. This alone removes the credential-theft half of the forgery chain.
3. Delete both `qr-token.ts` fallbacks, set `CISS_QR_SECRET`, fail closed — C-3; rotate + reprint badges.
4. Require a real second factor on `identify` for `employeeId`/`phone`/`resourceId`, and make the QR branch fail closed — C-2.
5. `storage.rules:113-134` → `allow get` + ownership for `signatures`/`attendance`, admin for photos — H-7. Same pass: scope `foReports` 3-segment reads to `uid` — M-5.
6. Delete `guardAssignedSiteId() != null` branches (`:257`, `:273`) and correct the comment — C-4.
7. `getClientIp` → platform-trusted IP — H-3.

**Next (days)**
8. `public/attendance/employee` + `public/attendance` + `public/clients`: authenticate or strip; add rate limits — H-1, H-2, M-14.
9. `writeStateMatches()` → read `resource` — H-6.
10. Credential/MIME hygiene: central CSV formula guard (M-3); re-encode or force `attachment` in `guard/profile/documents` (M-4); raster-only `isImage()` (L-12); content-type allowlist + no bearer tokens in enrollment upload (M-10).
11. `buildSelfUrl` → configured canonical origin (M-1); `probeUrl` allowlist + timeout (M-13); `requireSuperAdmin` + audit on `fix-email-verified` (H-9).
12. Nonce consumption for attendance/upload tokens (M-12); district-scope `attendanceSessions`/`workOrderTodos` and move todo writes server-side (M-7, M-8).
13. `client-access.ts` → authorise on `clientId` only (H-8).
14. `guard/leaderboard`: strip `employeeId`/`id`/client identity (N-2).

**Then**
15. M-9/N-6 OTP or CAPTCHA before draft; M-15 guard-domain signup lockdown; L-1…L-8, L-13, L-15; CSP tightening (N-5); `deploy-cors` POST + audit (N-4); restore APK artifacts (N-3).

---

## 10. Executive summary

1. Nothing in the prior assessment was invented: I re-derived every one of the 44 mechanisms from source, and 42 of 44 still reproduce.
2. Only **two** prior findings are fixed (H-4, H-5) — and only because the Oct 26 working tree retired payroll and set those collections to `allow read, write: if false`. `origin/main` still ships the vulnerable rules.
3. **37 findings remain open**, including all four Criticals and eight Highs. `qr-token.ts`, `identify/route.ts`, `rate-limit.ts`, `storage.rules` and `client-access.ts` are **byte-identical** on both branches.
4. The attendance-forgery chain is **worse than described**: `public-profile` returns a base64 PNG of the *signed* attendance badge for any employee doc id, so anonymous forgery needs neither the QR secret nor the phone number (H-10 → High, new N-1).
5. C-1 is unchanged at `next@15.5.22`, and the advisory set has widened: an SVG image-optimizer RCE (GHSA-2464-fhr4-w9xw) reaches **15.5.27**, so the audit's recommended `15.5.24` would not have closed it. Correct target: **15.5.28**.
6. H-1, H-2, H-3, H-6, H-8, H-9, H-10 are untouched; the whole "unauthenticated attendance + spoofable-IP rate limiting" theme is exactly where it was three weeks ago.
7. The retirement itself is clean: 16 stateless 410 tombstones with no db/auth imports, and the backing collections are deny-all for clients — no leak and no authentication on retired paths.
8. New surface produced one Medium and three Lows: a guard leaderboard that distributes peer `employeeId`s (the C-2 key), plus APK-download integrity breakage, a state-changing `GET` on bucket CORS, and a CSP that neither covers `/api` nor constrains `connect-src`.
9. Severity corrections from this pass: **H-10 Medium → High**; **C-1 remediation target 15.5.24 → 15.5.28**; **M-14 overstated** ("headcounts" were never serialised; only ordering).
10. Twelve live checks in §8 would settle every remaining conditional; the highest-value ones are #1 (QR secret set?), #2 (XFF spoofable?), #6 (does live `qrCodeUrl` decode to a badge?) and #7 (is the deployed ruleset the repo ruleset?).

---

*Read-only re-audit. No product file, ruleset, deployment, or live system was modified. Companion evidence: `reports/audit/VULNERABILITY-REPORT.md`, `public-api-findings.md`, `rules-findings.md`, `file-export-ssrf-findings.md`.*
