# Guard attendance Firestore index fix ledger

Scope: backend worktree only. No deploy, commit, push, or live-system changes.

## Focused diff

- Added one composite index for the `attendanceLogs` collection query: `district ASCENDING`, `attendanceDate ASCENDING`, `__name__ ASCENDING`, collection scope.
- Added `src/lib/attendance/guard-attendance-index.test.ts` to require this exact index descriptor in `firestore.indexes.json`.

## Regression result before the index change (red)

Command: `npx vitest run src/lib/attendance/guard-attendance-index.test.ts`

```text
FAIL src/lib/attendance/guard-attendance-index.test.ts > defines the composite index required by guard attendance range queries
AssertionError: expected false to be true
Test Files  1 failed (1)
Tests       1 failed
```

## Focused result after the index change (green)

Command: `npx vitest run src/lib/attendance/guard-attendance-index.test.ts src/app/api/field-officer/guard-attendance/range/route.test.ts`

```text
Test Files  2 passed (2)
Tests       4 passed (4)
```

## Standalone Firestore REST create-index request body

Submit to the attendanceLogs collection-group indexes endpoint only when explicitly authorized. This is the request body (no resource name or collectionGroup field):

```json
{
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "district", "order": "ASCENDING" },
    { "fieldPath": "attendanceDate", "order": "ASCENDING" },
    { "fieldPath": "__name__", "order": "ASCENDING" }
  ]
}
```

## Authorized production application — 2026-10-15

User explicitly approved creation of this single index. Targeted Firestore Admin REST creation applied only the reviewed attendanceLogs index; no broad deployment or data-record writes. Index ID: CICAgPiQxIgK. Firestore state verified READY. DeepSeek high review: no actionable defects. Fresh focused check: 4 tests pass. Physical Pixel retry attempted; concurrent phone navigation prevented a reliable final history-screen observation. Awaiting uninterrupted History view for final device verification.
