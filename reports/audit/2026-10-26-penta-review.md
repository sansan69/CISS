# PENTA review — web and mobile (2026-10-26)

**Hot word:** PENTA · **Pipeline:** plan (gpt-6-astra medium) → build (deepseek-flash) → swarm (gpt-6-luna high, parallel) → verify (deepseek-flash) → review (gpt-6.1-sol medium)
**Mode:** read-only for the pipeline (`--no-apply`); findings fixed afterwards by the Lead and re-checked with the gates below.
**Reports:** `/Users/mymac/Documents/CISS/.penta/report.json`, `/Users/mymac/Documents/CISS-Mobile/.penta/report.json`

## 1. Web — CISS workforce (13 files)

Pipeline: 6 swarm subagents, verifier accepted **4** and rejected **1**; dry-run (nothing written by the pipeline).

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | Medium | `readStateMatches()`/`writeStateMatches()` treated a missing `stateCode` claim as a wildcard, so a role account without the claim could read all state-tagged documents (and admin-write paths could write arbitrary states). | **Fixed** — new `stateClaimMatches()` requires a matching claim for staff; guards/client users stay exempt (their clauses already scope them); superAdmin remains the explicit cross-state exception. Validated + **deployed** (release 16:15:31Z, readback byte-identical). |
| 2 | Medium | The single-use attendance proof was consumed **before** the idempotency check, so a retry after a lost response returned 401 even though attendance had committed. | **Fixed** — proof consumption moved after `findDuplicateSubmission()`; retries return the prior `duplicate:true` result. Test added. |
| 3 | Medium | `attendanceLogs` document id is the raw `clientRequestId`; if another guard had used the same id, the route returned `duplicate:true` referencing the other guard's log and silently dropped this submission. | **Fixed** — the transaction now compares the existing log's `employeeDocId` and returns **409** on a cross-guard collision. Test added. |
| 4 | Low | Tokens were valid at their exact `exp` second (`exp < now`). | **Fixed** — `exp <= now`; exact-expiry test added. |
| — | — | *Rejected by the verifier:* `consumeAttendanceProof` does not check `expireAt`. Unreachable through the only caller (token expiry rejects first); kept as defence-in-depth, not a defect. | No change |

Gates after fixes: `npm test` **91 files / 541 tests**, typecheck, lint, `npm run build` — all pass.

## 2. Mobile — CISS-Mobile (10 files, then 8)

The full `penta run` completed plan/build/swarm, but **stage 4 crashed twice** ("deepseek-flash did not return bare JSON"), so the six swarm claims across five files are **unverified** and the pipeline is **not clean**. Stage 5 (`penta review`, Sol medium) was run separately in five rounds; every confirmed finding was fixed:

| Round | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | `_processPass` snapshotted A's queue and only checked "signed in"; after A→B it could send A's entries with B's token and recreate purged entries via failure bookkeeping. | **Fixed** — pass-level `activeUid`, per-entry owner check, pre-dispatch and post-attempt rechecks; failure bookkeeping refuses entries not owned by the current uid. Test added. |
| 2 | High | Tracking batches and report/attendance photo uploads could continue under B after an identity switch; report storage paths used the mutable current uid. | **Fixed** — `_flushTrackingSamples(expectedUid)` rechecks before send and commit; `stillOwned()` guards attendance/report uploads and the final dispatch; paths now derive from `request.uid`. |
| 2 | High | The app lock covered the workspace visually but left it focusable and discoverable by accessibility services (hardware keyboard / screen reader could reach covered controls). | **Fixed** — the preserved child is wrapped in `FocusScope(canRequestFocus/descendantsAreFocusable: !locked)` and `ExcludeSemantics(excluding: locked)`; widget test added. |
| 3 | High | `OfflineQueue.enqueue` deleted the oldest entry at capacity (silent loss of unsynced/blocked work). | **Fixed** — no eviction; `OfflineQueueFullError`; enqueues serialized; all seven callers surface the error instead of reporting a false "saved offline". Test rewritten. |
| 4 | High | The queue owner was read inside the serialized write, so an enqueue made under A could persist after B became owner and replay A's payload under B. | **Fixed** — owner + generation captured synchronously at `enqueue`, stale writes rejected with `OfflineQueueOwnerChangedError`; test added. |
| 5 | High | Client-report photo upload loop had no ownership check and used the current uid for the path. | **Fixed** — `stillOwned()` before each upload; path derives from `request.uid`. |
| 5 | High | Account cleanup/adoption is not serialized: a delayed purge from the previous account can run while the next account is adopted, and newly queued work can be removed. | **OPEN** — needs a shared cleanup/adoption barrier in `auth_controller.dart` (`_applyLocalDataOwner` awaits purge, but a second identity transition can enter while it awaits). Recommended fix and test are in the review output; not implemented in this pass. |

Gates after fixes: `flutter analyze` clean, `flutter test` **328 passed** (was 316 before the review).

## 3. Verdict

- **Web:** the pipeline found four real defects; all are fixed, rules are deployed, and all gates are green. The run itself reports `clean:false` only because it was a `--no-apply` dry run.
- **Mobile:** stage 4 never completed, so the PENTA "verifier-clean" gate is unfulfilled; stage 5 still produced six confirmed high-severity defects, five of which are fixed and tested. One high-severity race (account cleanup/adoption barrier) remains open and is documented above.
- **Not changed by the pipeline:** no file was written during `run`; all edits were made deliberately afterwards.

## 4. Follow-ups

1. Fix the auth cleanup/adoption barrier (serialize `_applyLocalDataOwner` transitions; test a delayed purge followed by another sign-in).
2. Re-run the full PENTA mobile pipeline when the verifier route returns JSON, to verify the six stage-3 claims.
3. Smoke-test the deployed rule change: client portal, guard profile, HR/accounts reads on state-tagged documents.

## 5. Re-run after the auth barrier (2026-10-26, 22:05–22:16)

**Run A (verifier succeeded).** The full pipeline completed stage 4: **accepted 5, rejected 3**, verdict `fail`. All five accepted findings were fixed:

| Severity | Finding | Fix |
|---|---|---|
| Low | App-lock back handlers read a paint-time `_locked` mirror, so a lock state change before the next rebuild could let a back press reach the router. | Handlers now read `appLockControllerProvider.showsLockSurface` live; mirror removed. |
| Medium | `resolveCurrentSession` signed out whatever account was current when a delayed authoritative denial for the previous identity arrived. | Captured `resolvingUid`; sign-out is guarded at the call and again immediately before `signOut()`. |
| Medium | `_getJson` built the read-cache key from the current uid **before** minting the bearer token, then persisted/read the cache without re-checking — cross-account cache leakage/serving under A→B. | Uid captured before the request; the cache key uses it; after the response and in the fallback path the identity is re-checked, otherwise `AuthenticatedIdentityMismatchError` is thrown and nothing is cached/served. |
| Low | A non-public request queued while signed out was stamped `anonymous`, then became uncounted/unreplayable permanent debris after sign-in. | `enqueue` now rejects anonymous non-public payloads (`OfflineQueueAnonymousError`); `purgeForeignRequests` removes them while keeping anonymous public attendance. |
| Medium | A signed-out pass hit `return` on the first account-scoped entry, so later public-attendance entries were never drained. | `activeUid == null` now `continue`s past account-scoped entries; identity *changes* still abort the pass. |

Rejected: the anonymous-entry claim as stated (corrected in the accepted version), a module-flags non-claim, and the auth-controller entry was context only.

**Auth barrier (previous open finding).** Fixed: all sign-out/fail-closed cleanup now runs on the same `_ownerApplyChain` as owner adoption (`enqueueIdentityCleanup`), and each cleanup task captures an identity epoch — if a newer identity was requested, the stale cleanup is skipped and the next account's adoption purge handles the previous account's data. A late purge can no longer erase the incoming account's work. Regression test added (`skips cleanup queued for an identity that already changed`).

**Run B (22:13).** The full pipeline was re-run on the fixed tree. Stage 4 failed again with the intermittent empty-JSON response from deepseek-flash, so its six swarm claims are **unverified**; the code gates are green (`flutter analyze` clean, **331 tests**).

**Status:** the five accepted findings and the auth barrier are closed and tested. The PENTA `verifier_clean` gate remains unfulfilled only because that model route returned empty output on the last attempt; no confirmed finding is open.
