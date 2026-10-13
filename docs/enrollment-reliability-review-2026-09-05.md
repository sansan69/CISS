# Enrollment reliability review — 5 September 2026

## Findings

The user reports repeated LNG guard-registration errors. The exact error/affected guard has not yet been supplied, so the specific reported attempt is not conclusively diagnosed.

Read-only production checks: `/api/health`, `/api/public/clients`, and `/api/public/enrollment-config` return HTTP 200. Firebase Admin can read Firestore and Storage metadata. LNG is enabled with the expected profile and client overrides. Live data contains 1,864 employees, including 167 LNG employees; the latest LNG record is the previously documented synthetic Lady Security Guard test from 4 September. No unfinished draft records were present at inspection; scheduled cleanup means their absence does not establish that no attempts failed. The available production 500-log query returned no entries.

The previously identified LNG `qualificationName: undefined` final-save defect is already fixed in HEAD and was previously deployed. This review does not claim that defect has recurred.

## Local fixes prepared

- Reject PDFs above 4 MB at selection and prepared uploads above 4 MB before sending. Previously the form allowed 5 MB PDFs and 15 MB image fallbacks through an endpoint hosted behind Vercel's 4.5 MB request limit. Large images remain selectable for compression; an unsuccessful reduction now gives a clear smaller-file/JPEG instruction. Source: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions
- Return a completed public registration's original receipt when retried with its matching secret. Keep a completion-token hash and protect draft finalization with a Firestore version precondition.
- Serialize concurrent enrollment phone/email checks using hashed reusable lock documents and atomic batch preconditions. Existing employee checks remain in place; locks can advance after HR changes a contact value. No existing employee records need migration.
- Preserve restricted documents on uncertain database commits, and stop the staff form deleting uploads on failures. Reconcile a completed public draft before reporting a commit error.
- Classify transient database errors as retryable service failures and allow 60 seconds for secure finalization. Check independent document references concurrently.
- Display configuration errors and map API document-reference field names to their visible form controls, including LNG service book, arms license and PAN uploads. Public server-validation errors navigate to the affected step.
- Include LNG PAN requirements in step validation, clear removed optional file references on retry, and prevent browser draft-storage cleanup errors from changing successful registration into a failure.
- Increment upload counters atomically and return an explicit 413 for an oversized prepared upload.

## Verification and limits

All seven LNG designations pass API regression tests, including conditional service-book and arms-license attachments, LNG aliases and optional-field omission. Tests also cover authenticated receipt retries, wrong-token rejection, commit failures without document deletion, file-size limits and visible-field mapping. Full suite: 81 files / 462 tests passed. TypeScript, ESLint and whitespace checks passed; production build passed before the final small refinements and is being repeated for the final source.

This is a local code repair. No production registration, database migration, Storage deletion, deployment or client-availability change was performed. New concurrency locks are created by future successful registrations after deployment. Other code paths that create or edit employees do not participate in these enrollment locks. Existing pre-fix completed drafts have no receipt token and cannot gain retry recovery retrospectively.

Before claiming the reported LNG incident resolved, obtain the exact error or affected guard and verify the corrected flow after an authorized production deployment. Keep existing unrelated workspace changes out of that rollout. Production deployment requires explicit authorization under the deployment skill.
