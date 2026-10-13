# Production readiness audit — 2026-09-23

## Scope

Reviewed the tracked production tree at `main` commit `a188f72d`, including Next.js deployment configuration, Firebase security rules, shared authentication and rate limiting, cron handlers, attendance identity and submission, enrollment uploads, and the production dependency tree. The local working tree also contains 64 modified or untracked entries; those are not treated as shipped production behavior.

This was a static code and dependency review. No application tests, live writes, migrations, exploit attempts, or deployment changes were run. Vercel environment values and the live deployment's resolved version were not inspected. The Vercel deployment triggered by the earlier push has not been confirmed from this review.

## Executive summary

There is one critical dependency issue and several high impact access-control weaknesses:

1. The locked Next.js and Sharp versions are affected by a critical AVIF image-optimization remote-code-execution advisory. The app enables AVIF and permits Firebase Storage images through `next/image`.
2. Public attendance identification can issue a valid attendance proof based on an employee ID alone; the QR path accepts a QR without its HMAC token. The submission route accepts that proof as authority to write attendance.
3. A caller can bypass strict geofencing by supplying any non-empty `overrideReason`. When the deployment mode is unset, the handler defaults to warning and records out-of-radius attendance.
4. Firebase Storage permits every signed-in account to read all employee signatures and attendance photos.
5. An unauthenticated employee lookup route returns phone and current attendance context for a known employee ID, with no local rate limit.

`npm audit --omit=dev` reported 77 production-tree vulnerable package entries: 1 critical, 13 high, 62 moderate, and 1 low. Some are transitive and need route-level reachability review; the Next.js and Sharp issue is directly confirmed by enabled app configuration.

## Findings

### SEC-001 — Critical: AVIF optimization reaches vulnerable Next.js and Sharp versions

- **Rule ID:** NEXT-SUPPLY-001
- **Severity:** Critical / P0
- **Location:** `package-lock.json:14376` (`next@15.5.22`); `package-lock.json:16404` (`sharp@0.35.3`); `next.config.ts:58`; `src/app/api/public/enroll/upload/route.ts:85`.
- **Evidence:** The app explicitly enables `image/avif`, allows remote images from `firebasestorage.googleapis.com`, and uses `next/image`. Public enrollment accepts image MIME types including AVIF and stores the uploaded content type. The pinned Next.js version is in the affected range `<15.5.24`; the pinned Sharp version is below its patched `0.35.4` release. The Next.js advisory describes unauthenticated RCE when AVIF files are optimized.
- **Impact:** A remotely reachable image optimization request involving an attacker-controlled AVIF can reach the vulnerable image decoder in the production app. This is a server compromise risk.
- **Recommendation:** Upgrade Next.js to the currently patched 15.5 line (`15.5.26` as of this audit) and update the Sharp override to a patched version. Regenerate the lockfile and re-run the production dependency audit before deployment.
- **Mitigation:** Until patched, disable AVIF optimization and prevent AVIF files from entering any image source handled by `next/image`.
- **Verification note:** The exact exploit path depends on the deployed image optimizer and whether it processes attacker-controlled AVIF input. The repository enables the affected feature and accepts image uploads, so this is not a theoretical package-only match.
- **References:** [Next.js AVIF image-optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4); [Next.js September 22, 2026 security update](https://nextjs.org/blog/nextjs-security-update-september-22-2026).

### ATT-001 — High: Public attendance proof can be minted from a predictable identifier

- **Rule ID:** NEXT-AUTHZ-001
- **Severity:** High / P1
- **Location:** `src/app/api/public/attendance/identify/route.ts:25`; `src/app/api/public/attendance/identify/route.ts:221`; `src/app/api/attendance/submit/route.ts:324`; `src/lib/server/attendance-verification-token.ts:53`.
- **Evidence:** The public identify route accepts `employeeId` without requiring a phone number (`phoneNumber` is optional). In the QR branch, the HMAC is checked only when `qr.token` exists, so a QR containing just an employee ID is accepted. A successful lookup returns a signed, ten-minute attendance verification token. The submission route checks that the token's employee document ID matches, then uses it as the anonymous caller's authority to submit attendance.
- **Impact:** Anyone who can guess or learn a guard's employee ID can obtain the same short-lived write credential as a verified public attendance attempt. The write route also accepts caller-supplied capture metadata and location coordinates, so this can be used to create false attendance records and affect payroll or client reporting. IP rate limits slow attempts but do not establish identity.
- **Recommendation:** Require a non-forgeable proof for public submissions (for example, a valid signed QR or a verified phone challenge), require the HMAC for the QR method, and enforce the required proof method again at submission. Bind the token to the method and any required proof so a lookup response alone does not become authorization.
- **Mitigation:** Disable anonymous employee-ID-only attendance until a possession check is enforced; route guards through their authenticated account when possible.
- **Verification note:** Manual ID and phone entry are documented product flows. If policy intentionally treats knowledge of those values as sufficient identity proof, this is a product control choice; it still allows impersonation by anyone who learns the values.

### GEO-001 — High: Strict geofence can be bypassed with a text field

- **Rule ID:** NEXT-AUTHZ-002
- **Severity:** High / P1
- **Location:** `src/app/api/attendance/submit/route.ts:611`; `src/types/attendance.ts:85`.
- **Evidence:** The handler blocks an out-of-radius attendance only when `GEOFENCE_ENFORCEMENT_MODE` equals `strict` and `payload.overrideReason` is empty. The request schema allows any string of 1–500 characters, and the route has no supervisor authorization check for the override. The code also defaults the mode to `warn` when the environment variable is absent; in that mode out-of-radius punches are written and only flagged for review. `siteData.strictGeofence` is recorded on the log but does not control the block decision.
- **Impact:** A caller can submit any reason and bypass strict mode. If the Vercel environment variable is absent or misconfigured, every site's radius is warning-only, so attendance outside the configured radius is still recorded.
- **Recommendation:** Require a server-verified supervisor override, make the production default strict, and enforce each site's `strictGeofence` setting in the decision. Verify that the production Vercel environment explicitly selects the intended enforcement mode.
- **Mitigation:** Reject client-supplied overrides on public requests and alert on all out-of-radius records until authorization is fixed.
- **Verification note:** The configured Vercel value is outside the repository and was not inspected. The text-only bypass remains present even when strict mode is configured.

### STOR-001 — High: All signed-in roles can read every signature and attendance photo

- **Rule ID:** FIREBASE-STORAGE-001
- **Severity:** High / P1
- **Location:** `storage.rules:121`; `storage.rules:129`.
- **Evidence:** The rules use `allow read: if isSignedIn()` for `employees/{employeeKey}/signatures/{fileName}` and `employees/{employeeKey}/attendance/{attemptId}/{fileName}`. `isSignedIn()` checks only that Firebase Auth exists; it does not verify role, employee ownership, client, or district.
- **Impact:** Any authenticated guard, field officer, client user, or staff account can read another employee's signature and attendance photos by addressing the object path. These files can expose identity and location evidence.
- **Recommendation:** Scope reads to the employee's own files or an explicitly authorized staff role, or serve files through an authenticated server route that checks the relevant employee/district/client relationship.
- **Mitigation:** Remove direct client reads for these paths and issue narrowly scoped short-lived access only after server-side authorization.
- **Verification note:** Existing Firebase download-token URLs can bypass Storage rules by design; this finding concerns direct authenticated Storage reads under the rules.

### API-001 — High: Anonymous employee lookup exposes PII and live attendance context

- **Rule ID:** NEXT-PRIVACY-001
- **Severity:** High / P1
- **Location:** `src/app/api/public/attendance/employee/route.ts:7`; `src/app/api/public/attendance/employee/route.ts:110`; `src/lib/attendance/public-attendance.ts:134`.
- **Evidence:** The GET route has no authentication or rate-limit check. It accepts an employee ID, phone number, or resource ID, then returns `buildPublicAttendanceEmployee`, which includes full name, employee code, phone number, client, last attendance date/status, site and duty point IDs, shift, and open-session ID.
- **Impact:** A public caller who knows or enumerates an employee identifier can obtain personal contact details and a guard's recent work location/status. Query parameters may also be retained in access logs and browser history.
- **Recommendation:** Remove this route if the newer `/api/public/attendance/identify` flow supersedes it. Otherwise require a verified proof, return only the minimum fields needed, omit phone and session/location details, rate limit by IP and identifier, and set `Cache-Control: no-store`.
- **Mitigation:** Confirm the route is not needed by legacy clients and block it at the edge if it is unused.
- **Verification note:** The route is called by `src/components/landing-page.tsx`; preserve only the specific fields that flow needs if compatibility is required.

### DEP-002 — High: Production dependency tree has a broad unresolved advisory backlog

- **Rule ID:** DEP-AUDIT-001
- **Severity:** High / P1
- **Location:** `package.json`, `package-lock.json`.
- **Evidence:** `npm audit --omit=dev` reported 13 high and 62 moderate vulnerable package entries in addition to SEC-001. Affected transitive packages include parts of the Genkit/Google Cloud/OpenTelemetry and Firebase dependency trees; several have available non-major fixes.
- **Impact:** Besides the confirmed image-decoder path, other reachable vulnerable dependencies can expose production routes to denial of service, request parsing errors, or data-integrity issues. The package report alone does not prove every transitive package is reachable in the deployed bundle.
- **Recommendation:** Upgrade direct dependencies and overrides in small groups, regenerate the lockfile, and triage each remaining high advisory against server and route usage. Add dependency-audit checks to release review.
- **Mitigation:** Keep the production dependency audit as a deployment gate and prioritize network-facing server packages first.
- **Verification note:** `npm audit` is a dependency signal, not a proof that all 77 entries are exploitable in this app.

### REG-001 — Medium: Firestore state isolation fails open when a state claim or document field is missing

- **Rule ID:** FIRESTORE-STATE-001
- **Severity:** Medium / P2, rollout-dependent
- **Location:** `firestore.rules:85`; `firestore.rules:92`.
- **Evidence:** `readStateMatches()` returns true when the caller has no `stateCode` claim or the document has no `stateCode`. `writeStateMatches()` has the same missing-claim/document-field exceptions.
- **Impact:** In a multi-state deployment, a regular user with an absent state claim can read or write documents across states. A state-scoped writer can also create untagged documents that the read rule exposes broadly.
- **Recommendation:** Before adding another state, require claims on all non-superadmin identities, stamp `stateCode` on every write, and allow legacy missing-state reads only through a temporary, explicitly scoped migration path.
- **Mitigation:** Add monitoring that rejects or reports state-scoped users without claims and records missing `stateCode` documents.
- **Verification note:** The CISS knowledge base records the live platform as Kerala-only and says no regions have been created. This is not evidence of a current cross-state incident; it is a blocker for relying on the region isolation scaffold.

## Positive controls observed

- Raw employee Aadhaar records and sensitive document subcollections are denied to browser clients in Firestore rules.
- Enrollment uploads use a draft capability, size/type validation, restricted Aadhaar storage, and no bearer download token for Aadhaar.
- Vercel Cron handlers expose GET entry points and verify a cron secret or Vercel cron signature; the configured cron paths were not found to be missing handlers.
- Firebase Admin initialization is lazy and keeps service-account credentials server-side.

## Recommended order

1. Patch Next.js and Sharp, then redeploy promptly.
2. Close the attendance identity and geofence override gaps.
3. Restrict signature and attendance-photo reads in Storage rules.
4. Remove or minimize the anonymous employee lookup response.
5. Triage the remaining production dependency advisories.
6. Close the Firestore state-scope exceptions before adding a second state.
