#!/usr/bin/env node
/**
 * Prune orphaned attendance selfies from Firebase Storage.
 *
 * Default is a DRY RUN. Pass --apply to delete. Nothing is deleted in dry-run
 * mode, and an object referenced by any Firestore document is never deleted.
 *
 * Scope: Storage objects matching `employees/<employeeDocId>/attendance/<...>`.
 * Other prefixes under employees/ (addressProofs, idProofs, signatures, …) are
 * listed for context only and never touched.
 *
 * References are collected by walking the string values of every document in
 * `attendanceLogs` and `attendanceSessions` (photoStoragePath, photoUrl, and any
 * other field carrying an `employees/…/attendance/…` path). Storage paths in
 * photoUrl are URL-encoded, so values are decoded and query strings stripped
 * before comparison. By default every other collection is scanned too — if any
 * document anywhere references the object it counts as referenced. That is
 * deliberately conservative: unreferenced means "referenced nowhere".
 *
 * Eligibility: orphan AND older than RETAIN_DAYS (365) days, by object
 * timeCreated (falling back to updated).
 *
 * Extra safety — timestamp-adjacency guard (default on, `--no-adjacency-guard`
 * to disable): older app versions uploaded selfies as
 * `employees/<docId>/attendance/<epoch-ms>_attendance.jpg` but never persisted
 * `photoStoragePath` on the attendance log. Those objects are "unreferenced" by
 * path yet are the only surviving photo evidence for an existing log. So an
 * object whose filename epoch falls within ADJACENCY_MS of any attendanceLogs
 * created/reported timestamp for the same employee is treated as referenced and
 * retained. It is reported separately as `timestamp_adjacent`.
 *
 * Safety caps: if more than 5,000 objects or more than 2 GB would be deleted,
 * the run stops and reports instead of applying. --apply only deletes; it never
 * broadens the candidate set.
 *
 * Each deleted object gets one audit document in `sensitiveDocumentAuditLogs`:
 *   { action: "orphan_attendance_photo_deleted", path, sizeBytes,
 *     timeCreated, deletedAt, reason }
 *
 * Usage:
 *   node --env-file=.env.local scripts/prune-orphan-attendance-photos.mjs
 *   node --env-file=.env.local scripts/prune-orphan-attendance-photos.mjs --apply
 *   node --env-file=.env.local scripts/prune-orphan-attendance-photos.mjs --no-extra-scan   (references from the two attendance collections only)
 */
import admin from "firebase-admin";

const APPLY = process.argv.includes("--apply");
const EXTRA_SCAN = !process.argv.includes("--no-extra-scan");

const ADJACENCY_GUARD = !process.argv.includes("--no-adjacency-guard");
/** Max delta between a selfie's filename epoch and a log timestamp to count as evidence. */
const ADJACENCY_MS = 120_000;
const RETAIN_DAYS = 365;
const MAX_OBJECTS = 5000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const DELETE_BATCH = 200; // Storage deletes per audit-batch
const AUDIT_COLLECTION = "sensitiveDocumentAuditLogs";
const ATTENDANCE_OBJECT = /^employees\/[^/]+\/attendance\/.+/;
const PATH_IN_TEXT = /employees\/[^/\s"'?#]+(?:\/[^\s"'?#]+)+/g;
const REFERENCE_COLLECTIONS = ["attendanceLogs", "attendanceSessions"];

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

/* ---------------------------------------------------------------- helpers */

/** Normalise a Storage path found in a document: decode, strip query/hash. */
function normalizeStoragePath(raw) {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;
  const queryIndex = value.search(/[?#]/);
  if (queryIndex >= 0) value = value.slice(0, queryIndex);
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw value if it is not valid percent-encoding.
  }
  return value.startsWith("employees/") ? value : null;
}

/** Walk any JSON-ish value and collect every employees/… storage path it holds. */
function collectPaths(value, sink) {
  if (value == null) return;
  if (typeof value === "string") {
    const direct = normalizeStoragePath(value);
    if (direct) sink.add(direct);
    const matches = value.match(PATH_IN_TEXT);
    if (matches) {
      for (const match of matches) {
        const normalized = normalizeStoragePath(match);
        if (normalized) sink.add(normalized);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, sink);
    return;
  }
  if (typeof value === "object") {
    // Firestore Timestamps / GeoPoints / references.
    for (const nested of Object.values(value)) collectPaths(nested, sink);
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${units[unit]}`;
}

const HUMAN_AGE_BUCKETS = [
  { label: "0-30d", min: 0, max: 30 },
  { label: "30-90d", min: 30, max: 90 },
  { label: "90-180d", min: 90, max: 180 },
  { label: "180-365d", min: 180, max: 365 },
  { label: "365-730d", min: 365, max: 730 },
  { label: "730-1095d", min: 730, max: 1095 },
  { label: ">=1095d", min: 1095, max: Infinity },
];

/* ------------------------------------------------------- storage inventory */

console.log(`mode=${APPLY ? "APPLY" : "dry-run"}`);
console.log(`bucket=${bucket.name} retain_days=${RETAIN_DAYS} caps=${MAX_OBJECTS} objects / ${formatBytes(MAX_BYTES)}`);

const [allFiles] = await bucket.getFiles({ prefix: "employees/", autoPaginate: true });
const now = Date.now();

const objects = [];
let nonAttendanceObjects = 0;
for (const file of allFiles) {
  if (!ATTENDANCE_OBJECT.test(file.name)) {
    nonAttendanceObjects += 1;
    continue;
  }
  const metadata = file.metadata ?? {};
  const sizeBytes = Number(metadata.size ?? 0) || 0;
  const createdRaw = metadata.timeCreated ?? metadata.updated ?? null;
  const createdAt = createdRaw ? new Date(createdRaw).getTime() : null;
  const ageDays = createdAt == null ? null : (now - createdAt) / 86_400_000;
  objects.push({ name: file.name, sizeBytes, createdAt, ageDays });
}

console.log(
  `storage: employees/ objects=${allFiles.length} attendance_matching=${objects.length} other_prefixes_skipped=${nonAttendanceObjects}`,
);

if (objects.length !== allFiles.length) {
  const total = objects.reduce((sum, o) => sum + o.sizeBytes, 0);
  console.log(`storage: attendance bytes=${formatBytes(total)} (${total} bytes)`);
}

/* --------------------------------------------------------------- references */

const referenced = new Map(); // path -> Set(collection)
const docsScanned = new Map();
/** employeeDocId -> sorted epoch-ms list of attendanceLogs timestamps. */
const logTimesByEmployee = new Map();

function addLogTime(employeeDocId, ms) {
  if (!employeeDocId || !Number.isFinite(ms)) return;
  const list = logTimesByEmployee.get(employeeDocId);
  if (list) list.push(ms);
  else logTimesByEmployee.set(employeeDocId, [ms]);
}

async function scanCollection(collectionId) {
  const snap = await db.collection(collectionId).get();
  let found = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const sink = new Set();
    collectPaths(data, sink);
    for (const path of sink) {
      if (!referenced.has(path)) referenced.set(path, new Set());
      referenced.get(path).add(collectionId);
      found += 1;
    }
    if (collectionId === "attendanceLogs") {
      const raw = data.createdAt ?? data.reportedAt ?? data.serverProcessedAt ?? data.locationCapturedAt;
      const ms = typeof raw?.toDate === "function" ? raw.toDate().getTime() : raw ? new Date(raw).getTime() : NaN;
      addLogTime(data.employeeDocId ?? data.employeeId, ms);
    }
  }
  docsScanned.set(collectionId, snap.size);
  return found;
}

/** Epoch-ms embedded in `employees/<docId>/attendance/<epoch>[_suffix].ext`. */
function filenameEpoch(name) {
  const rest = name.split("/attendance/")[1];
  if (!rest) return null;
  const match = rest.match(/^(\d{13})[_.]/);
  return match ? Number(match[1]) : null;
}

/**
 * Is this unreferenced object nevertheless the surviving evidence for an
 * existing attendance log (same employee, timestamp within ADJACENCY_MS)?
 */
function hasTimestampAdjacentLog(name) {
  if (!ADJACENCY_GUARD) return false;
  const epoch = filenameEpoch(name);
  if (epoch == null) return false;
  const employeeDocId = name.split("/")[1];
  const times = logTimesByEmployee.get(employeeDocId) ?? logTimesByEmployee.get(String(employeeDocId));
  if (!times) return false;
  return times.some((ms) => Math.abs(ms - epoch) <= ADJACENCY_MS);
}

for (const collectionId of REFERENCE_COLLECTIONS) {
  const found = await scanCollection(collectionId);
  console.log(`references: ${collectionId} docs=${docsScanned.get(collectionId)} paths=${found}`);
}

const extraCollections = [];
if (EXTRA_SCAN) {
  const collections = await db.listCollections();
  for (const collection of collections) {
    if (REFERENCE_COLLECTIONS.includes(collection.id)) continue;
    const before = referenced.size;
    const found = await scanCollection(collection.id);
    if (found > 0 && referenced.size > before) {
      extraCollections.push({ id: collection.id, docs: docsScanned.get(collection.id), paths: found });
    }
  }
  if (extraCollections.length) {
    console.log(
      `references: extra collections contributing attendance-photo paths: ${extraCollections
        .map((c) => `${c.id}(${c.docs} docs)`)
        .join(", ")}`,
    );
  } else {
    console.log("references: no other collection references an attendance photo path");
  }
} else {
  console.log("references: extra-collection scan disabled (--no-extra-scan)");
}

/* ----------------------------------------------------------------- classify */

const orphans = [];
const referencedObjects = [];
let adjacentRetained = 0;

for (const object of objects) {
  if (referenced.has(object.name)) {
    referencedObjects.push(object);
  } else if (hasTimestampAdjacentLog(object.name)) {
    // Unreferenced by path, but the only photo evidence for an existing log.
    adjacentRetained += 1;
  } else {
    orphans.push(object);
  }
}

const orphanBytes = orphans.reduce((sum, o) => sum + o.sizeBytes, 0);
const eligible = orphans.filter((o) => o.ageDays != null && o.ageDays > RETAIN_DAYS);
const youngOrphans = orphans.filter((o) => o.ageDays != null && o.ageDays <= RETAIN_DAYS);
const undatedOrphans = orphans.filter((o) => o.ageDays == null);
const eligibleBytes = eligible.reduce((sum, o) => sum + o.sizeBytes, 0);

const histogram = HUMAN_AGE_BUCKETS.map((bucketDef) => {
  const members = orphans.filter((o) => o.ageDays != null && o.ageDays >= bucketDef.min && o.ageDays < bucketDef.max);
  const bytes = members.reduce((sum, o) => sum + o.sizeBytes, 0);
  const eligibleMembers = members.filter((o) => o.ageDays > RETAIN_DAYS).length;
  return { ...bucketDef, count: members.length, bytes, eligible: eligibleMembers };
});

console.log("");
if (ADJACENCY_GUARD) {
  console.log(
    `guard: timestamp_adjacent_retained=${adjacentRetained} (unreferenced by path, but matching an attendanceLogs timestamp for the same employee — kept)`,
  );
}
console.log(`objects: attendance=${objects.length} referenced=${referencedObjects.length} orphans=${orphans.length} (${formatBytes(orphanBytes)} / ${orphanBytes} bytes)`);
console.log(`eligible (older than ${RETAIN_DAYS}d): ${eligible.length} (${formatBytes(eligibleBytes)} / ${eligibleBytes} bytes)`);
console.log(`retained: younger_than_retention=${youngOrphans.length} undated=${undatedOrphans.length}`);

console.log("");
console.log("orphan age histogram:");
console.log("  bucket      count   eligible   bytes");
for (const row of histogram) {
  console.log(
    `  ${row.label.padEnd(11)} ${String(row.count).padStart(5)} ${String(row.eligible).padStart(10)}   ${formatBytes(row.bytes)}`,
  );
}

if (orphans.length) {
  const sample = orphans.slice(0, 10);
  console.log("");
  console.log(`sample orphans (first ${sample.length} of ${orphans.length}):`);
  for (const o of sample) {
    const age = o.ageDays == null ? "?" : o.ageDays.toFixed(0);
    console.log(`  - ${o.name} ${formatBytes(o.sizeBytes)} age=${age}d ${o.ageDays != null && o.ageDays > RETAIN_DAYS ? "ELIGIBLE" : "retained"}`);
  }
}

/* ------------------------------------------------------------------- guards */

const overCount = eligible.length > MAX_OBJECTS;
const overBytes = eligibleBytes > MAX_BYTES;
const capped = overCount || overBytes;

if (capped) {
  console.log("");
  console.log(
    `STOPPED: deletion volume ${eligible.length} objects / ${formatBytes(eligibleBytes)} exceeds the ${MAX_OBJECTS} object or ${formatBytes(MAX_BYTES)} cap.`,
  );
  console.log(
    `Refusing to ${APPLY ? "apply" : "plan"} this volume. Review the histogram above and re-run with a tighter scope before applying.`,
  );
}

/* -------------------------------------------------------------------- apply */

let deletedCount = 0;
let deletedBytes = 0;
const failures = [];
let auditWritten = 0;

if (APPLY && !capped && eligible.length) {
  let pendingAudit = [];

  const flushAudit = async () => {
    if (!pendingAudit.length) return;
    const batch = db.batch();
    for (const record of pendingAudit) {
      batch.set(db.collection(AUDIT_COLLECTION).doc(), record);
    }
    await batch.commit();
    auditWritten += pendingAudit.length;
    pendingAudit = [];
  };

  for (const object of eligible) {
    if (referenced.has(object.name)) {
      failures.push({ path: object.name, reason: "became referenced — skipped" });
      continue;
    }
    try {
      await bucket.file(object.name).delete({ ignoreNotFound: true });
      deletedCount += 1;
      deletedBytes += object.sizeBytes;
      pendingAudit.push({
        action: "orphan_attendance_photo_deleted",
        path: object.name,
        sizeBytes: object.sizeBytes,
        timeCreated: object.createdAt == null ? null : new Date(object.createdAt),
        deletedAt: new Date(),
        reason: `unreferenced attendance selfie older than ${RETAIN_DAYS} days (age ${Math.floor(object.ageDays)}d); retention prune by scripts/prune-orphan-attendance-photos.mjs`,
      });
      if (deletedCount % 50 === 0) {
        console.log(`  deleted ${deletedCount}/${eligible.length} …`);
      }
      if (pendingAudit.length >= DELETE_BATCH) await flushAudit();
    } catch (error) {
      failures.push({ path: object.name, reason: error.message });
    }
  }

  await flushAudit();
}

/* ------------------------------------------------------------------ summary */

console.log("");
if (capped) {
  console.log("No objects were deleted.");
} else if (APPLY) {
  console.log(`Applied: deleted ${deletedCount} orphan object(s), ${formatBytes(deletedBytes)} (${deletedBytes} bytes).`);
  console.log(`Audit records written to ${AUDIT_COLLECTION}: ${auditWritten}`);
  if (failures.length) {
    console.log(`Failures: ${failures.length}`);
    for (const failure of failures.slice(0, 20)) console.log(`  - ${failure.path}: ${failure.reason}`);
  }
} else {
  console.log(`Dry run complete. ${eligible.length} object(s) / ${formatBytes(eligibleBytes)} older than ${RETAIN_DAYS} days would be deleted.`);
  console.log("Nothing was deleted. Re-run with --apply to delete eligible orphans.");
}
console.log(`Referenced objects left untouched: ${referencedObjects.length}`);
if (ADJACENCY_GUARD) console.log(`Timestamp-adjacent evidence retained: ${adjacentRetained}`);
console.log(`Orphans retained (inside retention window or undated): ${youngOrphans.length + undatedOrphans.length}`);
