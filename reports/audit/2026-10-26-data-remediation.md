# Data remediation — 2026-10-26 (missing site coordinates · orphan attendance selfies)

**Date:** 2026-10-26 (IST)
**Project:** `ciss-workforce` — Firestore `(default)`, Storage `ciss-workforce.firebasestorage.app`
**Executor:** data-jobs (shared task `task-7`)
**Authorization:** owner-authorized remediation; only two scripts written, both dry-run by default, `--apply` to write. No product source, rules, indexes or deployments were touched.
**Scripts:**
- [`scripts/geocode-missing-sites.mjs`](../scripts/geocode-missing-sites.mjs) — dry-run default, `--apply`
- [`scripts/prune-orphan-attendance-photos.mjs`](../scripts/prune-orphan-attendance-photos.mjs) — dry-run default, `--apply`

**Result in one line:** 6 of 17 coordinate-less sites were geocoded and written (conf ≥ 7, inside the Kerala box); 11 went to manual review. Of 7,257 attendance selfies, 1,930 are referenced, 1,569 more are timestamp-adjacent evidence and protected, leaving 3,758 true orphans (293.00 MB) of which **1** is older than 365 days — that one was deleted with an audit record.

---

## 1. Job A — sites missing coordinates

### 1.1 Scope (dry run)

```
mode=dry-run
sites=180 with_coordinates=163 missing_coordinates=17 latString_convention=true
policy: confidence>=7, kerala_bbox lat 8-12.9 lng 74.5-77.5, 1 req/s
```

Selection = no coordinate in any shape the app understands (`latitude`/`longitude`, `geolocation` as GeoPoint or plain `{lat,lng}`, or numeric `latString`/`lngString`). The 18th coordinate-less-looking document, `demo-showcase-kl-site`, was skipped because it already carries `geolocation {lat, lng}` — see §4.2.

### 1.2 Dry-run vs applied

Identical in both runs (the apply pass re-geocodes and re-checks every site, then re-reads each document immediately before writing):

| Outcome | Dry run | Applied |
|---|---|---|
| accepted (conf ≥ 7, inside Kerala) | 6 | **6 written** |
| low confidence (< 7) | 6 | 6 → manual review |
| outside Kerala bbox | 0 | 0 |
| unresolved (no usable result) | 5 | 5 → manual review |
| provider/network errors | 0 | 0 |
| skipped at write time (coordinate appeared concurrently) | — | 0 |

`with_coordinates` went 163 → 169; missing went 17 → 11.

### 1.3 Written sites (all six reverse-geocoded to confirm)

Each coordinate was reverse-geocoded after the write; the match column compares the reverse result with the site name/district on the document.

| Site doc id | Site | District | Conf | Written coordinate | Reverse-geocode check |
|---|---|---|---|---|---|
| `4BsEmbJLo5wxyNPqanVV` | College of Engineering Trikaripur | Kasaragod | 9 | 12.243608, 75.235855 | **exact** — "College of engineering trikaripur", Cheemeni, Hosdurg |
| `4YtcBlmfRVECVaDeqWNc` | Mookambika Technical Campus | Ernakulam | 10 | 9.930848, 76.552952 | **exact** — campus name, Mannathoor 686667, Muvattupuzha |
| `8Le6nIBhCxnRsWGfV774` | Kristu Jyoti College of Management and Technology | Kottayam | 10 | 9.461881, 76.546981 | Changanassery **686104**, Kurishummoodu — postcode matches; point lands ~1 km from campus |
| `jloOVesujKIsvm86MK9r` | Muslim Association College of Engineering | Thiruvananthapuram | 9 | 8.697192, 76.914581 | **exact** — "Muslim Association College of Engineering", MC Road, Keezhayikonam 695606, Nedumangad (resolved via the `siteName` fallback; see §4.3) |
| `kC8PB1vsafqwOHCI7WxT` | College Of Engineering & Management Punnapra | Alappuzha | 7 | 9.461700, 76.338200 | Alappuzha 688001, Ambalappuzha — town/neighbourhood level, ~3 km from Punnapra |
| `wj8lh0G6GxD45JLzFuK4` | College of Engineering Munnar | Idukki | 7 | 10.088700, 77.062700 | Munnar Bazaar **685612** — postcode matches |

Fields written (read back and verified on all six):

```
latitude: 12.2436076          longitude: 75.2358552
geolocation: GeoPoint(12.243608, 75.235855)
latString: "12.243608"        lngString: "75.235855"
coordinateStatus: "geocoded"  coordinateSource: "geocode"
placeAccuracy: "OpenCage confidence 9/10"
geocodeSource: "opencage"     geocodeConfidence: 9
geocodedAt / updatedAt: 2026-10-26T15:06:37Z
```

Two deliberate additions beyond the literal field list, both additive and documented here:

- **`geolocation` GeoPoint.** The task named `latitude`/`longitude` + strings. `geolocation` is the field the attendance geofence actually reads (`src/app/api/attendance/validate/route.ts`, `submit/route.ts`), and without it these sites still could not take attendance. No existing coordinate existed on any of the 17, so nothing was overwritten.
- **`coordinateStatus` / `coordinateSource` / `placeAccuracy`.** Written so `classifySiteGpsState()` in `src/lib/site-gps-repair.ts` sees these sites as healthy rather than `missing_coords`. Without them the next GPS-repair pass would re-geocode the just-fixed sites.

### 1.4 Left for manual review (11)

| Site doc id | Site | District | Reason | Best candidate seen |
|---|---|---|---|---|
| `XIFlHW7512feCA6k0Ad8` | Sabari Vidhyashram Hr. Sec. School | Puducherry | unresolved | none |
| `cU6I7HjUsCRDxuCVmTYs` | Rajiv Gandhi College of Engineering and Technology | Puducherry | unresolved | none |
| `qS1NLjdp0MW7Nv4R75oU` | Sri Manakula Vinayagar Engineering College | Puducherry | unresolved | none |
| `vih4giVZmiqTwOmOXt9D` | Sri Venkateshwara College of Engineering and Technology | Puducherry | unresolved | none |
| `AdJxFed8FtLMMkOPWCct` | iON Digital Zone IDZ Trichy II | Tiruchirappalli | unresolved — **no `siteAddress` on the document** | none |
| `I8y1louI6ydBULdN8l40` | P.A. Aziz College of Engineering & Technology | Thiruvananthapuram | low confidence | 8.4855, 76.9492 (conf 4 — region level) |
| `o5Jy4ZCgkY0G2V3EWdTW` | iON Digital Zone Kanjiramkulam | Thiruvananthapuram | low confidence | 8.4855, 76.9492 (conf 4 — region level) |
| `og6n3JeoCACLuEgPzV1N` | G20 EDU HUB | Thiruvananthapuram | low confidence | 8.4855, 76.9492 (conf 4 — region level) |
| `7lPFIusSaTleVSLy5Zwo` | Edumorgan Digi Test Hub | Ernakulam | low confidence | 10.0000, 76.5000 (conf 1 — country centroid) |
| `PwK2CGoDNED5ZzU7iRQs` | iON Digital Zone iDZ Aluva | Ernakulam | low confidence | 10.0000, 76.5000 (conf 1 — country centroid) |
| `wL8IzIcuqd9zbcRjUX0Q` | KMCT College of Engineering | Kozhikode | low confidence | 11.5000, 76.0000 (conf 1 — country centroid) |

Two clear groups, and no coordinate was written for either:

1. **Five sites are outside Kerala** (4 × Puducherry, 1 × Tiruchirappalli, plus the four Puducherry ones above are the same group). The policy appends `"Kerala, India"` to every query and accepts only the Kerala bounding box, so these correctly resolve to nothing. They are legitimate non-Kerala sites and need a manual coordinate or a policy decision to allow the Puducherry/Tamil Nadu box.
2. **Six Kerala sites geocoded only to a state or country centroid** (confidence 1–4). These need a human-entered coordinate; the OpenCage confidence floor did its job.

Suggested manual path for all 11: the admin UI site editor (`coordinateStatus: "verified"` / `coordinateSource: "manual"`) or a corrected `siteAddress`.

---

## 2. Job B — orphan attendance selfies

### 2.1 Inventory and reference resolution (dry run)

```
mode=dry-run
bucket=ciss-workforce.firebasestorage.app retain_days=365 caps=5000 objects / 2.00 GB
storage: employees/ objects=15260 attendance_matching=7257 other_prefixes_skipped=8003
storage: attendance bytes=560.04 MB (587248770 bytes)
references: attendanceLogs docs=3564 paths=1930
references: attendanceSessions docs=1701 paths=0
references: extra collections contributing attendance-photo paths: employeeDocumentRepairRuns(1 docs), employees(1961 docs)
guard: timestamp_adjacent_retained=1569
objects: attendance=7257 referenced=1930 orphans=3758 (293.00 MB / 307230930 bytes)
```

- `employees/` holds 15,260 objects; 7,257 match `employees/<employeeDocId>/attendance/<…>`; the other 8,003 are `addressProofs`, `idProofs`, `signatures`, etc. and are **out of scope by prefix** — never listed as candidates.
- Reference set: 3,564 `attendanceLogs` documents yield 1,930 distinct `photoStoragePath` values (the other 1,634 logs have no `photoStoragePath` — an earlier schema, see §4.3). `attendanceSessions` (1,701 docs) carries no photo field at all, so it contributes 0 — it is still scanned on every run in case that changes.
- Photo URLs are percent-encoded (`photoUrl` embeds `encodeURIComponent(path)`), so values are decoded and query strings stripped before comparison.
- The script additionally scans **all 47 collections** for any string containing an `employees/…/attendance/…` path. Two extra collections reference photos (`employees` documents, and one repair-run record) — those references are honoured. Without that scan, objects referenced only from those documents would have been misclassified as orphans.

### 2.2 Orphan age histogram (true orphans only, after the guard)

| Age bucket | Orphans | Of which eligible (> 365 d) | Bytes |
|---|---|---|---|
| 0–30 d | 881 | 0 | 67.34 MB |
| 30–90 d | 1,978 | 0 | 159.91 MB |
| 90–180 d | 865 | 0 | 63.59 MB |
| 180–365 d | 33 | 0 | 2.03 MB |
| **365–730 d** | **1** | **1** | **132.17 KB** |
| 730–1,095 d | 0 | 0 | 0 B |
| ≥ 1,095 d | 0 | 0 | 0 B |
| **Total** | **3,758** | **1** | **293.00 MB** |

Both safety caps were far from binding (1 vs 5,000 objects; 135,343 B vs 2 GiB), so the run proceeded to apply.

### 2.3 Applied

```
Applied: deleted 1 orphan object(s), 132.17 KB (135343 bytes).
Audit records written to sensitiveDocumentAuditLogs: 1
Referenced objects left untouched: 1930
Timestamp-adjacent evidence retained: 1569
Orphans retained (inside retention window or undated): 3757
```

The single deleted object: `employees/8129625873/attendance/1759306081981_attendance.jpg`, 135,343 bytes, created 2025-10-01, age 390 days. Before deleting it was checked three ways — path not in the reference set, a brute-force substring search of **every document in all 47 collections** for the raw and URL-encoded path returned 0 hits, and employee `8129625873` has **zero** `attendanceLogs`. Its absence was confirmed afterwards (`exists = false`).

Audit document `sensitiveDocumentAuditLogs/L9MJjJKDubh2gNQnYh1t`, exactly the six required fields:

```json
{
  "action": "orphan_attendance_photo_deleted",
  "path": "employees/8129625873/attendance/1759306081981_attendance.jpg",
  "sizeBytes": 135343,
  "timeCreated": "2025-10-01T08:08:04.203Z",
  "deletedAt": "2026-10-26T15:09:05.192Z",
  "reason": "unreferenced attendance selfie older than 365 days (age 390d); retention prune by scripts/prune-orphan-attendance-photos.mjs"
}
```

Attendance-prefixed objects went 7,257 → 7,256.

### 2.4 Integrity re-check after the apply

- Referenced paths: 1,930 — **missing from Storage: 0**. No referenced object was deleted.
- The 1,569 timestamp-adjacent objects and 3,757 in-window orphans are untouched.

---

## 3. Efficiency / safety summary

| Requirement | Job A | Job B |
|---|---|---|
| dry-run by default | yes (`--apply` to write) | yes (`--apply` to delete) |
| show dry run before apply | done, output reproduced above | done, output reproduced above |
| rate limit 1 req/s | 1 call/s (`REQUEST_INTERVAL_MS = 1000`) | n/a |
| confidence ≥ 7 + Kerala bbox | enforced on every candidate | n/a |
| never overwrite existing coordinate | skip + re-read immediately before write | n/a |
| never delete a referenced object | n/a | path reference, URL-decode, cross-collection scan, and timestamp-adjacency guard |
| batch size | 300 doc writes/commit | 200 Storage deletes + 200 audit docs |
| volume caps | n/a | stops and reports at > 5,000 objects or > 2 GiB |

---

## 4. Limitations and things left open

1. **The retention window, not the orphan count, drove Job B.** Only 1 object is older than 365 days, because the bucket's population is young: 5,244 of the 7,257 attendance objects were created in the last 180 days. The 3,757 in-window orphans (293 MB) become deletable on a rolling basis — roughly 1,978 objects around 2026-12 onward and the rest through 2027. Re-run the script periodically rather than expecting a large one-off reclaim.
2. **`demo-showcase-kl-site` has a non-GeoPoint `geolocation`.** It stores `{lat: 9.9821, lng: 76.2769}` as a plain map, not a `GeoPoint`, and has no top-level `latitude`/`longitude`. Code that reads `geolocation.latitude` therefore sees `undefined` — its geofence would not work. It was skipped by Job A as "already has coordinates" and is **not** fixed (demo document, out of scope). Worth normalising if that demo is ever shown to a client.
3. **1,634 `attendanceLogs` have no `photoStoragePath`.** The selfie exists in Storage under the old `{epoch-ms}_attendance.jpg` naming but the log never persisted the path, so the photo is unreachable from the UI. This is a pre-existing data-loss-in-logging issue, not something these scripts caused or fixed. Suggested follow-up: backfill `photoStoragePath` by matching the log's `createdAt` to the object's filename epoch (that is exactly the heuristic in §4.4).
4. **The timestamp-adjacency guard is deliberately conservative and lossy in both directions.** It keeps 1,569 legacy-named objects that no document references but that sit within ±120 s of a real log for the same employee. It still leaves **853 legacy-named objects (65.58 MB) unreferenced and unmatched** — their log was probably deleted or their employee id differs from the Storage folder id. Those become eligible in the 365-day window during 2027. I recommend an explicit decision (backfill, or archive-then-delete) before then rather than letting the retention rule remove them silently. `--no-adjacency-guard` exists but should not be used without that decision.
5. **`jloOVesujKIsvm86MK9r` has a wrong `siteAddress`** — it carries an Amravati (Maharashtra) school address on a Thiruvananthapuram site. The coordinate in §1.3 came from the `siteName` fallback and reverse-geocodes exactly to the right campus, but the address field itself should be corrected in the admin UI; a future geocode that trusts the address would drift to Maharashtra.
6. **Two of the six writes are neighbourhood-level.** `kC8PB1vsafqwOHCI7WxT` (conf 7, ~3 km from Punnapra) and `8Le6nIBhCxnRsWGfV774` (conf 10 but the point lands on a neighbouring school ~1 km away) pass the stated policy and are inside the right town/postcode. If 150 m geofencing matters for these two, replace them with a hand-placed coordinate and set `coordinateStatus: "verified"`.
7. **Apply re-queries OpenCage.** The script recomputes rather than replaying dry-run results, so a site could in principle drop out between runs (it did not: 6/6 matched). Only 6 of the 9 OpenCage calls per site were needed; the daily/free quota is not a factor here.
8. **Site writes do not carry the app's audit trail.** The scripts write coordinates but not `auditTrail` / `updatedBy` — the admin-route equivalent (`src/app/api/admin/sites/batch-geocode/route.ts`) adds `auditTrail` entries because it has a signed-in admin `uid`. There is no `uid` in an ADC script, so `geocodeSource`/`geocodedAt` are the provenance record. If a full auditTrail is required, the same 11 remaining sites can be finished through the admin batch-geocode UI, which writes it.
9. **Live-system drift.** The platform is in use: between the first and second dry run (≈10 minutes) one attendance log and one photo appeared, shifting counts by one. All figures above are labelled with the run they came from; the apply run's own counts are the authoritative ones.
10. **Not done:** no `work-log.md` / knowledge-base update (that lives in the SANJAY BACKUP workspace and is outside this task's write scope), no Firestore rules or index change, no deployment, no product-source edit.

---

## 5. Reproduce

```bash
cd /Users/mymac/Documents/CISS

# Job A — dry run, then apply
node --env-file=.env.local scripts/geocode-missing-sites.mjs
node --env-file=.env.local scripts/geocode-missing-sites.mjs --apply

# Job B — dry run, then apply
node --env-file=.env.local scripts/prune-orphan-attendance-photos.mjs
node --env-file=.env.local scripts/prune-orphan-attendance-photos.mjs --apply

# Job B — references from the two attendance collections only (not recommended)
node --env-file=.env.local scripts/prune-orphan-attendance-photos.mjs --no-extra-scan
```

Optional flags: Job A `--limit=N`, `--only=<siteDocId>`; Job B `--no-adjacency-guard`.
