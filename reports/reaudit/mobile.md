# CISS-Mobile re-audit — independent verification of F-01…F-34 and the payroll/leave retirement

**Verifier:** mobile-verifier (read-only re-audit)
**Repo:** `/Users/mymac/Documents/CISS-Mobile` — branch `wip/redesign-1.0.21`, HEAD `edfec10`, `version: 1.0.22+22`, package `co.in.ciss.ciss_mobile`
**Working tree:** heavily dirty (84 entries: 45 modified + 39 untracked, 0 deleted) — **nothing committed, reset, checked out or cleaned by this audit**
**Toolchain:** Flutter 3.29.0 / Dart 3.7.0 (`/Users/mymac/flutter/bin`)
**Prior corpus (read, treated as untrusted):** `audit/CISS-Mobile-audit-2026-10-22.md`, `audit/findings.csv`, `audit/remediation-2026-10-22.md`, `audit/areas/*`
**Web side-cross-check (for the 410 endpoints only):** `/Users/mymac/Documents/CISS` (read-only)
**Date:** 2026-10-26

---

## 0. Method and evidence rules

1. Every one of F-01…F-34 was re-decided from **current source**, not from the remediation claim. Each finding was classified:
   * **VALID?** — was the 2026-10-22 finding true *of that tree*: `valid` / `conditional` / `overstated` / `incorrect`.
   * **STATUS NOW** — `fixed` / `partial` / `open` / `regressed`, based on whether the remediation **exists and is effective**, not merely present.
2. "Code present" ≠ "code effective". Where a control exists but its trigger path is unreachable, the finding is downgraded and called out (see F-01 back-button, NEW-01).
3. Nothing was built or installed on a device. Behaviour that can only be proven on hardware is marked **UNVERIFIED**.
4. Framework-level claims were verified against the Flutter SDK source on this machine (`/Users/mymac/flutter/packages/flutter/lib/src/widgets/…`), because several remediation claims depend on framework dispatch order.

### Aggregate result

| | Prior audit (2026-10-22) | Prior remediation claim | **This re-audit (verified)** |
|---|---:|---:|---:|
| Fixed | — | 14 | **13 fixed + 1 closed (F-12) = 14** |
| Partial | — | 11 | **11** |
| Open | — | 9 | **9** |
| Regressed | — | 0 | **0 outright** (1 claim is materially over-stated: F-01 back-button) |
| New defects | — | — | **13 (NEW-01 … NEW-13)** |

The remediation report's **aggregate counts are honest** (14/11/9 reconciles exactly). Its individual *statuses* are mostly accurate; the important deltas are F-04 (better than claimed — server controls now exist), F-03/F-09/F-11 (subtler than "fixed"/"partial" suggests, see detail) and F-01 (the back-button half of the claim does not hold).

---

## 1. Toolchain results (exact)

Run in the current tree, in this order, on 2026-10-26:

```
$ flutter analyze
Analyzing CISS-Mobile...
No issues found! (ran in 6.2s)              → exit 0

$ dart analyze
Analyzing CISS-Mobile...
No issues found!                             → exit 0

$ flutter test --reporter expanded
00:36 +316: All tests passed!                → exit 0   (316 passed, 0 failed, 0 skipped)

$ flutter test --coverage ; awk LF/LH coverage/lcov.info
lines hit=3526 found=18866 pct=18.69%        ; 151 source files in lcov.info
```

* The **analyzer is genuinely clean** (F-34 / F-14 gate green). The three 2026-10-22 warnings (`auth_controller` `foundation`, `permission_onboarding_screen` `brand_banner`, `de_clutter_primitives_test` `haptic_event`) are gone.
* Test count matches the remediation claim exactly (316). Coverage matches exactly (3,526 / 18,866 = 18.69%; claim said 18.7%).
* `analysis_options.yaml` still includes only stock `package:flutter_lints/flutter.yaml` with no extra rules and no strict modes (F-34's second half is unchanged).
* **The tree compiles and analyses cleanly** — there is no build/analyze blocker to report.

Not run (out of scope / not needed for any claim): `flutter build apk/appbundle`, `pod install`, any device install, any emulator. `flutter pub outdated` was not re-run (no network-dependent claim depends on it; F-21 is asserted unchanged from `pubspec.yaml`/CI pin).

---

## 2. Per-finding verification table

Severity = prior audit severity. "Evidence" cites current files (verified today).

| ID | Sev | VALID? | STATUS NOW | Decisive evidence (file:line) |
|---|---|---|---|---|
| F-01 | High | **valid** | **fixed** (core bypass closed; back-button claim wrong → NEW-01) | Overlay above navigator: `lib/app/app.dart:28-31`; opaque+pointer-consuming cover: `lib/core/auth/app_lock_overlay.dart:78-93,135-140`; re-arm on `paused`→`resumed`: `lib/core/auth/app_lock_controller.dart:265-281` + `lib/core/auth/app_lock_lifecycle.dart:16-22`; gate no longer holds lock UI: `lib/features/auth/presentation/auth_gate_screen.dart:127,138,141` (file is 238 lines after ~323 lines of lock UI moved out) |
| F-02 | High | **valid** | **fixed** (disk cache); in-memory analogue open → NEW-02 | UID+region key `lib/core/network/mobile_repository.dart:186-190,199-209`; transport-only fallback `:242-264`; 24 h cap `:245`; box opened with the queue AES cipher `lib/main.dart:66-75,170-204` + `lib/core/cache/hive_read_cache_store.dart:24-31`; cleared on sign-out `lib/core/privacy/local_data_purger.dart:102` |
| F-03 | High | **valid** | **partial** | Queue ownership `lib/core/offline/offline_queue.dart:159-170,209-234,238-260`; drafts `uid::formKey` + encrypted `lib/core/offline/draft_service.dart:37-49,64-104`; spool owner marker `lib/core/location/tracking_buffer.dart:85-115,120-122`; fail-closed queue `lib/main.dart:52-63`; purger `local_data_purger.dart:99-130`. **Gaps:** purge skipped on Firebase-initiated sign-out (`auth_controller.dart:79-104,341-349`), spool still plaintext, anonymous bucket unreplayable (NEW-03) |
| F-04 | High (cond.) | **valid** | **fixed** (client + server controls verified; runtime UNVERIFIED) | Policy `lib/core/auth/pin_policy.dart:36-47`; guard `lib/core/auth/pin_attempt_guard.dart:28-29,42-60,74-83`; wiring `lib/features/auth/presentation/role_login_screen.dart:163,173-178,325-334`; server (web repo) `src/app/api/guard/auth/setup-pin/route.ts:180,190-239` refuses overwrite; `src/app/api/guard/auth/login/route.ts:100-113,169-171,234-259` lockout; `src/lib/server/rate-limit.ts:22-40` Firestore distributed limiter |
| F-05 | Medium | **valid** | **fixed** | No PII/coordinate logs remain (grep `data=$`, `user.uid=`, `latitude=` over `lib/` → only benign UI strings); redaction seam `lib/core/network/mobile_repository.dart:63-65`; `lib/core/privacy/privacy_log.dart:27-51`; `lib/core/location/background_tracking_service.dart:585` |
| F-06 | Medium | **valid** | **open** | No location/telemetry notice or consent gate; the only consent remains Aadhaar (`lib/core/network/mobile_repository.dart:1837-1860`) |
| F-07 | Medium | **valid** | **open** | Unauthenticated endpoints unchanged: `lib/core/network/mobile_repository.dart:1081` (`authenticated: false`), `:1092-1115` (identify) |
| F-08 | Medium | **valid** | **fixed** (client); residual server trust | Cleartext gone: `android/app/src/main/res/xml/network_security_config.xml`; `UpdateUrlPolicy` `lib/core/update/update_url_policy.dart:59-116` applied at `lib/core/update/apk_downloader.dart:110-117` and browser fallback `lib/core/update/app_update_gate.dart:389-397,538-546`; signer pin `lib/core/update/app_update_service.dart:142-143` = **keystore cert, independently verified**; native check `android/app/src/main/kotlin/co/in/ciss/ciss_mobile/ApkInstallerPlugin.kt:112-176`; plugin registered `MainActivity.kt:36`; install gated `app_update_service.dart:246-253` |
| F-09 | Low | **valid** | **partial** | Channel `MainActivity.kt:43-62`; ref-counted `lib/core/security/screen_security.dart:22-77,93-126`; wrapped screens only: `guard_profile_screen.dart:34`, `guard_payslips_screen.dart:229`, `guard_document_upload_screen.dart:81`. **Not wrapped:** incidents, Aadhaar correction, attendance/photo, all FO screens (NEW-08) |
| F-10 | Low | **valid** | **open** | Fresh login still clears the durable flag: `lib/features/auth/application/auth_controller.dart:634-644` |
| F-11 | Low | **valid** | **partial** (better than claimed) | `deleteToken()` now runs on sign-out via purger `local_data_purger.dart:125,172-175`; topics unsubscribed `auth_controller.dart:674`; **lock-screen visibility still default** `lib/core/fcm/notification_service.dart:213-222` (no `visibility: private`) |
| F-12 | Info | **valid** | **closed** (unchanged) | Keystore/key.properties untracked (`git ls-files` → 0 hits); `mobile.env` still tracked with 8 `NEXT_PUBLIC_*` entries (dead block, as before) |
| F-13 | High | **valid** | **fixed** | `android/app/build.gradle.kts:43-45` — `minSdk = 24`, `targetSdk = 36`, `compileSdk = 36` |
| F-14 | High | **valid** | **partial** | Analyze gate green (`build-apk.yml:82`, analyze exit 0); mapping+symbols retained with fail-if-missing `:93-110`; cert pin `:112-138`; **but latest tag is still `v1.0.17`** (`git tag --list`), no v1.0.22 tag, no Play upload, no `targetSdk` assertion |
| F-15 | High (cond.) | **valid** | **partial** | 9 `NS*UsageDescription` + `UIBackgroundModes` in `ios/Runner/Info.plist`; entitlements wired `project.pbxproj:371,552,576`, `APS_ENVIRONMENT` defined `:368,549,573`; `ios/Podfile` present. **Still missing:** `DEVELOPMENT_TEAM` (0 hits), `Podfile.lock`, `pod install`, Xcode capability, iOS CI |
| F-16 | Medium | **valid** | **fixed** | Streaming digest + 5 % cap + ENOSPC + partial-file cleanup `lib/core/update/apk_downloader.dart:143-201,244-251`; installer no longer double-copies `ApkInstallerPlugin.kt:215-227` |
| F-17 | Medium | **valid** | **fixed** | `AndroidManifest.xml:50-53` (`dataExtractionRules`, `fullBackupContent="false"`) + `res/xml/data_extraction_rules.xml` excluding every domain for cloud backup **and** `device-transfer` |
| F-18 | Medium | **valid** | **partial** | mapping/symbols retained `build-apk.yml:90-110`; **no `android/app/proguard-rules.pro`**, no `--obfuscate` anywhere |
| F-19 | Low | **valid** | **partial** | `RECORD_AUDIO` removed `AndroidManifest.xml:46-48`; **exported receivers remain** (plugin manifest verified in `~/.pub-cache/hosted/pub.dev/flutter_background_service_android-6.3.1/android/src/main/AndroidManifest.xml`: `WatchdogReceiver`/`BootReceiver` `exported="true"`); only the service is overridden `AndroidManifest.xml:60-64` |
| F-20 | Low | **valid** | **partial** | `.gitignore:50-51` now covers `android/build/`, `android/.gradle/`; 109 tracked `.png`, 69 `tooling/` files still tracked; keystore still on the workstation |
| F-21 | Info | **valid** | **open** | `pubspec.yaml` majors unchanged; CI pins `flutter-version: "3.29.0"` (`build-apk.yml:42`) |
| F-22 | Medium | **valid** | **fixed** | Per-entry persisted backoff `lib/core/offline/offline_request.dart:65-77,74-77`; no in-loop sleep, coalescing, timer+resume `lib/core/sync/sync_service.dart:102-133,167-205,222-241,339-348`; blocked-not-deleted `:226-236,280-314`; counters surfaced `lib/shared/widgets/sync_status_badge.dart`. **Side effect → NEW-03** |
| F-23 | Medium | **valid** | **fixed** | Snapshot 24 h + uid-bound + no tokens `lib/core/auth/session_snapshot_store.dart:70-92,133-142`; transport-only restore `lib/features/auth/application/auth_controller.dart:140-152,173-183`; cached region config read+validated `lib/core/region/region_service.dart:225-267`; bootstrap `lib/main.dart:110-128` |
| F-24 | Medium | **valid** | **open** | Still 5 `moduleEnabled` call sites (`guard_dashboard_screen.dart:134,140,151,157`; `guard_attendance_screen.dart:1196`); redirect only reads flags `lib/app/router/app_router.dart:72-79`; `kRouteModules` prefixes still match no route |
| F-25 | Medium | **valid** | **fixed** | Reactive watch + `ref.listen` + resume re-check + in-tree blocking overlay: `lib/core/update/app_update_gate.dart:74-96,127-152,176-200` |
| F-26 | Medium | **valid** | **partial** | Safe fallback parser `lib/core/network/ciss_error.dart:34-117`; **12 raw `error.toString()` interpolations remain** in `lib/features`+`lib/shared` (e.g. `guard_leave_screen.dart:236`, `guard_patrol_screen.dart:225`, `field_officer_reports_screen.dart:1660`) vs 9 `CissError.parse` call sites |
| F-27 | Medium | **valid** | **open** | No auth/role `redirect` (`app_router.dart:72-79`); shells still rendered as `/` body; `Navigator.push` count unchanged |
| F-28 | Medium | **valid** | **partial** | `PressableScale` now has `Semantics` + reduce-motion `lib/shared/widgets/pressable.dart:56-57`; but **5** `Semantics(` widgets total, **0** `Tooltip(`, **45** `IconButton(` |
| F-29 | Medium | **valid** | **fixed** | `lib/app/theme/app_tokens.dart:69-80`; recomputed today: warning/soft **6.08**, success/soft **6.13**, accent/white **5.02**, danger/soft **5.27** — all ≥ 4.5:1; `test/contrast_test.dart` asserts it |
| F-30 | Medium | **valid** | **open** | 27 non-lazy `ListView(`, 7 `ListView.builder`; 13 `Image.network`, **0** `cacheWidth`; **two** 30 s pollers intact `lib/core/fcm/notification_service.dart:58-75` (~240 req/h) |
| F-31 | Medium | **valid** | **partial** | 316 tests pass, coverage **18.69 %** (was 15.3 %); no coverage gate in `build-apk.yml` |
| F-32 | Medium | **valid** | **open** | 21 `core → features` imports (`grep -rn "import '.*features/" lib/core` → 21) |
| F-33 | Low | **valid** | **open** | `lib/core/qr/qr_parser.dart` 0 importers; `OfflineBadge` 0 usages; `OfflineQueue.init()` never called (`main.dart:68` opens the box directly) |
| F-34 | Info | **valid** | **fixed** | `flutter analyze` and `dart analyze` → "No issues found", exit 0; lints still stock |

---

## 3. Detail on the findings where effectiveness (not presence) matters

### F-01 — the app lock is genuinely above the Navigator now; the back-button half of the claim is not

**Fixed, and the core bypass is really closed.** `MaterialApp.router.builder` wraps the whole navigator, and the overlay paints an opaque, pointer-consuming surface as a sibling of the child:

```dart
// lib/app/app.dart:28-31
builder: (context, child) => AppLockOverlay(
  child: AppUpdateGate(child: child ?? const SizedBox.shrink()),
),
```
```dart
// lib/core/auth/app_lock_overlay.dart:78-93
return Stack(fit: StackFit.expand, children: <Widget>[
  widget.child,
  if (lock.showsLockSurface) Positioned.fill(child: AppLockScreen(...)),
]);
```

A pushed route cannot bypass it (`StackFit.expand` + `Positioned.fill` + `HitTestBehavior.opaque`, `:135-140`), the lock state is bound to `role:uid` and reset on identity change (`app_lock_controller.dart:134-153`), it fails closed when the durable preference cannot be read (`:187-195` + test at `test/app_lock_overlay_test.dart:507-538`), it arms **silently on `paused`** so the recents thumbnail is covered (`:265-281`), and it prompts exactly once per background→resume (`app_lock_lifecycle.dart:16-22`, `consumeLockOnResume` consumes the flag). Only a real background transition arms it — `inactive` is ignored to avoid prompt loops.

**What does not hold — back press.** The remediation says the overlay "claims/back-stops Android back". It does not, in the shipping configuration:

```dart
// lib/core/auth/app_lock_overlay.dart:62,67
Future<bool> didPopRoute() async => _locked;
bool handleStartBackGesture(PredictiveBackEvent backEvent) => _locked;
```
```dart
// lib/core/auth/app_lock_overlay.dart:133-134
return PopScope(
  canPop: false,        // inert here: the overlay has no ModalRoute ancestor
```

`WidgetsBinding.handlePopRoute` asks observers **in registration order** and stops at the first `true` (`/Users/mymac/flutter/packages/flutter/lib/src/widgets/binding.dart:911-919`); predictive back does the same (`:924-934`). With `MaterialApp.router`, `_WidgetsAppState` registers in `WidgetsApp.initState` (`app.dart:1456`), the `RootBackButtonDispatcher` registers even earlier in `_RouterState.initState` (`router.dart:613-621`, and `RootBackButtonDispatcher.addCallback` → `addObserver`), and **only then** is the builder's child (the overlay) created. The router's dispatcher therefore gets the press first and calls `_routerDelegate.popRoute()` (`router.dart:805-810`) — so back **pops the route underneath the lock** instead of being swallowed. The lock surface stays up (state is controller-owned), so this is not a data disclosure, but it is a wrong claim and it means the covered screen silently changes behind the lock (e.g. the FO shell's "Exit CISS Workforce?" `PopScope` at `field_officer_shell.dart:86-110` can fire behind the lock).

The widget test that "proves" the swallow does not prove it:

```dart
// test/app_lock_overlay_test.dart:324-327
await _sendSystemBack(tester);
expect(find.text('App Locked'), findsOneWidget);
expect(find.text('Pushed secret marker'), findsOneWidget);
```
It uses `MaterialApp` (not `.router`), and it pumps a **single 0-duration frame** after the back press — the popped `MaterialPageRoute` is still mounted for its 300 ms exit transition, so the assertion passes whether or not the route popped. → **NEW-01**.

### F-02 — cache scoping/encryption/age are real and effective

```dart
// lib/core/network/mobile_repository.dart:199-209
return '$region|${uid ?? 'anonymous'}|$path|$qs';
```
```dart
// lib/core/network/mobile_repository.dart:242-248
if (cacheable && cacheKey != null && _isCacheFallbackEligible(error)) {
  final cached = await _readCache.readJson(cacheKey, maxAge: ReadCache.maxFallbackAge);
```
with `_isCacheFallbackEligible` excluding any response at all, `StateError` (not authenticated), certificate errors and cancels (`:259-264`). The box is opened only by bootstrap with the queue cipher and the store **never opens it itself**, so a failed bootstrap degrades to a miss rather than a plaintext cache (`hive_read_cache_store.dart:6-31`; `main.dart:170-204` discards a legacy plaintext box). `ReadCache.clear()` now has a caller: the purger (`local_data_purger.dart:102`).

Residual (new): the **in-memory** Riverpod caches are never reset on sign-out → NEW-02.

### F-03 — ownership is real; three gaps remain

Queue: `enqueue` stamps the effective owner (`offline_queue.dart:191-200`), `getQueuedRequests` excludes and purges foreign/legacy entries (`:209-234`), `purgeForeignRequests` deletes them (`:238-260`), and `detachOwner()` closes the replay window synchronously on identity change (`auth_controller.dart:318-339`). Drafts are `uid::formKey` and the box is encrypted, with legacy plaintext discarded (`draft_service.dart:37-49`); ownerless writes are refused (`:96-101`). Spool has a persisted owner marker and refuses to drain on mismatch (`tracking_buffer.dart:105-122`). Secure-storage failure now fails closed (`offline_queue.dart:54-77`, `main.dart:52-63`; asserted by `test/local_data_lifecycle_test.dart`).

**Gap 1 — the purger is not on every sign-out path.** It runs on explicit sign-out (`auth_controller.dart:664-677`), on fail-closed (`:194-215` → `:376-380`) and on A→B adoption (`:341-349`), but **not** when Firebase signs the user out by itself:

```dart
// lib/features/auth/application/auth_controller.dart:99-104
if (uid == null) {
  _cachedSession = null;
  _syncLocalDataOwner(null);       // detach only — no purge
  if (publishToState && !_disposed) state = const AsyncData(null);
```
and because `_applyLocalDataOwner` only purges when *both* uids are non-null (`:345-348`), a later adoption by account B takes the `previous == null` fast path and skips the purge entirely. Data at rest therefore survives a remote revocation/disabled account (ownership stamping still stops replay, so this is defence-in-depth, not a leak of live data) → **NEW-04**.

**Gap 2 — the tracking spool is still plaintext** NDJSON in the app documents directory (`tracking_buffer.dart:75,225-236`); queue/drafts/cache are AES-encrypted, the GPS history is not → NEW-09.

**Gap 3 — the `anonymous` bucket can never be replayed** → NEW-03 (see §5 below).

### F-04 — better than the remediation claims: the server control now exists

Client (`pin_policy.dart:36-47`: exactly 6 digits, rejects repeated/sequential/patterned/common; guard `pin_attempt_guard.dart:74-83`: 30 s → 30 min escalation, hashed key, secure-storage backed, network/429 failures not counted; wired at `role_login_screen.dart:163-188,325-334`) — all effective, and `test/pin_attempt_guard_test.dart`, `test/pin_policy_test.dart` cover it.

Server (read from the sibling repo, outside mobile scope but decisive): setup-pin **refuses to overwrite** an existing PIN (`src/app/api/guard/auth/setup-pin/route.ts:180` `if (empData.guardPin || empData.guardAuthUid) return identityVerificationFailed();`, plus a compare-and-set reservation at `:190-239`), login has per-user lockout and per-IP limiting (`login/route.ts:100-113,169-171,234-259`) on a **Firestore-transaction** limiter (`src/lib/server/rate-limit.ts:22-40`), so the "conditional High" no longer depends on an unknown.

Residual: the local cooldown is bypassable by moving the device clock forward (`pin_attempt_guard.dart:37,47-50,56` compare against `DateTime.now()`); reinstalling clears the counter; and phone+DOB self-enrolment remains an identity factor for first-time setup. None of these matter much while the server is authoritative. Runtime effectiveness **UNVERIFIED**.

### F-08 — the pinned SHA-256 is the production certificate, and the Kotlin check does run

Independently verified, not taken from the claim:

```
$ keytool -list -v -keystore android/app/ciss-release.keystore -alias ciss-release
Certificate fingerprints:
     SHA256: E5:EE:3F:D6:03:D2:58:AB:E3:BC:F0:36:45:89:DC:13:C2:E8:AF:CC:3C:06:3D:33:ED:BB:68:CF:1B:5C:29:AA
```
which is exactly `productionSignerSha256 = 'e5ee3fd603d258abe3bcf0364589dc13c2e8afcc3c063d33edbb68cf1b5c29aa'` (`app_update_service.dart:142-143`). A mismatch is a hard refusal that does **not** fall back to the browser (`app_update_gate.dart:492-500`), and the pin is re-checked for *every* signer (`ApkInstallerPlugin.kt:146-157` `signerDigests.all { it == expectedDigest }`), so a dual-signed APK fails. The plugin is actually registered (`MainActivity.kt:36`), the channel name matches on both sides (`apk_installer`), and `verifyApk` reads the archive with `GET_SIGNING_CERTIFICATES` (`ApkInstallerPlugin.kt:179-189`). Cleartext is gone and there is no ATS exception on iOS.

Still open (correctly labelled "partial" by the remediation): the **region config remains unsigned server input** that can re-point Firebase/API (`region_service.dart:271-310`), and there is no certificate pinning on the API. Also note the pin is a hardcoded constant, which will break the moment the project moves to Play App Signing (F-14 item 4) → NEW-10.

### F-09 — FLAG_SECURE works but coverage is narrow

`ScreenSecurity` is ref-counted and reports only transitions (`screen_security.dart:44-77`), so overlapping screens cannot clear the flag early; `SecureScreen` acquires in `initState` and releases in `dispose` (`:106-126`). The native side sets/clears the window flag on the UI thread (`MainActivity.kt:47-59`). Wrapped: guard profile, payslips, document upload — **exactly** what the remediation claims, no more. **Aadhaar correction, incidents, attendance/photo and every FO screen are unwrapped** → NEW-08.

### F-22 — starvation/eviction/signed-out replay are genuinely fixed

No `Future.delayed` in the loop; `nextAttemptAt` is persisted per entry and not-yet-due entries are skipped while later ones proceed (`sync_service.dart:237-243`); triggers coalesce through `_rerunRequested` (`:179-205`); a 3-minute foreground timer and `AppLifecycleState.resumed` drive retries (`:128-130,167-172`); 20 failures mark `blocked` and keep the row on disk (`:280-314`); the pass returns early when nobody is signed in and re-checks before every mutation (`:210,216,224,282`).

That last control is also the source of a **new data-loss defect** (NEW-03) because the queue deliberately supports an `anonymous` owner for public attendance.

### F-23 — offline cold start is real, and it does not leak tokens

The snapshot stores `AuthSession.toJson()` only (`lib/core/models/auth_session.dart:51-66` — role, displayName, primaryId, uid, email, employeeDocId, districts, client, district, state), no bearer token, no PIN, no Firebase refresh token. It expires after 24 h, rejects future timestamps and foreign uids, and deletes itself on any anomaly (`session_snapshot_store.dart:95-152`). It is restored **only** for `AuthoritativeSessionTransportError` (no HTTP response, not bad-certificate/cancel) (`mobile_repository.dart:461-473`; `auth_controller.dart:140-152`), and offline sessions are never re-saved (`session_snapshot_store.dart:80`) so the window cannot roll forward. Region: `resolveRegionConfig` prefers live and falls back only for the **same** region code (`region_service.dart:252-267`).

### F-25 — reactive, and it is really above the navigator

`ref.watch` on `maintenance` + two `ref.listen`s (clear→re-check; forceUpdate→re-check) + resume refresh, all inside an in-tree overlay with an absorbing full-screen scrim (`app_update_gate.dart:127-200`). The `_UpdateOverlay` reads `forceUpdate` live so "Later" disappears when the server flips it (`:251-255`). Because the gate is a child of `AppLockOverlay` (`app.dart:29-31`), an armed lock correctly paints over a forced-update card.

---

## 4. New defects introduced or left by the remediation/redesign

| ID | Sev | Defect | Evidence | Fix |
|---|---|---|---|---|
| **NEW-01** | P2 / Low-Med | App lock does not consume Android back: the router's `RootBackButtonDispatcher` is registered before `AppLockOverlay`, so `didPopRoute`/`handleStartBackGesture` are unreachable while a route can pop; `PopScope` in `AppLockScreen` is inert (no `ModalRoute`). Back pops the covered route (FO "Exit app?" dialog can fire behind the lock). The shipped widget test cannot detect it (single 0-duration pump). | `app_lock_overlay.dart:62,67,133-134`; Flutter `binding.dart:911-934`, `router.dart:613-621,805-810`, `app.dart:1456`; `field_officer_shell.dart:86-110`; `test/app_lock_overlay_test.dart:241-250,324-327` | Move the lock into a `PageRoute`-less `NavigatorObserver`-independent path: register the overlay's observer **before** the router (e.g. install `AppLockOverlay` outside `MaterialApp` via a root `WidgetsApp` wrapper, or use `Router`'s `backButtonDispatcher` child + `PopScope` inside a real route). Then fix the test with `await tester.pumpAndSettle()` and assert `find.text(marker)` is gone / `route.isActive == false`. |
| **NEW-02** | **P1 / Medium** | Sign-out does not reset in-memory provider caches. `guardDashboardProvider`/`guardProfileProvider` are non-`autoDispose` and are eagerly watched by `GuardShell`, so A's payload stays in the root container; B's shell renders A's cached data until the 15-minute blanket invalidation or a manual refresh. `preloadAllGuard` uses `read(provider.future)`, which does **not** refetch an already-completed future. | `guard_shell.dart:66-77`; `guard_dashboard_screen.dart:28-32`; `preload_controller.dart:20-24`; `auth_controller.dart:500-501` ("no provider invalidation"); `refresh_controller.dart:41-59` | In `AuthSessionNotifier` (or the purger) invalidate every account-scoped provider on sign-out/uid change — a typed `ProviderContainer` registry, or `ref.invalidate` of the `preloadControllerProvider` group; add an integration test A→B asserting a fresh fetch (spy repository call count). |
| **NEW-03** | **P1 / Medium-High** | Public-attendance offline submissions are silently lost. They are queued with owner `anonymous` (`offline_queue.dart:32-47,198`; `public_attendance_screen.dart:236-244`), but the sync pass returns before touching the queue when signed out (`sync_service.dart:210`), and when a guard **is** signed in the `anonymous` entries are "foreign" and are **purged** without being sent (`offline_queue.dart:219-222,251`). The only way they ever flush is a startup race in which `currentUser != null` while `_ownerUid` is still null. | `sync_service.dart:207-219`; `offline_queue.dart:143,211-231,238-260`; `sync_service.dart:417-448` (the `isPublicAttendance` replay path exists but is unreachable) | Treat `anonymous` as a second replayable bucket: `_processPass` should process anonymous-owner entries **without** a session (they already use `kSkipApiAuth`), or reject/notify at enqueue time. Add a test: signed-out enqueue → `processQueue()` signed-out **and** signed-in → entry sent exactly once. |
| **NEW-04** | P2 / Low-Med | Local-data purge is skipped when Firebase (not the app) ends the session (token revoked, user disabled): only owner detach happens, and the later A→B adoption skips the purge. Encrypted leftovers (queue/drafts/spool) remain on disk indefinitely. | `auth_controller.dart:79-104`, `:341-349` | Purge when `previous != null && uid == null` too (debounced), i.e. treat "signed out" as a purge trigger in `_applyLocalDataOwner`. |
| **NEW-05** | **P1 / Medium** | Payroll/leave retirement is **not applied**; the app still ships the leave and payslip surfaces and calls endpoints that now return 410 (see §5). Module flags keep both modules **on by default** even with `fallback: true`. | `module_flags.dart:20,22`; `route_modules.dart:30`; `guard_shell.dart:186-192,256-262`; `guard_dashboard_screen.dart:134-144`; `mobile_repository.dart:81-82,1433,1441-1443,1469-1481` | Apply `patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch` (verified byte-applicable today), or at minimum force `{leave, payslips}` off regardless of fallback. |
| **NEW-06** | P2 / Low-Med | Any `/api/guard/leave` POST already sitting in the offline queue will be retried against a 410 twenty times and then shown to the user permanently as "1 blocked" in the sync badge, with no way to clear it. | `sync_service.dart:263-314`; `guard_leave_screen.dart:155-156,217` | The patch already adds this guard (`sync_service` rejects `/api/guard/leave`); otherwise treat 410 as terminal-blocked-on-first-failure. |
| **NEW-07** | P2 / Low | Notification deep-link tab indices are stale against the redesigned 4-tab shells: `leave_status`→guard tab 2 ("Activity"), training→tab 3 ("Profile"); `report_review`→FO tab **4** which does not exist (4 tabs: 0-3), so `IndexedStack(index: 4)` renders no content. | `notification_service.dart:255-272`; `guard_shell.dart:35-58`; `field_officer_shell.dart:36-58,100-103`; `notification_inbox_screen.dart:33-38,57-61` | Route by named destination instead of index, or clamp/validate the index against `_tabs.length`. |
| **NEW-08** | P2 / Low | `FLAG_SECURE` gaps on the most sensitive remaining surfaces: Aadhaar correction (identity document), incidents (free text + photos), attendance photo capture; the whole FO portal. | `screen_security.dart:93-126` (only 3 wrappers in `lib/`) | Wrap `guard_aadhaar_correction_screen`, `guard_incidents_screen`, `guard_attendance_screen`, `field_officer_guard_detail_screen`. |
| **NEW-09** | P2 / Low | Tracking spool is plaintext NDJSON (GPS history, up to 5 000 samples) in the documents directory, while every other account store is AES-encrypted. | `tracking_buffer.dart:75,150-160,225-236` | Encrypt the spool with the same `HiveAesCipher`-derived key, or write samples through `encrypt`/`Encrypt` from `package:pointycastle`; the purger already deletes it. |
| **NEW-10** | P2 / Ops | `productionSignerSha256` is hardcoded to the current upload key. Enrolling in Play App Signing (recommended by F-14 item 4) re-signs the APK with Google's key and would make every in-app update fail closed with "not a genuine CISS Workforce build". | `app_update_service.dart:142-143`; `ApkInstallerPlugin.kt:146-157` | Accept the Play signing certificate digest as a second pinned value before switching, and document the migration in the release runbook. |
| **NEW-11** | P2 / Ops | CI has no `targetSdk >= 36` assertion (explicitly recommended by F-13), no coverage gate (F-31), and **no iOS job at all**, so F-15's remaining gaps cannot be caught by CI. | `.github/workflows/build-apk.yml:46-83` | Add the two assertions; add a macOS `flutter build ios --no-codesign` lint job. |
| **NEW-12** | P3 / Low | Plugin manifest still contributes `exported="true"` receivers; the `BootReceiver` path tries to start a `location`-type foreground service from `BOOT_COMPLETED`, which Android 14+ refuses (`ForegroundServiceStartNotAllowedException`) — logged, not user-visible. Runtime behaviour **UNVERIFIED** without a device. | `~/.pub-cache/…/flutter_background_service_android-6.3.1/android/src/main/AndroidManifest.xml`; `AndroidManifest.xml:60-64` | Add `tools:node="remove"` for `WatchdogReceiver`/`BootReceiver`, or `tools:replace` exported=false + a signature permission. |
| **NEW-13** | P3 / Low | `NSMicrophoneUsageDescription` claims microphone use for video, while Android's `RECORD_AUDIO` was removed as "not used by any product flow". Inconsistent privacy declarations (App Store privacy-label risk). | `ios/Runner/Info.plist` (NSMicrophone…); `AndroidManifest.xml:40-48` | Drop the microphone purpose string, or restore the Android permission if a video flow exists. |

### Things that are *good* and should not regress
`main.dart` fails closed on a missing cipher for queue/drafts/read-cache (`:52-87`) and isolates each non-critical init so a corrupt box cannot blank the app (`:88-101`); `ScreenSecurity` is genuinely ref-counted; `UpdateUrlPolicy` is a pure, well-tested function (`test/update_url_policy_test.dart`); the downloader's digest sink never buffers the APK (`apk_downloader.dart:163-201`); the session snapshot contains no credentials; and `flutter analyze`/`dart analyze` are clean.

---

## 5. Payroll/leave retirement on mobile — **not applied**; the tree still calls 410 endpoints

### 5.1 Was the patch applied?

`patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch` (84 843 B, 29 files) is **NOT applied**, and it is still byte-applicable to today's working tree:

```
$ cd /Users/mymac/Documents/CISS-Mobile
$ git apply --check --verbose /Users/mymac/Documents/CISS/patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch
Checking patch lib/core/auth/app_lock_overlay.dart...
… 29 files, no errors …
EXIT=0
```
A clean `--check` proves the working tree does **not** contain the removals: no partial application, and no equivalent removal done by another session. Every file the patch deletes still exists (`lib/core/models/leave_models.dart`, `lib/core/models/payslip_models.dart`, `lib/features/guard/presentation/screens/guard_leave_screen.dart`, `…/guard_payslips_screen.dart`), and `git status` shows only `guard_payslips_screen.dart` modified (by the FLAG_SECURE/redesign work, not by retirement).

### 5.2 Leftover inventory (all verified today)

> Web-side ground truth (read from `/Users/mymac/Documents/CISS`): `src/app/api/guard/payslips/route.ts:4`, `src/app/api/guard/leave/route.ts:4,8,12`, `src/app/api/guard/payslips/[id]/payslip/route.ts:4` all return **410** `"This feature has been retired."`; `src/app/api/payroll-leave-retirement.test.ts` additionally asserts the guard dashboards no longer emit `leaveBalance`/`payslips`/`netPay`.

| Surface | Leftover (file:line) | What still happens |
|---|---|---|
| Guard shell entries | `guard_shell.dart:186-192` "Leave Requests", `:256-262` "Salary Payslips" | Tiles are live and push the retired screens |
| Guard dashboard tiles | `guard_dashboard_screen.dart:134-144` (`moduleEnabled(ref,'payslips')`, `moduleEnabled(ref,'leave')`) | Tiles render because the flags default **on** |
| Repository reads | `mobile_repository.dart:1432-1440` `fetchPayslips()` → `GET /api/guard/payslips`; `:1441-1447` `downloadPayslipPdf()` → `GET /api/guard/payslips/{id}/payslip`; `:1469-1471` `fetchLeaveOverview()` → `GET /api/guard/leave` | **410 Gone** on every call |
| Repository writes | `mobile_repository.dart:1472-1478` `createLeaveRequest()` → `POST /api/guard/leave`; `:1479-1483` `cancelLeaveRequest()` → `PATCH /api/guard/leave` | **410 Gone** |
| Cache allowlist | `mobile_repository.dart:81-82` (`'/api/guard/payslips'`, `'/api/guard/leave'`) | Dead allowlist entries (410s are never cached, so no stale-data risk) |
| Offline enqueue | `guard_leave_screen.dart:155-156` (create), `:217` (cancel) | Queues a request that can only 410 → retried 20× → blocked (NEW-06) |
| Dashboard model | `lib/core/models/mobile_dashboard_models.dart:2,15,32` (`import 'leave_models.dart'`, `required this.leaveBalance`) | Parses a field the web dashboard no longer sends (null-tolerant, so cosmetic) |
| Refresh invalidation | `lib/core/sync/refresh_controller.dart:13` (import), `:50` `_ref.invalidate(guardLeaveProvider)` | Keeps 410-bound providers alive/re-fetched every 15 min |
| Module flags | `module_flags.dart:20` `'leave': true`, `:22` `'payslips': true`, `:47` `isOn(key, {required bool fallback})`; `route_modules.dart:30` `flags.isOn(module, fallback: true)` | **Retired modules are ON by default** — the exact "must stay off even with fallback:true" failure |
| Route→module map | `route_modules.dart:8,11` (`/guard/leave`, `/guard/payslips`) | Prefixes that match no real route (F-24) |
| Notifications | `notification_service.dart:261-263` `case 'leave_status'`; `notification_inbox_screen.dart:12-14,33-38` (pushes `GuardLeaveScreen`), `:57-61` (pushes `GuardPayslipsScreen`) | Dead deep links + NEW-07 wrong tab |
| Guards' UI copy | `guard_shell.dart:166` "…leave and incident reports.", `:236` "Credentials, payslips, …" | Product copy still advertises retired features |

Nothing in the payroll/leave removal exists in `lib/`: no `_removedModules = {'leave','payslips'}`, no `/api/guard/leave` replay guard in `sync_service.dart` (both are added by the patch).

### 5.3 Every mobile call site that can hit a 410 today

1. `GET /api/guard/payslips` — `mobile_repository.dart:1433` (via `fetchPayslips`, `guardPayslipsProvider`, `guard_payslips_screen.dart:226`).
2. `GET /api/guard/payslips/{id}/payslip` — `mobile_repository.dart:1443` (via `downloadPayslipPdf`, invoked from `guard_payslips_screen.dart:36`).
3. `GET /api/guard/leave` — `mobile_repository.dart:1470` (via `fetchLeaveOverview`).
4. `POST /api/guard/leave` — `mobile_repository.dart:1476`, and offline-queued at `guard_leave_screen.dart:155-156`.
5. `PATCH /api/guard/leave` — `mobile_repository.dart:1480`, and offline-queued at `guard_leave_screen.dart:217`.

Correctly **not** called (checked, so the mobile app does not add to the 410 surface): `/api/field-officer/upload` (retired server-side; the app uploads report photos straight to Storage — `mobile_repository.dart:1229-1252`), `/api/guard/auth/send-reset-otp` and `/verify-reset-otp` (no mobile reference), all `/api/admin/payroll/*`, `wage-config`, `compliance-settings`, and `/api/admin/clients/*/wage-config` (web-only).

Net effect of not applying the patch: five live 410 call paths, two dead caches/flags that default-on, one unretryable queue path, and stale notification/copy surfaces. Severity **P1** (user-visible feature that always errors; not a security defect).

---

## 6. Remediation-claim scorecard (claim vs verified reality)

| Claim (remediation §1/§2) | Verified? | Note |
|---|---|---|
| `flutter analyze` exit 0, "No issues found" | **true** | re-run today, exit 0 |
| 316 tests passing | **true** | 316 pass, 0 fail |
| Coverage 18.7 % (3 526 / 18 866) | **true** | 18.69 % |
| `targetSdk 36` | **true** | `build.gradle.kts:45` |
| Cleartext denied for production host | **true** | `network_security_config.xml` |
| `RECORD_AUDIO` removed | **true (declared)** | merged-manifest effect **UNVERIFIED** (no build run) |
| App lock on **every route**, above the Navigator | **true** | but "claims/back-stops Android back" is **false** → NEW-01 |
| Offline cold start restored (24 h snapshot, Offline badge) | **true (code)**; device evidence is the prior session's | token-free, uid-bound, transport-only |
| Read cache UID-keyed / encrypted / 24 h | **true** | fully effective |
| Queue/drafts/spool owner-bound, encrypted, purged | **mostly true** | purge misses Firebase-initiated sign-out; spool not encrypted; anonymous bucket unreplayable |
| 6-digit PIN policy + escalating cooldown | **true** | plus server lockout/no-overwrite now exist |
| `UpdateUrlPolicy` + APK signer pin (`e5ee3fd6…c29aa`) | **true** | pin matches the keystore cert, Kotlin check runs and is enforced |
| Streaming hash + size cap + ENOSPC | **true** | 5 % hard cap, partial files deleted |
| `dataExtractionRules` + `fullBackupContent=false` | **true** | both cloud-backup and device-transfer excluded |
| iOS plist/Podfile/entitlements | **partly** | no `DEVELOPMENT_TEAM`, no `Podfile.lock`, no CI |
| Mapping/symbols retained | **true** | no `proguard-rules.pro`, no `--obfuscate` |
| Reactive maintenance/force-update gate | **true** | and correctly under the lock overlay |
| Contrast AA | **true** | recomputed independently |
| Payroll/leave retirement | **not claimed by the remediation, still absent** | patch applicable, not applied |

---

## 7. Executive summary (10 lines)

1. The analyzer/test gates are genuinely green: `flutter analyze` and `dart analyze` both "No issues found" (exit 0), `flutter test` **316/316 pass**, coverage **18.69 %** — the remediation's numbers reproduce exactly.
2. Of the 34 prior findings, **13 are fixed (+F-12 closed), 11 partial, 9 open, 0 outright regressed** — the remediation's 14/11/9 tally is honest, but F-01's back-button claim and F-03/F-09/F-11 nuance are over-stated.
3. The three High client findings are materially closed: the lock now sits **above the Navigator** and re-arms on `paused`→`resumed`; the read cache is `region|uid|path|query`, transport-only, 24 h, AES-encrypted, and purged; queue/drafts/spool are owner-bound and encrypted.
4. The update trust chain is real work, not paper: `UpdateUrlPolicy` gates download **and** browser fallback, and the pinned SHA-256 `e5ee3fd6…c29aa` **is** the production keystore certificate (verified with `keytool`), enforced natively against every APK signer.
5. Two High-adjacent items remain open by design: F-10 (fresh login still silently clears the app-lock flag) and F-24/F-27 (module gating and route-level auth are still inert).
6. **Payroll/leave retirement is not applied**: `git apply --check` on the 2026-10-26 patch is clean, and five live call sites (`GET/POST/PATCH /api/guard/leave`, `GET /api/guard/payslips`, `GET …/{id}/payslip`) still hit endpoints that return **410**; `leave`/`payslips` are still `true` by default with `fallback: true`.
7. The most serious *new* defect is cross-account **in-memory** leakage: `guardDashboardProvider`/`guardProfileProvider` survive sign-out, so account B can render A's dashboard until the 15-minute blanket refresh (NEW-02).
8. The second is silent loss of **public-attendance** offline submissions: the anonymous queue bucket is unreplayable when signed out and is purged when anyone signs in (NEW-03).
9. The rest are contained: no back-button swallow while locked (NEW-01), no purge on Firebase-initiated sign-out (NEW-04), 410 retry-to-blocked (NEW-06), stale notification tab indices (NEW-07), FLAG_SECURE gaps on Aadhaar/incidents/attendance (NEW-08), plaintext GPS spool (NEW-09), a hardcoded signer pin that blocks Play App Signing (NEW-10).
10. Nothing in the working tree was modified; all claims above are re-derivable from the cited `file:line` pairs, and hardware-only behaviours (biometric prompt, merged manifest, FLAG_SECURE capture blocking, BootReceiver FGS start) are marked UNVERIFIED.

---

## 8. Prioritised remaining attention

### P0 — before distributing 1.0.22
*None newly identified.* The client-side High set is genuinely closed, `targetSdk` is 36, and the analyze/test gate is green. Do **not** treat that as "ship-ready": P1 below plus F-15's Xcode work and F-14's tagged CI run are prerequisites for a signed release.

### P1 — next sprint (user-visible breakage or cross-account data)
1. **NEW-05 + §5** — apply `patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch` (verified applicable) or delete the leave/payslip surfaces; force `leave`/`payslips` off regardless of `fallback`, and drop the two 410 paths from `_cacheableReadPaths`.
2. **NEW-02** — invalidate account-scoped providers on sign-out/uid change; add an A→B integration test asserting a refetch.
3. **NEW-03** — make the `anonymous` queue bucket replayable (or refuse it at enqueue); add a test for the signed-out→signed-in sequence.
4. **NEW-06** — stop retrying 410-bound requests; treat 4xx-as-terminal so guards never see a permanent "blocked" badge for a retired feature.
5. **F-10** — make the app-lock reset explicit (one-time "re-enable?" prompt) instead of silently clearing the durable flag.
6. **F-14 / F-15** — tag `v1.0.22` and let CI produce the artifacts; finish `DEVELOPMENT_TEAM` + `pod install` or formally declare iOS unsupported.

### P2 — quarter / defence in depth
7. **NEW-01** — install the lock's back handling where it actually wins (or accept and document that back pops beneath the lock); fix the test with `pumpAndSettle`.
8. **NEW-04** — purge on Firebase-initiated sign-out.
9. **NEW-08 / NEW-09** — extend `SecureScreen` to Aadhaar/incidents/attendance/FO detail; encrypt the GPS spool.
10. **NEW-07** — route notifications by destination, not by stale tab index (FO index 4 is out of range).
11. **NEW-10** — plan the Play App Signing migration around the hardcoded signer pin.
12. **F-13/F-31/NEW-11** — add `targetSdk >= 36` and per-directory coverage gates to CI; add an iOS lint job.
13. **F-24 / F-27 / F-30 / F-32 / F-33** — the architecture block (route-level auth, module gating, lazy lists + image sizing + single notification poller, layering, dead code).
14. **F-06 / F-07 / F-19 / F-21 / F-26 / F-28** — consent + retention copy, server-side attendance hardening, exported receivers and legacy storage permissions, framework upgrade, the 12 remaining raw error strings, icon-button labels/tooltips.

---

## Appendix A — commands used (all reproducible, no writes to product code)

```bash
cd /Users/mymac/Documents/CISS-Mobile
git rev-parse --abbrev-ref HEAD; git rev-parse --short HEAD; git status --porcelain | wc -l   # 84
flutter --version                                   # 3.29.0 / Dart 3.7.0
flutter analyze                                     # No issues found! exit 0
dart analyze                                        # No issues found! exit 0
flutter test --reporter expanded                    # 316 passed
flutter test --coverage                             # lcov.info → 3526/18866 = 18.69 %
awk -F: '/^LF:/{lf+=$2} /^LH:/{lh+=$2} END{printf "%d/%d %.2f%%\n", lh, lf, 100*lh/lf}' coverage/lcov.info
git tag --list | tail -5                            # latest v1.0.17
git apply --check --verbose /Users/mymac/Documents/CISS/patches/2026-10-26-ciss-mobile-remove-payroll-leave.patch   # exit 0 → NOT applied
keytool -list -v -keystore android/app/ciss-release.keystore -alias ciss-release   # SHA256 E5:EE:3F:D6:…:5C:29:AA
grep -rn "error.toString()" lib/features lib/shared | wc -l                          # 12
grep -rn "Semantics(" lib --include=*.dart | wc -l ; grep -rn "Tooltip(" … | wc -l     # 5 / 0
grep -rn "ListView(" lib --include=*.dart | wc -l ; grep -rn "cacheWidth" … | wc -l   # 27 / 0
grep -rn "import '.*features/" lib/core --include=*.dart | wc -l                     # 21
```

No build/download/device/emulator operation was performed. No git state was mutated (`--check` and read-only `git tag`/`git ls-files` only).

## Appendix B — explicitly UNVERIFIED

* Merged-manifest permission set after plugin merge (`RECORD_AUDIO` removal, `RECEIVE_BOOT_COMPLETED`, legacy storage perms) — needs a release build + `aapt2/apkanalyzer`; the prior audit used a built APK, this one did not.
* `FLAG_SECURE` actually blocking `adb shell screencap` (window flag set/cleared on UI thread by `MainActivity.kt:47-59`).
* Biometric prompt behaviour on real hardware, and whether `handleStartBackGesture` is reachable on a target-36 device (framework source says the router's dispatcher wins either way).
* `BootReceiver` starting a `location` FGS on API 34+ (NEW-12) — blocked by platform policy per Android 14 docs, not exercised here.
* iOS build/signing: no Xcode/CocoaPods, no `Podfile.lock`; `flutter build ios` not attempted.
* Server-side runtime effectiveness of the new guard throttle/lockout (code read, not exercised); all F-04 server statements are from reading `src/app/api/guard/auth/*` in the sibling web repo.
* `gh`/CI execution of `.github/workflows/build-apk.yml` (workflow correctness reviewed statically; the five signing secrets cannot be inspected).
* Coverage attribution per directory (only the aggregate was recomputed).
