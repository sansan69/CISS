# Cross-app release readiness — 19 October 2026

Scope: Android, sibling web/backend and Firebase contracts. Prepared in the existing isolated redesign worktrees. Changes are intentionally uncommitted and undeployed. This is an engineering verification record, not a guarantee of perfect operation.

## Defects addressed

- Bind queued authenticated writes to their original account and backend; quarantine legacy entries whose identity cannot be proven. Invalidate stopped regional sync services before token refresh, upload and dispatch.
- Preserve causal order across check-in, breaks and checkout, including site changes. Keep independent report and public proof streams separate.
- Preserve original break capture time and session identity; deduplicate accepted retries and reject cross-session or stale mutations. Bind the next shift correctly and protect startup state from late responses.
- Persist eligible buffered tracking against its historical session, including after checkout/new check-in. Keep live locations monotonic and owned by the current open session. Resolve legacy samples with a seven-day indexed, paginated query cached per batch.
- Replay accepted willingness receipts before mutable duty closure checks, retaining current authorization checks. Preserve leave request identity across retries.
- Repair drifted role scope using linked active profiles; skip privileged and ambiguous identities.
- Correct Play minimum-version gating and retain release symbols. Run backend tests and isolated Firestore rules tests in CI. Keep proposed employee-access audit TTL outside the routine deployment configuration.

- Add stable retry IDs to incident/patrol and officer visit/training creates. Incident/patrol receipts are transactional, scoped by authenticated UID + employee and endpoint; conflicting content returns 409. Accepted patrol receipts replay before the mutable 15-minute capture window, with current authorization retained.
- Preserve successful photo upload URLs across manual and queued retries in guard, public and QR flows. Remove redundant raw photos before replay to avoid rotating the download token of an already saved attachment.
- Preserve early-checkout reason and request identity in the durable payload; canceling the reason sheet no longer marks success. Correct the success label to the completed punch.
- Reject ambiguous same-type and mixed-type linked profiles during claims repair, using the same shared planner in preview and execution.
- Exclude ignored local scratch probes from test discovery; their pre-session and delayed-commit race scenarios remain covered in tracked regression tests.

## Firebase and production checks

Read-only inspection confirmed the Android registration uses `ciss-workforce`. Deployed Firestore and Storage rules match the local rule files. All 137 deployed composite indexes were READY and matched their local equivalents before adding the historical-tracking index; both local index configurations now contain 138 composites. The new `attendanceSessions(employeeDocId ASC, endedAt DESC)` index is not deployed.

Thirty-five Firestore rule tests passed against an isolated demo emulator. These validate authorization scenarios without production writes. The known emulator limitation around breadcrumb subcollection list queries remains; authenticated production list access needs a device/account smoke test.

Unauthenticated production availability probes covered 57 API paths. Responses were 34 unauthorized, 20 method-not-allowed, one bad request, one successful public-regions response and one missing endpoint. The missing `/api/field-officer/employee-access` endpoint is a new local implementation: deploy backend before Android distribution. Availability checks do not prove authenticated end-to-end business behavior.

No live data, custom claims, rules, indexes or retention policies were modified.

## Release order and remaining gates

1. Review and commit the changes in both repositories.
2. Deploy the routine Firestore index configuration and wait for the new historical-tracking index to become READY.
3. Deploy the web/backend, then verify the new employee-access endpoint and authenticated role flows.
4. Build the production-signed Android release and test account/region changes, offline replay, overnight checkout, permissions and officer directory/history on a device before distribution. No device installation was requested for this run.
5. Publish through the selected release workflow. Update the sideload download manifest only with the real signed artifact's version, URL, size and hash; it currently still describes the previous released APK.

Signing/Play credentials and store setup are external gates. Approved policy URLs and vendor security-report settings remain configuration requirements. Play Integrity remains explicitly unconfigured until a trusted verifier exists. Audit TTL is a separate opt-in configuration requiring office approval; the existing location-history TTL remains in the default configuration.

## Final verification

- Mobile: **587 tests passed**; `flutter analyze` clean.
- Web/backend: **767 tests passed**, 35 emulator-only tests skipped in this run; dedicated demo-emulator run passed all **35/35**.
- Web TypeScript checking and ESLint passed. Production build passed using the real public Firebase configuration, without loading administrative credentials.
- Final GPT-6.1 Sol targeted re-reviews found no further actionable defects in the repaired sync, tracking, claims, retry and photo-replay paths. GPT-6 Luna implemented the fixes.
- Both worktree HEADs match freshly fetched `origin/main`: mobile `08c14ee`, web `b13ba8f9`. No rebase is required as of this verification.
- Final diff whitespace checks passed; no newly added environment/signing-key files or private-key blocks were found. Generated `.flutter-plugins` is removed from tracking and ignored.
- Android Play and sideload debug native builds both passed. Merged manifests omit APK installation permission in Play mode and retain it in sideload mode. No device installation or signed release build was performed.

Remaining uncertainty: authenticated production journeys, actual handset permissions/background behavior/TalkBack, signing and Play installation/update behavior were not exercised. No assertion of universal correctness or literal perfection is made. These checks prepare the source changes for review and commit; production rollout must satisfy the release gates above.


## Authorized rollout — 19 October 2026

After the audit, the user authorized the index creation, production backend rollout and commits/pushes to both main branches. The new attendanceSessions(employeeDocId ASC, endedAt DESC) index `CICAgLio7JkK` is deployed in ciss-workforce and confirmed READY. No audit TTL, rules or business-data changes were applied. Fresh pre-push test runs passed: mobile 587 and web/backend 767 (35 emulator-only tests skipped; the earlier dedicated emulator run passed all 35). The web main push triggers the existing production Vercel integration; mobile follows confirmed backend deployment. This addendum supersedes the earlier pre-rollout index/deployment status.


### Production CI timezone follow-up

The first production push exposed an inherited patrol-clock dependency in UTC CI: night eligibility and hour bucket keys used the host clock. Both now use explicit Asia/Kolkata hours and minutes. Added inclusive-start/exclusive-end and IST-midnight bucket regressions; focused checks passed under UTC and America/Los_Angeles. The full Node 22 UTC run passed 769 tests (35 emulator-only skipped), TypeScript checking and ESLint. Production deployment and CI are tracked against the follow-up main commit.
