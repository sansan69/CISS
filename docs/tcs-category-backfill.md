# Offline TCS category proposals

`scripts/plan-tcs-categories.mjs` generates a review report from **three explicitly supplied local JSON files**. It cannot read Firebase, obtain credentials, fetch a source, or apply changes. `--apply` (including `--apply=true`) fails. This is a local classification scaffold, not an approved migration or a reviewed production backfill.

```sh
node scripts/plan-tcs-categories.mjs \
  --employees /absolute/path/employees.json \
  --biometric /absolute/path/biometric-candidates.json \
  --permanent /absolute/path/permanent-deployment.json \
  --json-out /absolute/path/new-proposals.json \
  --csv-out /absolute/path/new-proposals.csv
```

All three inputs are required, including an explicit empty list when a source has no rows. The tool always prints the JSON report to stdout. Optional output files must have distinct new paths in existing directories; it refuses to replace any existing file, symlink or hard link. Case-only destination aliases (for example `report.json` and `REPORT.JSON`) are conservatively rejected before either output is created on every platform, including case-sensitive filesystems. This restriction applies only to report paths, not employee identifiers. Report files are created with owner-only permissions. Writes to the two output files are not a multi-file transaction: an unexpected disk failure may leave a partial output, which must be reviewed before use.

## Required local input schemas

Each input requires a `source` object with a nonempty `name`, a valid calendar `date` in `YYYY-MM-DD` format, and nonempty `provenance`. The date is the source's as-of date, not the time the tool ran. Provenance should identify who supplied the export/list, its original document or file, the local preparation step, and the authority claimed for it. Never include credentials in provenance. Metadata is supplied by the reviewer; this tool validates its shape, not its truth or authority.

Employee export:

```json
{
  "source": {
    "name": "Synthetic employee export",
    "date": "2026-10-13",
    "provenance": "Synthetic fixture only; not production data"
  },
  "employees": [
    { "employeeDocId": "demo-a", "employeeId": "CISS/demo-a", "clientName": "TCS" },
    { "employeeDocId": "demo-b", "employeeId": "CISS/demo-b", "clientName": "TCS", "tcsCategory": "permanent" }
  ]
}
```

The local export must include the actual Firestore document ID as `employeeDocId`, a canonical `clientName`, and the existing `tcsCategory` where present. `employeeId` is optional when sources use document IDs; include it when matching the human employee ID. Document IDs must be unique, nonempty strings without `/`. Human employee IDs may contain `/`; duplicates in the export are allowed but a list using that duplicate ID is ambiguous. Omit missing optional IDs rather than supplying null or empty strings. Other employee fields are ignored and are not copied into the report. A missing or invalid category is unclassified; only existing `adhoc` and `permanent` values count as curated categories.

Biometric candidates and permanent deployment use this envelope separately:

```json
{
  "source": {
    "name": "Synthetic permanent deployment list",
    "date": "2026-10-13",
    "provenance": "Synthetic fixture only; not an authoritative live list"
  },
  "records": [
    { "employeeDocId": "demo-a", "reference": "Original list row 1" },
    { "employeeId": "CISS/demo-b", "reference": "Original list row 2" }
  ]
}
```

`reference` is optional text locating the original row. Each list row should supply `employeeDocId`, `employeeId`, or both. A row with neither is reported as unmatched, even if it contains a name or phone. Present identifiers must be nonempty strings; malformed input fails before generating a report. Both supplied IDs must resolve uniquely to the same employee. Matches are case-sensitive and exact; IDs are never trimmed, reformatted, or inferred from a name, phone or Firebase Auth UID.

## Classification and review rules

- An employee uniquely listed in the permanent source is a `permanent` candidate. That source takes precedence over a biometric candidate for the same employee.
- An employee uniquely listed only in the biometric source is an `adhoc` candidate. This is a proposal requiring source-authority review: the current biometric list may contain permanent guards, and absence from an incomplete permanent list does not establish that someone is Adhoc.
- Existing valid categories are preserved. Agreement is reported under `preserved`; disagreement is a `curated_category_conflict` under `conflicting`, with no row in `proposals`.
- Non-TCS matches are reported as `non_tcs_employee` conflicts and receive no proposal. TCS uses the same trimmed, case-insensitive canonical client-name check as the application; employee IDs remain exact.
- Ambiguous identities, contradictory supplied IDs and duplicate matches within either source block proposals for all employees implicated in those rows, even if a later row or the other source matches them. Two lists containing the same unique employee are normal precedence evidence, not duplicates within one source.
- Unlisted employees remain unchanged. No rule classifies everyone else, and no default is applied to legacy records. The application's separate default for **new** TCS enrollments is `adhoc`; it does not authorize a legacy backfill.

The deterministic JSON report contains `schemaVersion`, `mode`, a `sources` metadata manifest, `proposals`, `preserved`, `unmatched`, `ambiguous`, `conflicting`, and `summary`. Source record indexes are zero-based. Rows retain only exact identity fields and optional source references; names and phones are not included. The CSV combines the same report groups with a `status` column, JSON-encoded candidate IDs/evidence, and escaped quotes/newlines. Spreadsheet-formula prefixes are neutralized with an apostrophe. Keep the JSON report with the CSV: the JSON manifest carries the authoritative supplied date/provenance metadata and summary. JSON preserves original IDs exactly; CSV apostrophes are presentation escaping, not altered employee identifiers. The report does not include a generated timestamp so identical inputs produce identical output.

Exit status `0` means valid inputs were processed, **not** that all rows are resolved or approved. Review the unmatched, ambiguous and conflicting groups and verify source completeness/authority separately. Invalid input, unsupported options, apply requests and unsafe output paths return a nonzero status without printing a proposal report.

## Local verification and remaining prerequisites

Run the executable fixture suite:

```sh
npm test -- scripts/plan-tcs-categories.test.mjs
npx eslint scripts/plan-tcs-categories.mjs scripts/plan-tcs-categories.test.mjs
node --check scripts/plan-tcs-categories.mjs
npm run typecheck
```

The fixtures are synthetic and invoke the real CLI with temporary local files. They verify permanent precedence, unchanged unlisted employees, curated categories, exact and conflicting IDs, duplicate source matches, non-TCS rejection, malformed source/date/identity input, stable JSON, escaped CSV, apply rejection and protection against overwriting inputs through direct paths, symlinks and hard links.

No real biometric, permanent-deployment, payroll or employee dataset has been reviewed or processed as part of this scaffold. Before any future migration, obtain current authoritative source lists, settle the biometric/permanent authority overlap, review a real proposed diff and obtain explicit import authorization. A future writer must be separately designed and reviewed; this tool has no apply mode to unlock.
