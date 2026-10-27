# CISS — re-audit and verification of the Codex/ChatGPT findings

**Date:** 2026-10-26
**Scope:** CISS Workforce web platform (`/Users/mymac/Documents/CISS`, Next.js 15) and CISS-Mobile (`/Users/mymac/Documents/CISS-Mobile`, Flutter 3.29 / Dart 3.7, `1.0.22+22`)
**Mode:** read-only. No product file, ruleset, deployment, Firestore document, or live system was modified. Only this file and three companion reports were written.
**Companions (full evidence, file:line per finding):**
- `reports/reaudit/web-security.md` — 44 web findings re-derived + fresh pass + 7 new findings
- `reports/reaudit/mobile.md` — 34 mobile findings re-derived + 13 new defects
- `reports/reaudit/integration.md` — retirement integrity, gates, multi-state, web↔mobile contract

---

## 0. Bottom line

**The prior findings were correct — but "everything is fixed" is not true.**

| Body of findings | Total | Fixed | Partial | Open | N/A | New |
|---|---:|---:|---:|---:|---:|---:|
| Web vulnerability assessment (2026-10-06) | 44 | **2** | 3 | **37** | 2 | 7 |
| CISS-Mobile audit (2026-10-22) | 34 | **14** | 11 | **9** | — | 13 |
| Payroll/leave retirement + multi-state (2026-10-26) | — | gates 5/5 | — | 4 leftovers | — | — |

- **Web:** 42 of 44 mechanisms reproduce byte-for-byte. The only two closed findings (H-4, H-5) closed as a *side effect* of retiring payroll — not by a security fix. All four criticals and eight of ten highs are still open in both the working tree and `origin/main`.
- **Mobile:** the remediation is real work, not paper. All client-side High findings are materially closed, `flutter analyze`/`dart analyze` are clean, 316/316 tests pass, coverage is 18.69 %. But 11 findings are partial, 9 are open, and the remediation introduced/left 13 new defects — two of which are P1.
- **Retirement:** the web side is sound and fully green (`npm test` 493 pass, typecheck, lint, **build passes**, 22 stateless 410 handlers). The **mobile side was never applied**, so the shipped app still calls five endpoints that now return 410. All 10 APKs were also deleted while the release manifest still points at one.

**Nothing in the prior audits was invented.** No web finding was wrong in mechanism; one (M-14) overstated its impact. No mobile finding was wrong; three were graded slightly generously (F-01 back-button, F-03/F-09/F-11 nuance).

> **Remediation applied after this audit (2026-10-26, same day).** The code fixes in §10 are now in the working trees: Next `15.5.28` + `sharp 0.35.5`, fail-closed QR secret, signed-badge leak removed, tokenless-QR rejection and per-guard proof limit, staff-only storage reads, document content-type allow-list, config-origin self-queue, SSRF validation, CSV-injection guard, super-admin email verify, own-region discovery, mobile retirement applied, provider invalidation, anonymous queue replay.
>
> Post-fix counts: web **11 fixed · 5 partial · 26 open · 2 N/A**; mobile **14 fixed · 11 partial · 9 open · 10 new outstanding**.
>
> Gates after the fixes: web `npm test` **527 passed**, typecheck, lint, `npm run build` all exit 0 on Next 15.5.28; mobile `flutter analyze` clean and **325 tests pass**.

---

## 1. What was verified, and how

- **Both repositories at their real current state**, including dirty working trees:
  - Web: `cad17132` + uncommitted retirement/region changes (70 files, +618/−5459). `origin/main` is 16 commits ahead (`c81f4a68`) and was compared separately.
  - Mobile: `wip/redesign-1.0.21` @ `edfec10` + 84 uncommitted changes.
- Every prior finding was **re-decided from source**, not from the remediation text. Where a fix exists, effectiveness was tested (reachability of the trigger path, actual enforced branch, not the presence of a class).
- **Gates were executed**, not quoted: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`; `flutter analyze`, `dart analyze`, `flutter test`, coverage.
- Framework-dispatch claims (app lock vs Android back) were checked against the Flutter SDK source on this machine.
- **Not done:** no deploy, no live HTTP, no Firestore emulator, no APK build, no device/emulator, no iOS toolchain, no secret values printed. Items depending on those are marked *needs live verification* (§8).

---

## 2. Web security — 44 findings

### 2.1 Verdict table

| ID | Prior sev | Valid? | Status now | Decisive evidence |
|---|---|---|---|---|
| C-1 | Critical | valid | **OPEN** | `package.json:74` → `next@15.5.22`; advisory range now reaches `15.5.27`; fix target **15.5.28** |
| C-2 | Critical | valid | **OPEN** | `public/attendance/identify/route.ts:129-135,214-231`; `attendance/submit/route.ts:322-338` |
| C-3 | Critical | valid | **OPEN** | `src/lib/qr/qr-token.ts:6-9` fallback chain; `CISS_QR_SECRET` absent from every env file |
| C-4 | Critical (latent) | valid | **OPEN** (latent) | `firestore.rules:255-273` — guard branch requires `assignedSiteId` claim, which no code issues |
| H-1 | High | valid | **OPEN** | `public/attendance/employee/route.ts:9-13,105-146` — still returns `id`, `employeeCode`, `fullName`, `phoneNumber`, `clientName`, `attendanceHint` anonymously |
| H-2 | High | valid | **OPEN** | `public/attendance/route.ts:31-45`; `lib/attendance/public-attendance.ts:80-114` (all sites + coordinates) |
| H-3 | High | valid | **OPEN** | `lib/server/rate-limit.ts:108-131` left-most XFF |
| H-4 | High | valid | **FIXED** | `firestore.rules:425-427` `if false` (retirement) |
| H-5 | High | valid | **FIXED** | `firestore.rules:429-443` `if false` (retirement) |
| H-6 | High | valid | **OPEN** | `firestore.rules:92-97` `writeStateMatches` reads `request.resource.data` |
| H-7 | High | valid | **OPEN** | `storage.rules:120-134` — signatures/attendance selfies readable by any signed-in user |
| H-8 | High | valid (conditional) | **OPEN** | `src/lib/client-access.ts:52-54` |
| H-9 | High | valid | **OPEN** | `admin/fix-email-verified/route.ts:7,22-25` — `requireAdmin`, not super-admin |
| H-10 | Medium→**High** | valid, escalation proven | **OPEN** | `employees/public-profile/[id]/route.ts:75-84` returns `qrCodeUrl` |
| M-1 | Medium | valid (conditional) | **OPEN** | `lib/server/self-queue.ts:206-232` |
| M-2 | Medium | valid | **OPEN** | `public/region-config/[code]/route.ts:14-36` |
| M-3 | Medium | valid | **OPEN** | `admin/reports/attendance/route.ts:13-23` — CSV escape only doubles quotes |
| M-4 | Medium | valid | **OPEN** | `guard/profile/documents/route.ts:96-112` — echoes stored `Content-Type`, `inline` |
| M-5 | Medium | valid | **OPEN** | `storage.rules:96-107` — 3-segment `foReports` read allows any field officer |
| M-6 | Medium | valid | **OPEN** | `firestore.rules:209-215` — client users read raw employee docs |
| M-7 | Medium | valid | **OPEN** | `firestore.rules:365-368,457-458` |
| M-8 | Medium | valid | **OPEN** | `firestore.rules:457-461` |
| M-9 | Medium | valid | **OPEN** | `public/enroll/draft/route.ts:27-51` |
| M-10 | Medium | valid | **OPEN** | `public/enroll/upload/route.ts:104-122`; `lib/enrollmentFiles.ts:11-18` |
| M-11 | Medium | valid | **OPEN** | `public/attendance/verify-qr/route.ts:73,120-158` (PII gated, duty hint still anonymous) |
| M-12 | Medium | valid | **OPEN** | `lib/server/attendance-verification-token.ts:42-59` — nonce never stored/consumed |
| M-13 | Medium | valid | **OPEN** | `super-admin/regions/[id]/check/route.ts:12-19,157-167` |
| M-14 | Medium | **overstated** | **PARTIAL** | `public/clients/route.ts:23-49` — counts were never serialised; only ordering leaks |
| M-15 | Medium | valid (conditional) | **OPEN** | `firestore.rules:15-20` — `@guard.cisskerala.app` email alone counts as guard |
| L-1…L-8 | Low | valid | **OPEN** | `firestore.rules`, `health/route.ts`, `employees/lookup`, import commit, CSP |
| L-9 | Low | valid at the time | **N/A** | guard payslip routes are 410 |
| L-10 | Low | valid | **PARTIAL** | wage-config half retired; XLSX parse still unbounded |
| L-11 | Low | valid at the time | **N/A** | both payslip routes are 410 |
| L-12 | Low | valid | **OPEN** | `storage.rules:17-19,204-208` — `image/.*` admits SVG; 100 MB training |
| L-13 | Low | valid | **OPEN** | `storage.rules:80-107` |
| L-14 | Low | valid | **OPEN** | `npm audit --omit=dev`: 90 advisories (3 critical / 22 high) |
| L-15 | Low | valid | **OPEN** | `.env*` mode `644` (untracked/ignored — correct) |

**Counts:** fixed 2 · partial 3 · open 37 · regressed 0 · N/A 2 · **new 7**.

### 2.2 The two that matter most

**The attendance-forgery chain is worse than originally graded (new N-1, High).**
`employees/enroll/route.ts:302-305` stores `qrCodeUrl = QRCode.toDataURL(buildQrContent(employeeId, fullName, phone))` — a PNG of the **signed** attendance badge. Unauthenticated `GET /api/employees/public-profile/{employeeDocId}` returns it verbatim in its fallback branch (`:75-84`), and employee doc ids are handed out anonymously by `/api/public/attendance/employee`:

```
GET /api/public/attendance/employee?employeeId=CISS/.../871   -> employee.id
GET /api/employees/public-profile/<id>                        -> qrCodeUrl (PNG)
decode PNG offline                                            -> Employee ID + Phone + Token
POST /api/public/attendance/identify {"method":"qr", ...}     -> verificationToken
POST /api/attendance/submit                                   -> attendance + state + session + live GPS
```

No phone guessing, no QR-secret recovery. Fixing C-3 alone does **not** close this. Fix C-2 (a real second factor on `identify`) and delete the `public-profile` fallback.

**C-1 has moved.** `next@15.5.22` is unchanged on every branch and worktree checked. `npm view next@15.5` now lists up to `15.5.28`; the original audit's recommended `15.5.24` would not close the newer SVG image-optimizer advisory. `npm audit` reports 90 production advisories (3 critical, 22 high) including `handlebars`, `proxy-addr`, `sharp 0.35.3`, `nanoid`.

### 2.3 Where the fixes are, and are not

- **Working tree only:** H-4/H-5 (payroll/compliance deny rules). `origin/main` still ships the permissive versions — if payroll ever returns, those return with it.
- **Never applied anywhere:** C-1, C-2, C-3, C-4, H-1, H-2, H-3, H-6…H-10 and 28 of the mediums/lows. `qr-token.ts`, `identify/route.ts`, `rate-limit.ts`, `storage.rules`, `client-access.ts` are byte-identical across the working tree, `origin/main`, `codex/production-parity`, and `CISS-dutyfix`.
- **No regression** was introduced by the retirement into the security surface.

---

## 3. CISS-Mobile — 34 findings

### 3.1 Toolchain (re-run today)

```
flutter analyze  -> No issues found!  exit 0
dart analyze     -> No issues found!  exit 0
flutter test     -> 316 passed, 0 failed  exit 0
coverage         -> 3,526 / 18,866 lines = 18.69 %
```

The remediation's headline numbers reproduce exactly.

### 3.2 Status

| Status | Findings |
|---|---|
| **Fixed (14)** | F-01 (core bypass), F-02, F-04, F-05, F-08, F-12 (closed), F-13, F-16, F-17, F-22, F-23, F-25, F-29, F-34 |
| **Partial (11)** | F-03, F-09, F-11, F-14, F-15, F-18, F-19, F-20, F-26, F-28, F-31 |
| **Open (9)** | F-06, F-07, F-10, F-21, F-24, F-27, F-30, F-32, F-33 |
| **Regressed** | none outright |
| **New (13)** | NEW-01…NEW-13 |

### 3.3 What is genuinely fixed (spot-verified)

- **F-01 app lock:** `AppLockOverlay` really is mounted in `MaterialApp.router.builder` (`lib/app/app.dart:28-31`), paints an opaque, pointer-consuming cover above the Navigator, re-arms on `paused`→`resumed`, is `uid`-bound, and fails closed if the preference cannot be read.
- **F-02 read cache:** key is `region|uid|path|query`; fallback only on transport failure; 24 h cap; the Hive box is opened with the queue's AES cipher; purged on sign-out.
- **F-03 queue/drafts:** owner-bound; drafts UID-namespaced and encrypted; secure-storage failure fails closed; purger wired into normal sign-out.
- **F-04 is *better* than the remediation claims:** the web side now has a Firestore-transaction rate limiter, per-user escalating lockout, and `setup-pin` refuses to overwrite an existing PIN (`src/app/api/guard/auth/setup-pin/route.ts:180,190-239`; `login/route.ts:234-259`).
- **F-08 is real:** `UpdateUrlPolicy` gates both download and browser fallback; the pinned SHA-256 `e5ee3fd6…c29aa` **is** the production keystore certificate (checked with `keytool`); the Kotlin `verifyApk` is registered and enforced against every signer.
- **F-13/F-16/F-17/F-22/F-23/F-25/F-29/F-34** verified in code: `targetSdk 36`; streaming hash + 5 % cap + ENOSPC; `dataExtractionRules` covers device transfer; per-entry backoff with blocked-not-deleted; token-free 24 h snapshot; reactive maintenance gate; AA contrast recomputed; analyzer clean.

### 3.4 Where the claims are thinner than stated

- **F-01 back-button (new NEW-01):** the overlay does **not** consume Android back in the shipping configuration. With `MaterialApp.router`, the router's `RootBackButtonDispatcher` registers before `AppLockOverlay`, so `didPopRoute`/`handleStartBackGesture` never win and `PopScope` has no `ModalRoute`. Back pops the *covered* route (an FO "Exit app?" dialog can fire behind the lock). No data disclosure — the lock surface stays up — but the claim is false and the shipped test cannot detect it (single 0-duration pump against `MaterialApp`, not `.router`).
- **F-03:** purge is skipped when Firebase itself ends the session (token revoked/user disabled), the tracking spool is still plaintext NDJSON, and public-attendance queue entries are unreplayable (NEW-03).
- **F-09:** `FLAG_SECURE` is applied only to profile, payslips and document upload — not Aadhaar correction, incidents, attendance photo, or the FO portal.
- **F-11:** token deletion and topic unsubscribe are fixed; lock-screen notification visibility is still OS default.

### 3.5 P1 new defects

| ID | Severity | Defect |
|---|---|---|
| **NEW-02** | P1 Medium | Sign-out never resets in-memory providers. `guardDashboardProvider`/`guardProfileProvider` are non-`autoDispose` (`guard_dashboard_screen.dart:28-32`, `guard_profile_screen.dart:19-23`) and eagerly watched by `GuardShell:76-77`; `preloadAllGuard` uses `read(provider.future)`, which does not refetch. **Account B can render A's dashboard/profile until the 15-minute blanket refresh.** |
| **NEW-03** | P1 Medium-High | Public-attendance offline submissions are silently lost: queued as owner `anonymous`, the sync pass returns before the queue when signed out (`sync_service.dart:210`), and `anonymous` entries are purged as foreign when anyone signs in (`offline_queue.dart:219-251`). |
| **NEW-05/06** | P1 Medium | Retired payroll/leave surfaces still ship and call 410; `leave`/`payslips` default **on** even with `fallback:true`; a queued `/api/guard/leave` POST retries 20× then shows a permanent "blocked" badge. |

Other new items (P2/P3): purge skipped on Firebase-initiated sign-out (NEW-04); stale notification tab indices, FO index 4 out of range (NEW-07); `FLAG_SECURE` gaps (NEW-08); plaintext GPS spool (NEW-09); hardcoded signer pin blocks Play App Signing (NEW-10); no CI `targetSdk`/coverage/iOS gates (NEW-11); exported plugin receivers / boot-start FGS (NEW-12); iOS microphone purpose string inconsistent with Android removal (NEW-13).

---

## 4. Payroll/leave retirement and integration

### 4.1 Gates — all green (the plan's one caveat is refuted)

| Gate | Result |
|---|---|
| `npm test` | **PASS** — 81 files / 493 tests |
| `npm run typecheck` | **PASS** — no diagnostics |
| `npm run lint` | **PASS** — no diagnostics |
| `git diff --check` | **PASS** |
| `npm run build` | **PASS** — `✓ Compiled successfully`, 163/163 static pages |

The plan's claim that the build fails on `next/font` is wrong in this environment: `fonts.googleapis.com` answers HTTP 200 in 0.91 s — the earlier failure was the offline sandbox.

### 4.2 Retirement integrity — sound

7 pages, 10 `src/lib/payroll/*` modules and 2 type files deleted. 15 API modules / 22 handlers are **truly stateless 410s** — only `NextResponse` imported, no auth helper, no Firestore. Navigation, guard navigation, settings card, dashboard action, notification types, dashboard payload (`leaveBalance`), robots and copy are swept. No active code, link or page fetches a retired endpoint. Retired collections are deny-all in `firestore.rules` with no wildcard/catch-all that could re-open them; 138 indexes retained (7 payroll + 2 leave), inert and harmless.

### 4.3 Leftovers that need a decision

1. **`public/sw.js:10` still precaches `/guard/payslips`.** `cache.addAll` rejects on the 404 → **service-worker install fails**, so PWA offline shell breaks for new visitors. No test covers `APP_SHELL_URLS`.
2. **All 10 APKs deleted from `public/downloads/`** while `public/downloads/ciss-workforce-android.json` still declares `apkPath: /downloads/ciss-workforce-1.0.21.apk` and `vercel.json` rewrites `latest.apk`/`ciss-mobile.apk` to it. `/api/public/app-update` would advertise a 404. **P0 if committed as-is.**
3. `src/app/api/admin/clients/[id]/route.ts:145` still reads `clientWageConfig` in the client-delete guard.
4. Retiring `compliance-settings` removed the only UI to edit EPF/ESIC/PT/TDS rates — product decision needed.
5. Two retirement-test assertions are vacuous in this checkout (`(app)/leave` and `(guard)/guard/leave` never existed at HEAD), and the statelessness regex is narrower than its message; the underlying claims were re-verified manually.

### 4.4 Workstream hazard — the base is stale

The retirement was built on `cad17132`; `origin/main` is 16 commits ahead with 9 overlapping files. `origin/main` ships `guard/leave/route.test.ts` (3 tests expecting a *working* leave API), `(guard)/guard/leave/page.tsx`, `guard-leave-validation.ts` and a modified `src/types/leave.ts`. **Merging as-is goes red and resurrects a retired page.** Redo/re-verify the retirement on a branch off `origin/main`, deleting those four surfaces in the same commit.

Likewise, the live deployed ruleset (per the 26 Oct dry-run report) covers only the eight retirement denies; the working-tree ruleset carries additional tcs/duty/notification changes that were never syntax-validated or deployed. Split and validate them separately.

### 4.5 Web ↔ mobile contract

The mobile retirement patch (`patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch`, 29 files) is **not applied** and still applies cleanly (`git apply --check` exit 0). Live 410 call sites in the shipped app:

1. `GET /api/guard/payslips` (`mobile_repository.dart:1433`)
2. `GET /api/guard/payslips/{id}/payslip` (`:1443`)
3. `GET /api/guard/leave` (`:1470`)
4. `POST /api/guard/leave` (`:1476`; also offline-queued at `guard_leave_screen.dart:155-156`)
5. `PATCH /api/guard/leave` (`:1480`; also queued at `:217`)

No response-shape break (`leaveBalance` was already `null` at HEAD). Five other mobile paths 404 only because of the checkout lag (`/api/guard/duties`, `/api/guard/duties/{id}/willingness`, `/api/mobile/attendance/break`, `/api/mobile/settings`, `/api/mobile/tracking/batch` exist on `origin/main`) — not retirement regressions.

---

## 5. Multi-state readiness (Tamil Nadu)

The six claimed `REGION_CODE` fallbacks are **verified**: claims repair (4 sites), linked profiles, report serialization/scope, training reports, visit reports, admin state discovery; compliance-settings seeding was removed. Missing state metadata no longer stamps `KL` on a non-Kerala deployment.

Remaining **functional** TN blockers:

1. Admin employee editor district `<Select>` is Kerala-only (`employees/[id]/page.tsx:119-123,2242`) — a TN admin cannot pick a TN district.
2. Leaderboard and assigned-guards-export district filters are Kerala-only.
3. `INDIA_STATE_DISTRICTS` — which contains the full TN list — is **dead code** (nothing imports it). This is the obvious source for fixes (1)–(3).
4. `REGION_CODE` falls back to `KL` silently in regional mode; the hard requirement exists only in control-plane mode (`runtime-config.ts:8-46`).
5. Public region discovery always injects Kerala with the deployment's local host (`public/regions`, `public/region-config/[code]`).
6. Ops scripts hard-code `KL` (`reconcile-attendance.mjs:89`, `migrate-field-officer-reports-v2.mjs:98`, `import-lng-petronet.mjs:16`).

Public enrollment is **not** blocked for TN (free-text district, empty-suggestion path returns true), and district scoping for TN field officers works by normalized equality.

---

## 6. Answering the question directly

**"Check its findings"** — done. The findings are correct: every web mechanism re-derives from source (one overstatement, M-14), and every mobile finding reproduces.

**"Confirm everything fixed"** — **No.**
- Mobile: 14 of 34 closed, 11 partial, 9 open, 13 new defects. All client-side High findings are genuinely closed; the rest are not.
- Web: **2 of 44** closed, and both only because payroll was retired. The four criticals are unchanged.
- The payroll retirement is correctly implemented **on web only**; mobile was not updated, so guards on 1.0.22 see Leave/Payslips screens that now always fail.

---

## 7. What requires attention — ranked

### P0 — before any commit/deploy/rollout

1. **Restore the APK artifacts or fix the manifest in the same commit.** Either put `ciss-workforce-1.0.21.apk` (and `latest`) back, or update `public/downloads/ciss-workforce-android.json` (`apkPath`/`sha256`/`sizeBytes`) **and** `vercel.json` rewrites together; then verify `GET /api/public/app-update` and `curl -I /downloads/ciss-workforce-latest.apk`.
2. **Close the anonymous attendance-forgery chain (C-2 + N-1).** Require a real second factor at `POST /api/public/attendance/identify` (guard PIN/OTP or signed badge with single-use nonce), and delete the `public-profile` fallback that returns `qrCodeUrl`. Do not rely on C-3 alone.
3. **Rotate/require `CISS_QR_SECRET` (C-3)** and remove the `NEXT_PUBLIC_FIREBASE_API_KEY`/hardcoded fallbacks in `qr-token.ts` (copy the fail-closed pattern from `upload-token.ts`).
4. **Decide the retirement order.** Apply the mobile patch (it applies cleanly), force `leave`/`payslips` off regardless of `fallback`, and flip the server `MODULE_DEFAULTS`; ship mobile before or with the web tombstones.
5. **Upgrade Next.js to ≥ 15.5.28** (C-1) and re-run build/tests. While in there, bump `sharp` ≥ 0.35.4.

### P1 — next sprint

6. **H-7:** scope `storage.rules` signature/attendance reads to admin/owner (today any signed-in account can list/download them).
7. **H-10/N-1:** make `public-profile/[id]` return 404 unless an explicitly published, Active `publicProfile` exists.
8. **H-3:** stop trusting the left-most `X-Forwarded-For` as the limiter key (use Vercel's trusted header, or key on the Firebase token/phone as well). **H-9:** restrict `fix-email-verified` to superAdmin. **M-3:** prefix CSV cells starting `= + - @`. **M-4:** force `Content-Disposition: attachment` or allow-list content types for document streaming.
9. **Mobile NEW-02:** invalidate all account-scoped providers on sign-out/uid change; add an A→B test that asserts a refetch.
10. **Mobile NEW-03:** make the `anonymous` queue replayable while signed out, or reject it at enqueue; test signed-out enqueue → signed-out and signed-in flush.
11. **F-10:** make the app-lock reset explicit rather than silently clearing the durable flag on a fresh credential login.
12. **Fix `public/sw.js`** (drop `/guard/payslips`, add a test that every shell URL resolves).
13. **Rebase the retirement onto `origin/main`** and delete the four leave surfaces that branch reintroduces; split and validate the extra rules changes.

### P2 — defence in depth / product decisions

14. NEW-01 (back under lock), NEW-04 (purge on Firebase sign-out), NEW-08 (`FLAG_SECURE` coverage), NEW-09 (encrypt GPS spool), NEW-07 (notification routing).
15. TN district pickers wired to `INDIA_STATE_DISTRICTS`; make `REGION_CODE` mandatory in regional mode; make `public/regions` emit the deployment's own region; regionalise the ops scripts.
16. F-24/F-27 (module gating + route-level auth), F-30 (lazy lists, single notification poller), F-32 (layering), F-15/F-14 (iOS signing, tagged CI release), F-06 (privacy notice/consent).
17. H-6, M-1, M-2, M-9/M-10, M-12, M-13, M-15 and the L-series from the web assessment.

---

## 8. Needs live verification (settles conditionals)

1. **Is `CISS_QR_SECRET` set on Vercel?** Absent from every local env file; if absent in production, C-3 is fully live.
2. **Does Vercel pass a client-supplied left-most `X-Forwarded-For`?** Decides H-3 exploitability.
3. **Does the deployed ruleset match the working tree?** The 26 Oct dry-run says only the retirement denies were published; the working tree's tcs/duty/notification rules are unvalidated and undeployed, and `origin/main`'s permissive payroll rules may still be live if that deploy did not happen.
4. **Does a live `qrCodeUrl` decode to a `Token:` line?** Confirms N-1 end-to-end (source says yes).
5. **Is Email/Password signup open for `@guard.cisskerala.app`?** Decides M-15.
6. **Post-deploy checks:** `/api/guard/leave` and `/api/guard/payslips` → 410; `/api/guard/dashboard` has no `leaveBalance`; APK download paths → 200; service worker installs.

---

## 9. Verification log (commands run in this re-audit)

```
# web
npm test                     -> 81 files / 493 tests passed
npm run typecheck            -> exit 0
npm run lint                 -> exit 0
npm run build                -> exit 0 (163/163 pages)
git diff --check             -> exit 0
npm audit --omit=dev         -> 90 advisories (3C/22H/65M)
node -p require('next/...')  -> 15.5.22
npm view next@15.5 version   -> ... 15.5.26 15.5.27 15.5.28

# mobile
flutter analyze              -> No issues found! exit 0
dart analyze                 -> No issues found! exit 0
flutter test                 -> 316 passed, exit 0
flutter test --coverage      -> 3,526 / 18,866 = 18.69 %
git apply --check <patch>    -> exit 0 (retirement NOT applied)
git tag --list               -> latest v1.0.17
keytool -list -v             -> pin matches e5ee3fd6…c29aa
```

No commits, resets, deploys, live requests, or data changes were made.

---

## 10. Remediation applied after the audit (2026-10-26)

All changes are in the two **working trees only** — nothing committed, pushed, deployed or written to live data. The mobile tree keeps its 84 pre-existing changes plus 29 patch files plus the two fixes below.

### 10.1 Web (`/Users/mymac/Documents/CISS`)

| Finding | Change | Evidence |
|---|---|---|
| **C-1** | `next` upgraded to `15.5.28`; `sharp` override raised `0.35.3 → 0.35.5`. `npm audit` no longer flags `next` or `sharp`. Remaining 2 criticals (`handlebars`, `proxy-addr`) are pulled by `genkit`/`express` and are not on the Next request path. | `package.json`, `package-lock.json`; `npm audit --omit=dev` |
| **C-3** | QR HMAC no longer falls back to `NEXT_PUBLIC_FIREBASE_API_KEY` or a literal. It uses `CISS_QR_SECRET`, then server-only attendance/upload/NextAuth secrets, and **throws in production** when none is set. | `src/lib/qr/qr-token.ts`; `src/lib/qr/qr-token.test.ts` |
| **C-2 / N-1** | Tokenless QR codes are rejected (`401`) instead of falling through; a per-guard limiter (10 proofs / 10 min, fail-closed) bounds minting. The signed badge (`qrCodeUrl`) is no longer returned by any public-profile branch. | `public/attendance/identify/route.ts`, `employees/public-profile/[id]/route.ts` + tests |
| **H-7 / M-5** | Storage reads for signatures and attendance selfies changed from `isSignedIn()` to staff roles; legacy `foReports/{folder}/{uid}` reads are owner-or-admin. | `storage.rules`; `src/database-config.test.ts` |
| **H-9** | `fix-email-verified` now requires **superAdmin**, not any admin. | `admin/fix-email-verified/route.ts` |
| **M-1** | Self re-queue origin comes from configuration (`APP_URL` → `NEXT_PUBLIC_APP_URL` → Vercel system host), never the request `Host`; off-origin targets are refused. | `src/lib/server/self-queue.ts` + tests |
| **M-3** | Shared CSV escaper neutralises `= + - @ tab CR` formula prefixes in the attendance report **and** the browser export. | `src/lib/csv.ts` + test; both call sites |
| **M-4** | Guard document streaming allow-lists `jpeg/png/webp` (inline) and `pdf` (attachment); everything else is `application/octet-stream` + attachment, plus `CSP: default-src 'none'; sandbox`. | `guard/profile/documents/route.ts` + tests |
| **M-13** | Region readiness probe validates https, no userinfo, no non-443 port, rejects IP literals/internal suffixes, and adds a 5 s timeout. | `super-admin/regions/[id]/check/route.ts` + tests |
| **PWA shell** | `/guard/payslips` removed from `APP_SHELL_URLS`; cache bumped to v7, so install no longer fails on a 404. | `public/sw.js` |
| **Multi-state** | `public/regions` advertises the deployment's **own** region instead of always injecting Kerala; `public/region-config/[code]` serves the own region from env (previously only `KL` was special-cased, so `/region-config/TN` 404'd). Architecture doc updated with the separate-project/separate-Google-account model. | both routes + tests; `docs/app-context.md` |

Web gates after the changes: `npm test` **89 files / 527 tests**, typecheck, lint, `npm run build` (Next 15.5.28, 163 pages), `git diff --check` — all exit 0.

### 10.2 CISS-Mobile (`/Users/mymac/Documents/CISS-Mobile`)

| Item | Change |
|---|---|
| Retirement | `patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch` applied (29 files, +177/−1281). Leave/payslip screens, models, repository methods, cache allowlist, dashboard tiles, shell entries, notification paths and refresh invalidations are gone. `leave`/`payslips` are forced off in `ModuleFlags.isOn` even with `fallback: true`; a legacy queued `/api/guard/leave` request is blocked instead of retried into a 410. |
| **NEW-02** | New `account_scoped_providers.dart` registry (22 providers) invalidated synchronously at every identity transition, before the local purge — so B never renders A's cached dashboard/profile. Three tests. |
| **NEW-03** | `anonymous` offline bucket is now replayable while signed out and is no longer purged on sign-in; `OfflineRequest.isPublicAttendance` is the single predicate for replay and auth-skip. Five tests. |
| Gates | `flutter analyze` / `dart analyze` clean; `flutter test` **325 passed** (up from 316). |

### 10.3 Still open after the remediation

**Needs a decision or an artifact, not just code:**

1. **Android download/update (P0):** all 10 APKs remain deleted while `public/downloads/ciss-workforce-android.json` and the `vercel.json` rewrites still target `1.0.21`. Restore the artifacts **or** repoint the manifest/rewrites in the same commit. I did not guess where the artifacts should live.
2. **C-2's remaining half (P0/P1):** the proof is still mintable by anyone who knows an employee ID or phone (public attendance has no second factor). Closing it needs a product choice — require the guard's PIN at submit, or make the signed QR badge the only anonymous credential. Rate limiting and badge-leak removal reduce abuse but do not close it.
3. **Badge rotation (operational):** because existing badges were signed with the public API key, verification after deploy will reject them. Regenerate `qrCodeUrl` for active employees when the new secret is deployed, and set `CISS_QR_SECRET` (or rely on the already-required `ATTENDANCE_VERIFICATION_SECRET`).
4. **Rules deployment/validation (P1):** `storage.rules` and the working-tree `firestore.rules` are not deployed or emulator-validated. Deploy the storage rules with the release; split the tcs/duty/notification rule changes and validate them separately.
5. **Retirement base (P1):** the retirement is still built on `cad17132`, 16 commits behind `origin/main`, which reintroduces `(guard)/guard/leave/page.tsx`, `guard/leave/route.test.ts` and `guard-leave-validation.ts`. Rebase and delete those in the same change.

**Remaining web findings (26):** C-2 (partial), C-4 (latent), H-1, H-2, H-3, H-6, H-8, H-10 (partial), M-2, M-6, M-7, M-8, M-9, M-10, M-11, M-12, M-14 (partial), M-15, L-1…L-8, L-12, L-13, L-14 (partial), L-15.

**Remaining mobile findings:** F-03/F-09/F-11/F-14/F-15/F-18/F-19/F-20/F-26/F-28/F-31 partial; F-06/F-07/F-10/F-21/F-24/F-27/F-30/F-32/F-33 open; NEW-01 (back under lock), NEW-04 (purge on Firebase sign-out), NEW-07 (notification indices), NEW-08 (FLAG_SECURE coverage), NEW-09 (plaintext GPS spool), NEW-10 (Play App Signing pin), NEW-11 (CI gates), NEW-12 (exported receivers), NEW-13 (iOS microphone string).

**Retirement leftovers:** sign-out purges the whole queue including the now-replayable `anonymous` bucket (privacy vs reliability decision); `api/admin/clients/[id]` still reads `clientWageConfig` in its delete guard; no UI remains for statutory rates (EPF/ESIC/PT/TDS).

### 10.4 Verification after remediation

```
# web
npm test                     -> 89 files / 527 tests passed
npm run typecheck            -> exit 0
npm run lint                 -> exit 0
npm run build                -> exit 0 (Next 15.5.28, 163/163 pages)
git diff --check             -> exit 0
npm audit --omit=dev         -> next/sharp cleared; 2 critical remain (genkit chain)

# mobile
flutter analyze              -> No issues found!
flutter test                 -> 325 passed
```

---

## 11. Database audit and shared-device attendance (2026-10-26, later pass)

Full read-only database report: `reports/audit/2026-10-26-database-audit.md` (live project `ciss-workforce`, deployed rulesets read back from the Rules API, 100 query shapes executed live, 691 Auth accounts and 22,032 Storage objects summarized, no writes).

### 11.1 Deployment reality

- **Firestore rules:** the deployed ruleset is byte-identical to the working tree at audit start (deployed 12:58Z), so the payroll/leave denies are live.
- **Indexes:** 138 declared = 138 deployed, including the uncommitted additions. **No index is pending.**
- **Storage rules:** deployed 2026-08-04; the working-tree hardening (staff-only signature/selfie reads, owner-scoped `foReports`) is **not live**. This is the single most urgent database action.

### 11.2 What was fixed in code after the database audit

| Finding | Change |
|---|---|
| **H6 data export 500 / empty** | `/api/admin/data-export` now filters `attendanceLogs` on `attendanceDate` and `clientName` (the fields that exist, both index-backed) and resolves the selected client id to its name; employees filter on `clientName`. |
| **H1 clients unreadable** | `clients` rule now uses `isOwnClientDoc('name')`; `sites`/`clientLocations` keep `clientName`. |
| **H2/H3 dead, type-broken guard branches** | Removed `assignedSiteId` guard reads (no guard claim carries it); guard clients get site data from server routes. `guardAssignedSiteId()` deleted; rules re-validated through the Rules API `:test` endpoint (200, no warnings). |
| **M14 legacy `attendanceStates` guard-writable** | Now `allow read, write: if false`. |
| **M2 rate-limit TTL debt** | Every limiter write now sets `expireAt` (2× window, min 1 h) and malformed documents are treated as expired instead of throwing. Apply a Firestore TTL policy on `rateLimits.expireAt`. |
| **M1 unattributed attendance** | New attendance writes always persist `submittedByUid`/`submittedByRole`; assisted/kiosk writes add `assistedSubmission`, `markedByUid`, `markedByEmployeeDocId`, `attendanceMethod`. Historical logs stay `null` by design. |

### 11.3 Shared-device attendance (implemented)

A guard without a phone can mark attendance from a colleague's phone:

| Mode | Who | Accepted identifiers | Proof |
|---|---|---|---|
| **Self** | signed-in guard, own record | `authenticated` | Firebase session |
| **Assisted** | signed-in guard, colleague's record | signed QR badge, employee ID + phone, phone, resource ID (**TCS only**) | single-use proof bound to actor uid + subject, 10 min |
| **Kiosk** | signed-out shared device | **signed QR badge only** | single-use proof bound to subject, null actor |

- The server mints the proof at identify (`attendanceVerificationProofs/{nonce}`, server-only, `expireAt` for TTL), binds `employeeDocId` + `actorUid`, and burns it transactionally on submit. Reuse, actor mismatch, subject mismatch, expiry, or method downgrade → 401.
- Resource ID is enforced against the matched employee's `clientName` (TCS) on the server, not in the UI.
- Assisted/kiosk submissions keep the existing photo, geofence, district, shift and mock-location checks; the guard whose account was used is recorded on the attendance log.
- Mobile sends its session token on identify/submit when signed in (so the colleague's phone is accountable); the web kiosk sends it for signed-in guards and shows a "sign in for ID/phone" note otherwise.
- No new composite index is required (proofs are read by document id).

### 11.4 Still requires the owner

1. **Deploy storage rules** (Critical): `npx firebase-tools deploy --only storage:rules --project ciss-workforce`. Closes live read access to 1,345 signatures and 7,255 attendance selfies for every authenticated account. Not run here.
2. **Deploy the Firestore rules changes** in this working tree (clients fix, attendanceStates deny, proofs deny) after review; the Rules API test validates syntax only.
3. **Move `guardPin` off `employees`** into a server-only collection and project employee fields for client users (H4/H5). The PIN hash is currently readable by staff/FOs and client users; a 4–6-digit PIN is brute-forceable offline. This needs a migration + auth-code change and was not attempted.
4. **Apply TTL policies**: `rateLimits.expireAt`, `attendanceVerificationProofs.expireAt`; `locationHistory.expiresAt` already configured. Owner-approved cleanup of 11,488 stale rate-limit docs, ~5,000 orphan selfies, and the test/scratch objects.
5. **Data hygiene:** backfill `stateCode` (1,188 employees), `attendanceLogs.district` (291), `clientId` (1,807 employees); normalise `sites.siteId` to string; add geolocation to 17 sites and radii to 2 clientLocations; investigate 1,630 Active employees without guard logins and 4 clientName values not in the registry.
6. **Client-site map:** the `__name__`-only site lookup for client users is denied by rule design; move it to a server route.



### 11.5 Executed with owner authorization (2026-10-26, 20:00–20:15 IST)

| Action | Result | Verification |
|---|---|---|
| Deploy Storage rules | `firebase.storage` release updated 2026-10-26T14:30:45Z | Readback byte-identical to `storage.rules`; `isStaff()` present |
| Deploy Firestore rules | `cloud.firestore` release updated 2026-10-26T14:30:26Z, re-released 14:40:19Z after adding `guardCredentials` deny | Rules API `:test` 200 with no warnings; readback byte-identical |
| TTL policies | `rateLimits.expireAt` and `attendanceVerificationProofs.expireAt` **ACTIVE** | Firestore Admin API readback |
| Stale cleanup | rateLimits 9,281 deleted (12,338→3,057; 0 stale remain), resetOtps 2 deleted (0 remain) | Dry-run then `--apply`; post-run scan shows 0 pending |
| Data hygiene | 1,806 employee docs (1,188 `stateCode`, 1,805 `clientId` resolved from unique client-name match); 290 attendance logs got `district`; 109 numeric `sites.siteId` normalized to string | Dry-run then `--apply`; re-run shows 0 pending (1 log unresolved, no employee/site district) |
| Guard PIN migration phase 1 | 276 hashes copied to server-only `guardCredentials`; every PIN write now mirrors into it; collection deny deployed | Script applied; rules readback; typecheck/tests/build green |
| QR regeneration | `scripts/regenerate-attendance-qr.mjs` prepared (dry-run default, refuses without a server-side secret) | **Not run** — must run with the production secret after the app deploy |

Guard PIN phase 2 (flip readers to `guardCredentials`, then remove `guardPin`/`guardPinSetAt` from `employees`) is deliberately not done yet: it must follow the app deployment, otherwise the deployed app would stop authenticating 276 guards. Client-user employee PII (H4) still needs the server projection route; the PIN-hash part is now staged server-side.

### 11.6 Follow-up fixes (2026-10-26, 20:20–20:45 IST)

| Item | Result |
|---|---|
| **Client-user employee PII** | Removed the `isOwnClientDoc('clientName')` branch from the `employees` read rule and deployed it (release 14:57:12Z, readback hash matches). Client users now reach employee data only through `/api/client/guards` (list), `/api/employees/profile/{id}` (detail) and `/api/client/*` dashboards, all of which return `serializeGuardProfileView` — no bank/PAN/PIN/auth fields. The client UI already used those routes; the rule was the only exposure. |
| **Client site lookup** | New `/api/client/sites?ids=…` resolves site districts with the Admin SDK and filters each document through `matchesClientScope`. The work-orders board uses it for the client role (staff keep the direct query). Rule-denied `__name__ in` lookups no longer leave the client's site-district map empty. Tests: 2. |
| **Sites without coordinates** | Geocoded 6 of 17 with OpenCage (confidence ≥ 7, Kerala bbox), writing `latitude`/`longitude`, `latString`/`lngString`, a real `geolocation` GeoPoint (the field the 150 m geofence reads), and `coordinateStatus`/`geocodeSource`/`geocodeConfidence`. Reverse-geocode checks: 4 exact, 1 postcode-level, 1 neighbourhood-level. 11 left for manual review (5 outside Kerala — 4 Puducherry + Trichy; 6 resolved only to a state centroid). |
| **Orphan selfie retention** | `scripts/prune-orphan-attendance-photos.mjs` (dry-run default, 365-day window, 5k object/2 GB caps, audit record per deletion). Inventory: 7,257 attendance objects, 1,930 referenced, 3,758 orphans (293 MB); only 1 older than 365 days → deleted with an audit record. A timestamp-adjacency guard retains 1,569 selfies whose legacy path is missing from old logs but which are the only evidence for real attendance. 853 legacy-named objects (65.6 MB) remain unreferenced and unmatched — they need a backfill-or-archive decision before 2027. |

Gates: `npm test` **91 files / 538 tests**, typecheck, lint and `npm run build` pass. The client-site route and the attendance code are in the working tree; they take effect when the app is deployed.
