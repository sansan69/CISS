# Integration / regression re-audit — payroll-leave retirement, multi-state, web↔mobile contract

**Repo:** `/Users/mymac/Documents/CISS` (Next.js 15.5.22) — HEAD `cad17132`, **dirty working tree** (81 porcelain entries: 41 M, 29 D, 11 `??`)
**Mobile repo (read-only):** `/Users/mymac/Documents/CISS-Mobile` — branch `wip/redesign-1.0.21`, HEAD `edfec10`, 84 dirty files
**Date:** 2026-10-26 · **Verifier:** integration-verifier (task-3)
**Mode:** read-only. No branch switch, merge, reset, commit, push, deploy; no live Firebase/Vercel access. Only file written: this report. Build/test side effects: `.next/`, `/tmp/ciss-*.log`.

Verification standard used throughout: *run it and show the exit code*, *read the file*, *label what was not verified*. Plan claims were treated as untrusted inputs.

---

## 1. Gates — exact commands and results

All commands run from `/Users/mymac/Documents/CISS`, node `v26.7.0`, npm `11.19.0` (note: `package.json` declares `engines.node: 22.x`; npm did not block on v26). Logs kept at `/tmp/ciss-<gate>.log`.

| # | Command (verbatim) | Exit | Result | Plan claim | Verdict |
|---|---|---|---|---|---|
| G1 | `npm test` (`vitest run`) | **0** | `Test Files  81 passed (81)` / `Tests  493 passed (493)`, 3.60 s | 81 files / 493 pass | **VERIFIED** |
| G2 | `npm run typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`) | **0** | no diagnostics, no output | passes | **VERIFIED** |
| G3 | `npm run lint` (`eslint . --ext .js,.ts,.tsx`) | **0** | no diagnostics, no output | passes | **VERIFIED** |
| G4 | `git diff --check` (also `git diff --cached --check`) | **0** / **0** | no whitespace/conflict-marker errors | passes | **VERIFIED** |
| G5 | `npm run build` (`next build`) | **0** | `✓ Compiled successfully in 29.0s` → `✓ Generating static pages (163/163)` → route table printed, `ƒ Middleware 33.4 kB` | *"build fails only on `next/font` fetching fonts.googleapis.com (offline sandbox)"* | **REFUTED — build PASSES** |

### G5 detail (the plan's one failing gate)

```
> nextn@0.1.0 build
> next build
   ▲ Next.js 15.5.22
   - Environments: .env.local
   Creating an optimized production build ...
 ✓ Compiled successfully in 29.0s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (163/163)
 ...
EXIT_CODE:0
```

Cause of the prior failure is environmental, not code: this sandbox **has network access now** —

```
$ curl -sS -m 6 -o /dev/null -w "..." https://fonts.googleapis.com/css2?family=Lato
fonts.googleapis.com HTTP 200 in 0.912s
```

So the earlier "build fails on `next/font`" is an **offline-environment artifact**, and on a networked machine the **full production build of the retired tree succeeds**. This is a stronger result than the plan claimed (a green build, not a caveated one). Consequence for the report: the retirement does not introduce a build-time regression (no dangling import of the deleted `src/lib/payroll/*`, `src/types/payroll.ts`, `src/types/leave.ts`, no orphan route manifest entry).

**Build-manifest check (retired pages gone, tombstones present).** The build route table contains **no** `/payroll*`, `/settings/wage-config`, `/guard/payslips`, `/guard/leave` page entries, and exactly these retired API routes:

```
/api/admin/clients/[id]/wage-config          /api/admin/payroll/cycles/[id]/worksheet
/api/admin/clients/[id]/wage-config/upload   /api/admin/payroll/entries/[id]
/api/admin/compliance-settings               /api/admin/payroll/entries/[id]/payslip
/api/admin/payroll/cycles                    /api/admin/payroll/run
/api/admin/payroll/cycles/[id]               /api/admin/payroll/validate
/api/admin/payroll/cycles/[id]/finalize      /api/guard/leave
/api/admin/payroll/cycles/[id]/payslips      /api/guard/payslips
                                             /api/guard/payslips/[id]/payslip
```

All 15 are `563 B` static stubs — consistent with a stateless handler.

**Diff size claim:** `git diff --shortstat` = `70 files changed, 618 insertions(+), 5459 deletions(-)` → plan's "70 files, ~5.4k deletions" **VERIFIED** (the 11 untracked paths are additional and not counted).

---

## 2. Retirement integrity

### 2.1 Inventory (current working tree vs HEAD `cad17132`)

| Class | Surface | Evidence |
|---|---|---|
| **Deleted pages (7)** | `src/app/(app)/payroll/{page.tsx,loading.tsx,run/page.tsx,cycles/[id]/page.tsx,cycles/[id]/entries/[entryId]/page.tsx}`, `src/app/(app)/settings/wage-config/page.tsx`, `src/app/(guard)/guard/payslips/page.tsx` | `git status` ` D` ×7; absent from build manifest |
| **Deleted lib (10)** | `src/lib/payroll/{calculate,attendance-aggregator,wage-template-evaluator,wage-template-parser,defaults,payslip}.ts` + 4 sibling `*.test.ts` | ` D` ×10; `ls src/lib/payroll` → does not exist |
| **Deleted types (2)** | `src/types/payroll.ts` (218 L), `src/types/leave.ts` (36 L) | ` D`; `ls src/types \| grep -iE 'payroll\|leave'` → empty |
| **Tombstoned API (15 modules / 22 handlers)** | see table below | all `M`, all 410 |
| **Navigation** | `src/app/(app)/navigation.ts` — `Payroll` group (`/payroll`, `/leave`) + `settingsSubItems` `/settings/wage-config` removed | `navigation.ts` diff |
| **Guard nav** | `src/components/guard/guard-bottom-nav.tsx` — `Pay` tab (`/guard/payslips`) removed | diff |
| **Settings UI** | `src/app/(app)/settings/page.tsx` — "Wage Configuration" card removed | diff |
| **Dashboard quick action** | `src/components/dashboard/actions.tsx` — `accounts: [{label:"Run payroll", href:"/payroll/run"}]` → `accounts: []` | diff |
| **Notifications** | `src/types/notification.ts` dropped `"leave_approved"`; `src/lib/notifications.ts` dropped `'payslip_ready'`; `src/app/api/admin/notifications/send/route.ts` dropped `"leave_approved"` | diffs; `rg 'leave_approved\|payslip_ready'` → **no matches** |
| **Dashboard payload** | `src/app/api/guard/dashboard/route.ts` — `leaveBalance` removed from response | diff (it was hard-coded `null` at HEAD) |
| **SEO/robots** | `src/app/robots.ts` — `"/payroll"` disallowed path removed | diff |
| **Copy** | `src/app/admin-login/page.tsx` ("payroll" from hero, "Automated payroll with Kerala slab compliance" tile), `src/app/enroll/page.tsx` ("payroll verification" → "bank detail verification") | diffs |
| **Region onboarding** | `src/lib/server/region-onboarding.ts` — `complianceSettings/global` seeding + `DEFAULT_COMPLIANCE_SETTINGS` removed; `seededDocs` 4 → 3 via `REGION_DEFAULT_SEEDED_DOCS` | diff |

#### Tombstone table (statelessness verified by reading every file)

| Route file under `src/app/api/` | Methods | Handler body |
|---|---|---|
| `admin/clients/[id]/wage-config/route.ts` | GET, PUT | `NextResponse.json({error:"This feature has been retired."},{status:410})` |
| `admin/clients/[id]/wage-config/upload/route.ts` | POST | idem |
| `admin/compliance-settings/route.ts` | GET, PUT | idem |
| `admin/payroll/cycles/route.ts` | GET, POST | idem |
| `admin/payroll/cycles/[id]/route.ts` | GET, DELETE | idem |
| `admin/payroll/cycles/[id]/finalize/route.ts` | POST | idem |
| `admin/payroll/cycles/[id]/payslips/route.ts` | POST | idem |
| `admin/payroll/cycles/[id]/worksheet/route.ts` | GET | idem |
| `admin/payroll/entries/[id]/route.ts` | GET, PATCH | idem |
| `admin/payroll/entries/[id]/payslip/route.ts` | GET | idem |
| `admin/payroll/run/route.ts` | POST | idem |
| `admin/payroll/validate/route.ts` | GET | idem |
| `guard/leave/route.ts` | GET, POST, PATCH | idem |
| `guard/payslips/route.ts` | GET | idem |
| `guard/payslips/[id]/payslip/route.ts` | GET | idem |

**Statelessness: CONFIRMED.** Only import in all 15 files is `import { NextResponse } from "next/server";` (verified file-by-file with `head -3`). No `requireAdmin`/`requireGuard`/`requireSuperAdmin`/`verifyRequestAuth`, no `firebaseAdmin`/`db`, no `.collection(`/`.doc(`, no `runtime`/`maxDuration` exports left behind, no environment reads. → they cannot authenticate, read, or write; every method answers 410 with no side effects.

**No head-version method was lost:** comparing `git show HEAD:<route>` handler sets against the tombstones shows only *additions* (`admin/payroll/cycles` gained POST, `admin/payroll/entries/[id]` gained GET). So no retired method now degrades to `405` instead of `410`.

### 2.2 Grep matrix for retired identifiers

Pattern `payroll|payslip|leaveRequests|leaveBalances|wage-config|clientWageConfig|salaryStructures|employeeSalaries|complianceSettings` (case-insensitive) over `src scripts public README.md next.config.ts vercel.json firebase.json`, excluding `node_modules`, `.next`, `package-lock.json`, `**/graphify-out/**` → **92 hits**:

| Hits | Location | Classification |
|---|---|---|
| 37 | `src/app/api/payroll-leave-retirement.test.ts` | retirement test (intentional) |
| 31 | `src/database-config.test.ts` | rules test (intentional) |
| 11 | `src/app/settings-surface.test.ts` | surface test (intentional) |
| 7 | `scripts/migrate-add-state-code.ts:27-33` | **intentional** — one-shot historical `stateCode` backfill listing the retired collection names; header documents it as a migration |
| 1 | `README.md:8` | **intentional** — documents the retirement |
| 1 | `public/sw.js:10` | **BROKEN REFERENCE** (R6 below) |
| 1 | `src/app/api/admin/clients/[id]/route.ts:145` | **LEFTOVER** (see L2) |
| 1 | `src/lib/server/guard-profile-view.ts:32` | comment only ("free of … payroll …") |
| 1 | `src/app/api/employees/profile/[id]/route.test.ts:94` | negative assertion (intentional) |
| 1 | `src/lib/server/regional-state-fallbacks.test.ts:120` | negative assertion (intentional) |
| — | *all other 723 raw matches* | `src/lib/graphify-out/graph.json`, `src/types/graphify-out/graph.json` — stale generated artifacts (L4) |

Second sweep, bare `\bleave\b|leaveBalance|leaveRequests` in non-test `src` → 6 hits, all prose/CSS/comments: `enrollment-consents.ts:39,56` (statutory language, intentionally preserved), `globals.css:468` (`.status-dot-leave`), `badge.tsx:32` (`leave:` variant), plus two English-word comments. These are the **preserved `OnLeave` employment status** the design requires (`payroll-leave-retirement.test.ts:111-124`), not a leave workflow.

Third sweep for route literals: `rg '"/payroll|"/leave|/settings/wage-config|/guard/payslips"' src public` → **no matches**. No page, nav, sitemap, manifest, or link still points at a retired surface.

Active fetches of retired endpoints: `rg -g '!*.test.ts' 'api/admin/payroll|api/guard/payslips|api/guard/leave|wage-config|compliance-settings' src` → **no matches (exit 1)**.

### 2.3 Leftovers (with classification)

| ID | Location | What | Classification |
|---|---|---|---|
| **L1** | `public/sw.js:5-21` (`APP_SHELL_URLS:10` = `'/guard/payslips'`) | Service worker precaches a route that no longer exists. `cache.addAll()` **rejects if any request is non-2xx**, so the `install` handler's `event.waitUntil` rejects and the SW never installs. `/guard/payslips` returns 404: the built manifest has no such route and `src/middleware.ts` only injects CSP (no redirect; `matcher` lines 46-57). SW is registered by `src/components/pwa-loader.tsx:12`; nothing in `src/**/*.test.ts` references `APP_SHELL_URLS` or `public/sw.js` (`rg -ln` → exit 1), so no gate can catch it. | **BROKEN REFERENCE** — pre-existing entry, missed by the retirement inventory; user-visible (new visitors get no offline shell / no PWA install) |
| **L2** | `src/app/api/admin/clients/[id]/route.ts:145,155,164` | `DELETE /api/admin/clients/{id}` still reads `clientWageConfig/{id}` and returns `409 … "wage configuration"` if present. File is **unmodified** by the retirement (not in `git status`), so this is a surviving retired-collection read on a live endpoint. Admin SDK bypasses rules, and it reads only existence (no payload leak). | **LEFTOVER** — arguably desirable (protects historical config) but undocumented; behaviour/message references a retired concept |
| **L3** | `src/app/api/admin/compliance-settings/route.ts` | Retiring this route also retired the only surface that could edit statutory rates (EPF/ESIC/PT/TDS slabs). Design (`spec …design.md:30`) says *preserve statutory identifiers/fields*; the page `(app)/settings/compliance-settings/page.tsx` was already absent at HEAD (`settings-surface.test.ts:19` asserts absence), so no UI regression — but there is now no admin path to change statutory rates. | **INTENTIONAL-BY-SCOPE, needs product sign-off** (scope reads "compliance-workflow" in `README.ts:8`) |
| **L4** | `src/lib/graphify-out/graph.json`, `src/types/graphify-out/graph.json` (both git-tracked, plus hundreds of `cache/ast/*.json` payloads) | Committed generated graphs still enumerate `payroll/calculate.ts`, `payroll/wage-template-parser.ts`, `payslip.ts`, `leave-aggregator.ts` as live modules (hundreds of nodes/edges). Not imported by code; not linted/typechecked (`.ts/.tsx/.js` only); `.next` and `graphify-out` are excluded from vitest (`vitest.config.ts:9-14`). | **STALE ARTIFACT** — makes any "grep is clean" claim false; cosmetic |
| **L5** | `patches/`, `docs/superpowers/…`, both new `*.test.ts` | 11 untracked paths. `git add -u` would commit the retirement **without its two new test files**; `git add -A` would also commit `.tmp_lookup_bank.mjs` (a stray script that parses `.env.local` and initialises `firebase-admin` against the live project) and `.freebuff/`. | **RELEASE HYGIENE** |

### 2.4 Do the retirement tests assert what they claim?

**`src/app/api/payroll-leave-retirement.test.ts` (4 tests, all passing — measured: `4 tests`, 12 ms).** Read in full; findings:

| Assertion | Verdict |
|---|---|
| `:57-65` absence of 5 page paths | **PARTIALLY VACUOUS.** 3 real checks (`(app)/payroll`, `(app)/settings/wage-config`, `(guard)/guard/payslips`). But `src/app/(app)/leave` **never existed at HEAD** (`git ls-tree -d HEAD 'src/app/(app)/'` → no `leave`) and `src/app/(guard)/guard/leave` **never existed in this checkout** (`git ls-tree -r HEAD 'src/app/(guard)/'` → attendance, dashboard, evaluations, payslips, profile, training, quiz, layout). These two `expect(existsSync(...)).toBe(false)` cannot fail here regardless of what the change does. They only become meaningful after a merge onto `origin/main`, which **does** contain `src/app/(guard)/guard/leave/page.tsx` (see §6.4). |
| `:67-70` nav/settings regex | Real (reads files; `navigation.ts` and `settings/page.tsx` genuinely cleaned). |
| `:74-79` `formerFeaturePaths` length 15 | Real; independently confirmed = 15 route files. |
| `:80` `legacyHandlers.length >= 17` | **WEAK.** Actual handler count is **22**; the `>=17` bound lets 5 handlers disappear unnoticed. |
| `:82-88` every discovered handler returns 410 + JSON `error` | Real and meaningful *for methods that still exist* (see §2.1: no method was lost). |
| `:90-94` "must not authenticate or access feature data" | **NARROWER THAN ITS NAME.** Regex is `/require(Admin\|Guard)\|firebaseAdmin\|adminDb\|\.collection\(\|\.doc\(/`. It would **not** catch `requireSuperAdmin`, `verifyRequestAuth`, `requireSession`, `getFirebaseAdmin()`, or an aliased db handle. I verified statelessness **by reading all 15 files** (only `NextResponse` imported), so the conclusion holds — but the test alone does not prove it. |
| `:97-109` dashboard payload fields | Real but narrow (4 routes; field list `leaveBalance\|payrollCycles\|payrollEntries\|payslips\|netPay\|salarySummary` — e.g. `leaveRequests` or `payslipUrl` would not trip it). Spot-checked `src/app/api/guard/dashboard/route.ts`: `leaveBalance` genuinely removed. |
| `:111-124` preserved statutory fields / `OnLeave` / consent language | Real (positive assertions on `src/types/employee.ts`, `src/lib/constants.ts`, `src/lib/enrollment-consents.ts`, `src/app/enroll/page.tsx`). |

**`src/database-config.test.ts` (20 tests, passing).** The rules matcher (`matchingAllowRules`, `:30-100`) is a hand-written mini-parser. I audited it for the "matcher normalisation bug" risk:

- `maskCommentsAndStrings` (`:102-156`) strips comments/strings before matching — so fixtures' own text cannot self-satisfy. Correct.
- `matchesPath` (`:60-74`) over-approximates: a `{var}` pattern segment matches *any* target segment, and `{document=**}` short-circuits to `true` when last. Target segments are all `__any_document_id__` placeholders (`:80-84`), which **conflates collection names with document ids** → the matcher reports *more* matching blocks than really exist. **Over-approximation is the safe direction**: it can produce false positives on "is there an allow here", never a false negative that would hide a permissive grant.
- Nested-block exclusion (`:90-97`) prevents double counting the same `allow` from parent and child.
- `isPermissiveAllow` (`:158-162`) only treats an exact `read|write|create|update|delete[, …]: if false` as deny; anything else is permissive. Safe.
- The two "control" fixtures (`:215-329`) prove the detector fires on literal-document, line-broken, root-recursive `**`, root-variable, nested, `/databases/{db}/documents`-prefixed, `/{root}/`, split-root, `(default)`-literal, whitespace `**`, and descendant-subcollection grants — i.e. the overlap classes the lead asked about **are covered by tests**, and Firestore's "any matching allow wins" semantics is the modelled threat.
- **Weakness:** these assertions validate the **working-tree** `firestore.rules` file only. They say nothing about the ruleset actually deployed (§4.3) and nothing about `storage.rules` payroll/leave (there are none — §4.2).
- `:397-398` hard-codes index counts `7` and `2`; brittle but currently true (§4.2).

**Bottom line for §2.4:** the retirement tests are *mostly* substantive; the two false-positive classes are (a) two vacuous absence checks for leave pages that never existed in this checkout, and (b) a statelessness regex much narrower than the claim it prints. Neither invalidates the retirement — I re-verified both claims independently — but neither can be cited as proof on its own.

---

## 3. Rules and indexes

### 3.1 `firestore.rules` — retired denies are effective and un-reopened: **CONFIRMED**

- Each retired collection has exactly **one** `match` block and the body is `allow read, write: if false;` — `rg -c 'match /<c>/'` = 1 for `payrollEntries` (line 382), `complianceSettings` (425), `clientWageConfig` (429), `salaryStructures` (433), `employeeSalaries` (437), `payrollCycles` (441), `leaveRequests` (593), `leaveBalances` (597).
- **No overlap can re-open them:** `rg '\*\*' firestore.rules` → **no matches** (no recursive wildcard anywhere in the file); every one of the 79 `match /…` paths (`rg -c '^\s*match\s+/'` = 79) is either the `databases/{database}/documents` root or a **literal collection name** (plus the two legitimate nested blocks `questions`, `locationHistory`). There is no `/{collection}/{doc}` catch-all and no staff-read/admin-write wildcard. Since Firestore grants if *any* matching rule allows, and no other block matches these paths, the denies are total at the rules layer.
- Subcollections of retired collections are also unreachable (default deny) — no rule matches them at all.
- Diff shows the retirement replaced genuinely permissive rules, e.g. `payrollEntries` previously granted guards read of their own payslips (`resource.data.employeeDocId == guardEmployeeDocId() || resource.data.employeeId == guardEmployeeId()`) and admin/accounts/HR writes; `complianceSettings`, `clientWageConfig`, `salaryStructures`, `employeeSalaries`, `payrollCycles` previously granted admin/accounts/HR/compliance access. All now deny.

**Unrelated rule changes travelling in the same dirty file** (outside the retirement's stated scope — flagged for the reviewer/owner, not audited by me beyond compile/semantics):
`employees` create/update gated by a new `validTcsCategory()` (+`clientName`/`tcsCategory` diff check, lines ~196-220); `notifications` denies `dutyEvent` create/update/delete; **new** deny blocks for `dutyWillingness`, `dutyRequests`, `guardAssignments`, `guardAssignmentSlots` (465-468) and `_diagnostics`, `appConfig`, `config`, `enrollmentIdentities`, `guardPinResetEvents`, `qrCodes`, `workOrderAssignmentEvents`, `workOrderRevisionEvents` (613-641); `locationHistory` field-officer read moved to a document-independent `officerOwnsGuardLocation(employeeId)` helper (139-149). Functional check of those new denies: every reader of the newly denied collections is a **server** route using the Admin SDK (`config`→`api/admin/enrollment-config`, `qrCodes`→`api/admin/qr/*`, `enrollmentIdentities`→`api/employees/enroll`, `guardPinResetEvents`→`api/guard/auth/reset-pin`, `workOrderAssignmentEvents`→`api/admin/work-orders/[id]`, `workOrderRevisionEvents`→`api/admin/work-orders/import/commit` + `api/field-officer/work-order-revisions`, `_diagnostics`→`api/super-admin/regions/[id]/check`; `appConfig`/`duty*`/`guardAssignments*` have **no** reader in `src`), and no client-SDK code reads them → the extra denies should not break the app. `validTcsCategory` is the one semantic change with **no** reader-side audit here: it can deny an admin `clientName` edit for an employee carrying `tcsCategory` (rule requires `clientName` ≈ `TCS` when `tcsCategory` is affected) — hand to a review of the duty/TCS change, not to this one.

### 3.2 `storage.rules` — nothing to deny

No `payroll|payslip|leave|salary|wage` token appears anywhere in `storage.rules` (`rg -i` → exit 1), so no retired Storage namespace exists. The file ends with `match /{allPaths=**} { allow read, write: if false; }` (`storage.rules:294`) — a default deny that (correctly) cannot narrow earlier allows, and is not relied on for any retired path. Retired payslip PDFs were generated in-memory/`payslip.ts` (deleted), not stored. **Consistent, no action.**

### 3.3 `firestore.indexes.json` — parses, retained indexes are inert

```
node -e 'JSON.parse(fs.readFileSync("firestore.indexes.json"))' → parsed OK; indexes: 138  fieldOverrides: 1
payrollEntries 7 · leaveRequests 2 · payrollCycles/clientWageConfig/salaryStructures/employeeSalaries/leaveBalances/complianceSettings 0
```

- 7 × `payrollEntries`, 2 × `leaveRequests` retained — matches `database-config.test.ts:397-398` and the live baseline claimed in `docs/superpowers/reports/2026-10-26-live-firebase-retirement-dry-run.md:25-26,41`.
- **Indexes cannot grant access** (they are query accelerators; authorization is rules-only). Retaining them is safe.
- The working-tree diff **only adds** 8 indexes and removes none: `attendanceLogs ×3`, `attendanceSessions ×1`, `dutyWillingness ×1`, `guardAssignments ×2`, `notifications ×1`.
- **Consistency wrinkles:** (i) `dutyWillingness`/`guardAssignments` indexes belong to APIs that **do not exist in this checkout** (they exist on `origin/main` — §6.4), so the index manifest was reconciled against a newer branch than the code; (ii) the file was reconciled to the live 138-index baseline, meaning any index that `origin/main` added and live lacks is *not* represented — deploy order matters.

### 3.4 Boundary — what "deny" does *not* cover

- Firestore rules never constrain the **Admin SDK**, so the tombstones (and any other server code) are unaffected; conversely the deny only becomes a real barrier once **both** the rules are live **and** the web deployment that could read those collections with the Admin SDK is the retired one.
- Per `…live-firebase-retirement-dry-run.md:29-42` the retirement denies **were deployed** to `ciss-workforce` (job `1793019489439`, readback verified, syntax `OK: No errors detected`). **I did not and cannot verify live state** (read-only, no live access, per task constraints) — treat that report as the only evidence for the live side.
- That deployed ruleset is described as a *candidate derived from `origin/main`* rules plus the 8 deny blocks — i.e. **≠ the working-tree `firestore.rules`** (which also carries the tcs/duty/notification denies above). Nobody has validated the working-tree ruleset's syntax in this session; I did not run the emulator. Mark: **UNVERIFIED (compile-level)**, and see risk R4.

---

## 4. Multi-state readiness

### 4.1 Claimed `REGION_CODE` fallbacks — all six **VERIFIED**

| Claimed path | Evidence | Verdict |
|---|---|---|
| claims/repair (4 sites) | `src/app/api/admin/claims/repair/route.ts:51,79,163,171` — `data.stateCode ?? "KL"` → `getRegionStateCode(...)`; `rg -c 'getRegionStateCode\('` = 4, no `?? "KL"` remains | ✅ |
| linked-profiles | `src/lib/server/linked-profiles.ts:100` — `normalizeText(data.stateCode) \|\| "KL"` → `getRegionStateCode(data.stateCode)` | ✅ |
| report-server (2 sites) | `src/lib/reports/report-server.ts:93` (site serialization) and `:118-119` (`reportMatchesAdminScope`) → `getRegionStateCode` | ✅ |
| training-reports | `src/app/api/admin/training-reports/route.ts:75` — `where("stateCode","==",decoded.stateCode \|\| "KL")` → `getRegionStateCode(decoded.stateCode)` | ✅ |
| visit-reports | `src/app/api/admin/visit-reports/route.ts:102` — same change | ✅ |
| admin/states | `src/app/api/admin/states/route.ts:41` — `codes.add("KL")` → `codes.add(REGION_CODE)` | ✅ |
| (bonus) region-onboarding seed | `src/lib/server/region-onboarding.ts` — `complianceSettings/global` + `DEFAULT_COMPLIANCE_SETTINGS` removed; `REGION_DEFAULT_SEEDED_DOCS` = 3 docs | ✅ |

New helper: `src/lib/runtime-config.ts:15-17` `getRegionStateCode(value)` → trimmed string or `REGION_CODE`; `REGION_CODE` itself (`:8-13`) = `NEXT_PUBLIC_REGION_CODE ?? REGION_CODE ?? "KL"`, upper-cased. Behaviour for absent metadata is exercised by `src/lib/server/regional-state-fallbacks.test.ts` (8 tests; 3 behavioural DB-stub tests + 3 textual/source tests + 1 behavioural importing `REGION_DEFAULT_SEEDED_DOCS` + 1 trim test). Note: the spec doc says "7 tests" for this file — the actual count is **8** (doc drift, harmless).

### 4.2 Remaining hard-coded `KL` / Kerala — functional vs copy

**Functional (would affect a Tamil Nadu deployment):**

| ID | Location | Impact |
|---|---|---|
| **M1** | `src/app/(app)/employees/[id]/page.tsx:119-123` (list) + `:2242` (`<Select>` over `keralaDistricts.map`) | Admin employee-edit **district picker is Kerala-only** (+ "Lakshadweep"). A TN admin cannot select a TN district, and an existing TN district value will not match any option. **Direct TN onboarding blocker** on the admin path. |
| **M2** | `src/app/(app)/leaderboard/page.tsx:48,154` | Kerala-only district filter in leaderboard UI (functional filter, wrong for TN). |
| **M3** | `src/components/work-orders/assigned-guards-export-panel.tsx:16,138` | Kerala-only district filter in the assigned-guards export panel (export scope wrong for TN). |
| **M4** | `src/lib/districts.ts:310-314` `getDefaultDistrictSuggestions()` returns `KERALA_DISTRICTS` **only** when region is `KL`, else `[]`; consumers `src/app/enroll/page.tsx:332`, `src/app/(app)/employees/enroll/page.tsx:301`, `src/app/(app)/field-officers/page.tsx:544`, `src/app/(app)/attendance-logs/page.tsx:35` | TN gets an **empty** suggestion list. Mitigated: `isRecognizedDistrictName()` (`districts.ts:383`) returns `true` when `suggestions.length === 0`, and the field is a free-text `<Input list=…>` (`enroll/page.tsx:2369`) → **enrollment is not blocked**; but alias/zone/typo resolution (`KERALA_DISTRICT_INDEX`, `DISTRICT_ZONE_MAP`, `inferKeralaDistrictFromText`) is Kerala-only, so TN district **data quality** is unguarded. |
| **M5** | `src/lib/region-wizard.ts:159` `INDIA_STATE_DISTRICTS` (contains full **Tamil Nadu** district list) | `rg 'INDIA_STATE_DISTRICTS' src` → **only the definition**; nothing imports it. The multi-state district catalogue exists but is **dead code**, so no UI can consume it — this is the obvious source to fix M1/M2/M3 with. |
| **M6** | `src/lib/runtime-config.ts:8-13,28-46` | `REGION_CODE` defaults to `KL`, and the hard requirement (`throw` in production) is enforced **only in control-plane mode** (`isControlPlaneMode()`); regional mode silently falls back to `KL`. A TN regional deployment that omits `REGION_CODE`/`NEXT_PUBLIC_REGION_CODE` would stamp `KL` on claim repair, report sites, report auth scope, report queries, admin state discovery, and derive `GUARD_AUTH_EMAIL_DOMAIN = guard.cisskerala.app` (`:47-51`). `scripts/provision-region-vercel.mjs:13-19` excludes these keys from the copied env set (they are set explicitly by the operator), so the exposure is "operator forgets". |
| **M7** | `scripts/reconcile-attendance.mjs:89` (`patch.stateCode = "KL"`), `scripts/migrate-field-officer-reports-v2.mjs:98` (`stateCode ?? "KL"`), `scripts/import-lng-petronet.mjs:16` (`const REGION_CODE = "KL"`) | Ops scripts stamp Kerala state codes. Operator-run (`--apply` convention), but if run against a TN project they write the wrong state. |
| **M8** | `src/app/api/public/regions/route.ts:4-9,31-34` and `src/app/api/public/region-config/[code]/route.ts:13-18` | Public region discovery **always injects Kerala** with `apiUrl = NEXT_PUBLIC_APP_URL \|\| "https://cisskerala.site"`. On a TN deployment whose `NEXT_PUBLIC_APP_URL` is the TN host, the advertised *Kerala* region points at the **TN** API. The design explicitly left public discovery as-is, so this is a deliberate-but-semantically-wrong default for non-KL hosts (mobile region picker consumes it). |

**Product copy / deployment constants (not functional defaults, but must be regionalised before TN launch):**
`src/app/admin-login/page.tsx:244` and `src/app/guard-login/page.tsx:291` ("Kerala security operations"); `src/app/profile/[id]/page.tsx:482` and `src/app/(app)/employees/[id]/page.tsx:1597` (PSARA undertaking "…and **Kerala** state rules" — legally state-specific, needs a TN variant, not a code bug); `src/app/api/employees/public-profile/[id]/route.ts:31-32` (demo seed data), `src/app/(app)/employees/[id]/page.tsx:530,2019` (`admin@cisskerala.app` gates — deployment identity), `src/app/layout.tsx:34`, `src/app/sitemap.ts:3`, `src/lib/android-release.ts:9`, `src/lib/client-portal.ts:8-9`, `src/lib/server/openrouter.ts:25` (base URLs / domains — need per-region env), `src/components/dashboard/live-guards-section.tsx:522` ("Reset map to Kerala overview" aria-label).

### 4.3 Positive findings worth recording

- TN field-officer **district scoping survives**: `canonicalizeDistrictName()` with empty suggestions returns the normalized value (`districts.ts:316-330`) and `districtMatches()` is normalized equality (`:284-288`) → non-Kerala `assignedDistricts` are **not** dropped, so `reportMatchesAdminScope`/employee-visibility district checks work for TN by exact-normalized match (no alias tolerance).
- Report-site and claim-payload serialization now inherit the deployment region instead of `KL`, which is exactly where a TN tenant boundary would otherwise leak `KL`.
- Public enrollment **validates** the district via `isRecognizedDistrictName` and does not hard-fail when the region has no catalogue (§M4).

---

## 5. Web ↔ Mobile contract

### 5.1 Is the mobile retirement patch applied? **NO** — and it applies cleanly

```
$ cd /Users/mymac/Documents/CISS-Mobile && git apply --check "/Users/mymac/Documents/CISS/patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch"
GIT_APPLY_CHECK_EXIT:0        # 29 files checked, no rejects
```

Positive evidence the retirement is **not** in the mobile tree:

| Mobile file:line | Still present |
|---|---|
| `lib/core/network/mobile_repository.dart:1433` | `_getJson('/api/guard/payslips')` → `fetchPayslips()` |
| `lib/core/network/mobile_repository.dart:1441-1443` | `downloadPayslipPdf()` → `/api/guard/payslips/{id}/payslip` |
| `lib/core/network/mobile_repository.dart:1470,1476,1480` | `getLeaveRequests()` / `applyLeave()` / `cancelLeave()` on `/api/guard/leave` (GET/POST/PATCH) |
| `lib/core/network/mobile_repository.dart:81-82` | cache allowlist `_alwaysFreshPaths` still lists `/api/guard/payslips`, `/api/guard/leave` |
| `lib/core/settings/module_flags.dart:20,22` | `'leave': true`, `'payslips': true` |
| `lib/core/settings/route_modules.dart:8,11` | `'/guard/leave': 'leave'`, `'/guard/payslips': 'payslips'` |
| `lib/features/guard/presentation/guard_shell.dart:20-21` | imports `guard_leave_screen.dart`, `guard_payslips_screen.dart` (subtitle copy still says "leave", ":166") |
| `lib/features/guard/presentation/screens/guard_dashboard_screen.dart:24-25,134,140` | dashboards tiles gated on `moduleEnabled(ref,'payslips')` / `'leave'` |

**Verdict: the patch is a prepared artifact, not an applied change.** Report it that way — the web retirement and the mobile retirement are **not** in the same state.

### 5.2 Mobile calls that now return 410 against this working tree

| Mobile call site | Web route (this tree) | Status |
|---|---|---|
| `GET /api/guard/payslips` (`mobile_repository.dart:1433`) | `src/app/api/guard/payslips/route.ts:3` | **410** |
| `GET /api/guard/payslips/{id}/payslip` (`:1441-1443`) | `src/app/api/guard/payslips/[id]/payslip/route.ts:3` | **410** |
| `GET`, `POST`, `PATCH /api/guard/leave` (`:1470,1476,1480`) | `src/app/api/guard/leave/route.ts:3,7,11` | **410** |

User-visible effect: with default flags on and no server override, the guard app renders the Leave tab and Payslips tile, and tapping either throws `CissError` into `GuardErrorScaffold` (`lib/features/guard/presentation/screens/guard_leave_screen.dart:255-258`) showing *"This feature has been retired."* — a dead surface, not a crash. No offline-queue impact: `lib/core/offline/offline_queue.dart` does not queue leave requests (only a comment at `:16`); `lib/core/sync/refresh_controller.dart:13` merely imports the screen.

### 5.3 Endpoint inventory: 63 mobile API paths vs web routes

Systematic comparison (all `'/api/…'` literals in `lib/**/*.dart`, `${…}`/`$var` → `[x]`, vs `src/app/api/**/route.ts` normalized the same way): **58 OK / 5 MISSING**.

| Mobile path | In this tree | On `origin/main` (`c81f4a68`) | Classification |
|---|---|---|---|
| `/api/guard/duties` | absent | `src/app/api/guard/duties/route.ts` | **checkout lag, not retirement** → 404 |
| `/api/guard/duties/{id}/willingness` | absent | `src/app/api/guard/duties/[id]/willingness/route.ts` | checkout lag → 404 |
| `/api/mobile/attendance/break` | absent | `src/app/api/mobile/attendance/break/route.ts` | checkout lag → 404 |
| `/api/mobile/settings` | absent | `src/app/api/mobile/settings/route.ts` | checkout lag → 404 (this is the remote-config/module-flags channel) |
| `/api/mobile/tracking/batch` | absent | `src/app/api/mobile/tracking/batch/route.ts` | checkout lag → 404 |

These five are **pre-existing gaps of the 16-commits-behind checkout** (`git rev-list --count HEAD..origin/main` = 16), not caused by the payroll retirement; they confirm the mobile app targets `origin/main`, not this tree. No **other** mismatch exists: every remaining mobile path resolves to a route in this tree, and the retirement is the only feature that turned a mobile path into a non-2xx (`410`).

**Response-shape check:** `GET /api/guard/dashboard` no longer returns `leaveBalance`; the mobile reader is `data['leaveBalance'] is Map<String,dynamic> ? … : <fallback>` (`mobile_repository.dart:1005-1008`). At HEAD the field was literally `const leaveBalance = null`, so the mobile app **never** received a map — **no shape break** for mobile (only the key disappears). No mobile model depends on other retired payload fields.

### 5.4 The merge that matters (retirement vs `origin/main`)

`git diff --name-only HEAD origin/main` = **136 files**; overlap with the dirty tree = **9 conflict-prone files**:

```
AGENTS.md                                  src/app/api/guard/leave/route.ts
firestore.indexes.json                     src/app/enroll/page.tsx
firestore.rules                            src/components/guard/guard-bottom-nav.tsx
src/app/api/admin/claims/repair/route.ts   src/database-config.test.ts
                                           src/types/notification.ts
```

Files that exist on `origin/main` but **not** in this checkout, and therefore are **not** retired by this change:

| `origin/main` path | Consequence after merge/rebase |
|---|---|
| `src/app/api/guard/leave/route.test.ts` (3 tests: replay-idempotency 200, reversed-dates 400, cancel ownership 403/409/200 against a real transaction mock) | **Fails wholesale** against a 410 tombstone → G1 red. Must be deleted in the same commit. |
| `src/app/(guard)/guard/leave/page.tsx` | Re-enters the tree as a **live guard page**. `payroll-leave-retirement.test.ts:62` would then fail (correctly) — but the page must be deleted, not merely asserted against. |
| `src/lib/server/guard-leave-validation.ts` + `…validation.test.ts` | Orphaned live library + green test for a retired workflow (test passes, feature is dead). |
| `src/types/leave.ts` | Delete/modify conflict (this change deletes it; `origin/main` modified it). |
| `src/lib/payroll/*.test.ts` (modified on `origin/main`) | "deleted by us / modified by them" conflicts on 4 test files. |

Net: **the retirement's green gate result is only valid for base `cad17132`.** On the branch that will actually ship (`origin/main`, 16 ahead) it has 6+ known test failures, 1 resurrected page, 1 orphan lib, and 9 manual conflict resolutions. This is the single largest process risk in the whole change set (R3).

---

## 6. Residual risks — ranked, with the concrete next action

| # | Sev | Risk | Evidence | Next action |
|---|---|---|---|---|
| **R1** | **P0** | **Android download/update pipeline is broken in this working tree.** All 10 APKs under `public/downloads/` are deleted (`ciss-mobile.apk`, `ciss-workforce-1.0.14…1.0.21.apk`, `ciss-workforce-latest.apk`) while the release manifest still points at `1.0.21`: `public/downloads/ciss-workforce-android.json` `apkPath: "/downloads/ciss-workforce-1.0.21.apk"`, and `vercel.json` rewrites `/downloads/ciss-workforce-latest.apk` **and** `/downloads/ciss-mobile.apk` → `/downloads/ciss-workforce-1.0.21.apk`. `GET /api/public/app-update` (`src/app/api/public/app-update/route.ts:11-20`) will advertise an `apkUrl` that 404s, so the in-app updater and every download link break. Unrelated to payroll retirement but in the same uncommitted tree. | `git status` ` D` ×10; `ls public/downloads` (only `.gitkeep`, `README.md`, `ciss-workforce-android.json`); `vercel.json:1-17`; manifest above | Before any commit: either restore `ciss-workforce-1.0.21.apk` (and re-add `latest`), or update the manifest `apkPath`/`sha256`/`sizeBytes` + `vercel.json` rewrites to a real artifact in the **same** commit. Verify `curl -I https://<host>/downloads/ciss-workforce-latest.apk` and `/api/public/app-update` → 200 after deploy (live step, needs authorization). |
| **R2** | **P1** | **Mobile is not retired while the API is.** Leave/Payslips remain first-class mobile surfaces (`module_flags.dart:20,22`, `route_modules.dart:8,11`, `guard_shell.dart:20-21`, `guard_dashboard_screen.dart:134,140`, repository methods) and now get `410`. Web deploy order therefore determines how many guards see a dead screen. | §5.1, §5.2; `git apply --check` exit 0 | Apply `patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch` on a mobile branch (it applies cleanly to `edfec10` + 84 dirty files — re-check after any mobile edit), run `dart analyze`/`flutter test`, ship as 1.0.22. If the web must deploy first: flip `leave`/`payslips` to `false` in the `MODULE_DEFAULTS` of `src/app/api/mobile/settings/route.ts` (server-driven flags) **and** update `src/app/api/mobile/settings/route.test.ts`, which asserts the client/server mirror. |
| **R3** | **P1** | **Green gates are base-specific.** Retiring on `cad17132` while `origin/main` is 16 commits ahead: 9 overlapping files, and `origin/main` carries `guard/leave/route.test.ts` (3 tests expecting a *working* leave API), `(guard)/guard/leave/page.tsx`, `guard-leave-validation.ts(+test)`, and a modified `src/types/leave.ts`. Merging/rebase → red tests, resurrected page, orphan lib. | §5.4; `git diff --name-only HEAD origin/main` (136) ∩ dirty tree (9) | Redo (or re-verify) the retirement **as a branch off `origin/main`**; in that same change delete `src/app/api/guard/leave/route.test.ts`, `src/app/(guard)/guard/leave/page.tsx`, `src/lib/server/guard-leave-validation.ts` + its test, and `src/types/leave.ts`; then re-run G1–G5 and re-read §2.4 (the two vacuous assertions become real there). |
| **R4** | **P1** | **Live ruleset ≠ working-tree ruleset, and the extra rules are unreviewed/unvalidated.** The deployed candidate (dry-run report `:29-42`) covers only the 8 retirement denies on an `origin/main` base; the working tree additionally changes `employees` (tcs category), `notifications` (dutyEvent), and adds 12 new deny blocks + the `officerOwnsGuardLocation` helper. Nobody has syntax-validated the working-tree file or behavioural-tested the tcs/notification changes. | §3.1, §3.4; `firestore.rules` diff; `…dry-run.md:31` | Split into two changes: (a) retirement denies, (b) the duty/tcs/notification hardening. Validate (b) with the Firestore emulator or `firebase deploy --only firestore:rules --dry-run`-style syntax check **and** a reviewer pass on `validTcsCategory` (an admin `clientName` edit is denied for employees carrying `tcsCategory` unless `clientName ≈ TCS`). Deploy (b) separately after sign-off. |
| **R5** | **P1** | **Sequencing hazard on the live app.** Until the web retirement deploys, the live site still serves the privileged payroll/leave handlers (dry-run report `:44-46`), while live Firestore already denies client reads. Correct order is: mobile flags off / new APK → web deploy (tombstones) → rules already live. Any other order exposes a window with a dead mobile surface or a live API. | §3.4, §5.2 | Write the release order into the plan and verify each step: `GET /api/guard/payslips` → 410, `GET /api/guard/dashboard` → no `leaveBalance`, mobile Leave/Payslips gone. |
| **R6** | **P2** | **PWA install fails** because `public/sw.js:10` precaches `/guard/payslips` (404) and `cache.addAll` rejects on any non-2xx → no offline shell for first-time visitors and on the next SW revision; nothing tests it. | §2.3 L1; `pwa-loader.tsx:12`; `rg 'APP_SHELL_URLS\|public/sw.js' src` → exit 1; build manifest has no `/guard/payslips` | Remove the entry from `APP_SHELL_URLS`; add a test that every `APP_SHELL_URLS` entry maps to an existing `src/app/**/page.tsx` (or `.ts`/`.html` in `public/`). Re-register once and confirm `caches.open('ciss-workforce-cache-v6')` resolves in devtools. |
| **R7** | **P2** | **TN onboarding gaps on admin paths.** Kerala-only district `<Select>` in the employee editor (M1), Kerala-only filters in leaderboard/export (M2/M3), dead `INDIA_STATE_DISTRICTS` (M5), `REGION_CODE` only enforced in control-plane mode (M6), public region discovery always advertising Kerala with the local host (M8). Public enrollment is **not** blocked (M4 mitigated) and TN district scoping works. | §4.2 | Wire district options from `states`/`region-config` keyed by `INDIA_STATE_DISTRICTS` in `employees/[id]/page.tsx:2242`, `leaderboard`, and the export panel; make `REGION_CODE` mandatory in regional mode (or assert it in `scripts/provision-region-vercel.mjs` before writing Vercel env); make `public/regions` emit the *deployment's* own region (from `REGION_CODE`) rather than a hard-coded Kerala first entry. |
| **R8** | **P3** | **Retirement-test weaknesses can hide regressions:** 2 vacuous absence assertions (`:60,62`), `>=17` vs 22 handlers (`:80`), statelessness regex narrower than its message (`:93`), dashboard-field list narrow (`:104`), hard-coded index counts (`:397-398`); spec doc says "7 tests" where the file has 8 and "492 tests" where the suite has 493. | §2.4 | Tighten to `legacyHandlers.length === 22`, extend the regex to `require(Super)?Admin\|requireGuard\|verifyRequestAuth\|firebaseAdmin\|getFirebaseAdmin\|adminDb\|\.collection\(`, add `leaveRequests\|leaveBalance\|payslipUrl` to the payload field list, and derive index counts instead of hard-coding. Update spec §63-69 numbers. |
| **R9** | **P3** | **Stale generated artifacts** `src/lib/graphify-out/graph.json`, `src/types/graphify-out/graph.json` still describe the deleted payroll modules (hundreds of nodes). | §2.3 L4 | Regenerate or delete the committed graph output; add them to an ignore list so "grep for payroll is clean" becomes literally true. |
| **R10** | **P3** | **Release hygiene:** 11 untracked paths include both new tests, the mobile patch, plan/spec/dry-run docs; `.tmp_lookup_bank.mjs` (parses `.env.local`, initialises `firebase-admin` **against the live project**) and `.freebuff/` are stray. `git add -u` silently drops the two new test files (so the "retirement is tested" claim would not be in the commit); `git add -A` commits the temp script. | `git status --porcelain \| grep '^??'` | Stage explicitly: the 41 M + 29 D + `src/app/api/payroll-leave-retirement.test.ts` + `src/lib/server/regional-state-fallbacks.test.ts` + `docs/superpowers/{plans,specs,reports}` + `patches/`; delete/ignore `.tmp_lookup_bank.mjs`, `.freebuff/`, `assignment-*` notes/patch. |
| **R11** | **P3** | **`accounts` role now has an empty quick-action list** (`actions.tsx` `accounts: []`), and `L2` still references `clientWageConfig` in the client-delete guard (message says "wage configuration"). | diffs §2.1, §2.3 | Cosmetic: confirm the dashboard renders gracefully with `[]`; decide whether the delete guard should keep protecting historical wage config (document it) or stop referencing a retired concept. |
| **R12** | **P3** | **`compliance-settings` retirement removes the only statutory-rate edit surface** (EPF/ESIC/PT/TDS). No UI regression (the page was already gone at HEAD), but future statutory changes have no admin path. | §2.3 L3; `README.md:8` | Product decision: either re-open a settings surface for statutory rates (they are employment/compliance data, not payroll workflow), or record that rates are now code/config-only. |

---

## 7. Unverified / needs live or out-of-scope evidence

1. **Live Firestore rules content and index inventory** — asserted by `docs/superpowers/reports/2026-10-26-live-firebase-retirement-dry-run.md` (job `1793019489439`, readback OK). I did not access live Firebase by constraint. If that deployment did not happen, the retired collections are still client-readable for `payrollEntries` (guards read own payslips), `payrollCycles`, `clientWageConfig`, `salaryStructures`, `employeeSalaries`, `complianceSettings`, and `leaveBalances` (which had no explicit block) — i.e. the retirement's *database* barrier would be at HEAD level. **Confirm with a rules readback before calling the retirement enforced.**
2. **Syntax/behaviour validation of the working-tree `firestore.rules`** (the tcs/duty/notification additions) — no emulator run, no deploy, no `firebase` CLI invocation. Only the 8 deny blocks are covered by the dry-run report's validation.
3. **Rules evaluation semantics against real queries** — `reportMatchesAdminScope` / `training-reports` / `visit-reports` state filtering is verified by source-text assertions and unit-level fallbacks (`regional-state-fallbacks.test.ts`), not by an authenticated runtime call.
4. **Mobile toolchain** — `dart analyze`, `flutter test`, and app-level verification were not run (mobile is read-only for me; task-02 owns the toolchain). My mobile conclusions are from source reading + `git apply --check` only.
5. **Live endpoint behaviour after deploy** — every 410 claim is proven by handler source + unit call in `payroll-leave-retirement.test.ts:82-88` and by the built route table; not by an HTTP call to `cisskerala.site` (forbidden here).
6. **Whether the deleted APKs were intentional cleanup** — I can show the manifest/rewrite mismatch objectively; intent must come from the owner.
7. **TN end-to-end onboarding** — configuration, credentials, service deployment, and legal/PSARA copy for Tamil Nadu are outside code; §4.2 lists the code-visible blockers only.

---

## 8. Executive summary

1. **Gates: 5/5 green** — `npm test` 81 files / 493 tests (exit 0), `typecheck` 0, `lint` 0, `git diff --check` 0.
2. **`npm run build` PASSES (exit 0, `✓ Compiled successfully`, 163/163 static pages)** — the plan's "build fails on `next/font`" is **refuted**; `fonts.googleapis.com` answers HTTP 200 here, so that failure was the offline sandbox, not the retirement.
3. **Retirement integrity: sound.** 7 pages, 10 lib modules, 2 type files deleted; 15 API modules tombstoned as **truly stateless 410s** (only `NextResponse` imported — no auth, no DB); nav, guard nav, settings card, dashboard action, notification types, robots, copy, dashboard payload all swept; **no active code, link, or page fetches a retired endpoint**.
4. **Leftovers:** `public/sw.js:10` still precaches `/guard/payslips` → **PWA install fails** (untested); `api/admin/clients/[id]/route.ts:145` still reads `clientWageConfig`; stale `graphify-out` artifacts.
5. **Rules: denies are effective and un-reopenable** — one `allow read, write: if false` per retired collection, **no `**` wildcard and no `/{collection}/{doc}` catch-all anywhere in `firestore.rules`**; `storage.rules` has no retired namespace; `firestore.indexes.json` parses (138) with 7 payroll + 2 leave indexes deliberately retained (inert).
6. **Tests are mostly honest, with two false-positive classes:** the absence checks for `(app)/leave` and `(guard)/guard/leave` are **vacuous in this checkout** (neither ever existed at HEAD), and the "must not authenticate" regex is far narrower than its message; `>= 17` vs the real 22 handlers. I re-verified both claims manually.
7. **Multi-state: all six claimed `REGION_CODE` fallbacks verified** (claims/repair 4 sites, linked-profiles, report-server 2 sites, training/visit reports, admin/states) plus compliance-seed removal. Remaining TN blockers are **hard-coded Kerala district pickers** (`employees/[id]/page.tsx:2242`, leaderboard, export panel), an **unused `INDIA_STATE_DISTRICTS`**, `REGION_CODE` enforced only in control-plane mode, and Kerala-hard-coded ops scripts. Public enrollment is **not** blocked.
8. **Contract: the mobile retirement patch is NOT applied** (though `git apply --check` = 0), so guard `/api/guard/payslips`, `/api/guard/payslips/{id}/payslip`, and `/api/guard/leave` now return **410** to the app; module flags default them **on**. No response-shape break (`leaveBalance` was already `null`). **5 mobile endpoints 404 purely from checkout lag** (exist on `origin/main`), not from the retirement.
9. **Biggest process risk (R3):** the green gates are valid only for base `cad17132`. `origin/main` is 16 commits ahead with 9 overlapping files and ships `guard/leave/route.test.ts` (3 real tests), `(guard)/guard/leave/page.tsx`, `guard-leave-validation.ts` — merging this retirement as-is produces red tests, a resurrected page, and delete/modify conflicts. **Redo/re-verify on a branch off `origin/main`.**
10. **Ship-blocking non-payroll defect (R1, P0):** all 10 APKs are deleted from `public/downloads/` while `ciss-workforce-android.json` (`apkPath /downloads/ciss-workforce-1.0.21.apk`) and the `vercel.json` rewrites for `ciss-workforce-latest.apk`/`ciss-mobile.apk` still target them — the Android download and in-app update path would 404 if this tree were committed and deployed unchanged.
