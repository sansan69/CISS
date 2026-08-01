# Firebase Aadhaar Security Audit and Remediation — 1 August 2026

## Outcome

The live Firebase project `ciss-workforce` was audited and remediated. Legacy Aadhaar numbers and Aadhaar-copy references were removed from broadly readable employee documents. Aadhaar numbers are now envelope-encrypted with a managed Cloud KMS key, and Aadhaar copies are stored in a server-only, tokenless Storage path.

This is a technical security and data-handling assessment, not a legal certification of compliance with the Aadhaar Act, DPDP Act, EPF/ESIC rules, or any other law.

No Aadhaar number, employee name, document URL, access token, credential, or storage object path is included in this report.

## Final production verification

The final aggregate audit completed at `2026-08-01T10:15:42Z`:

| Check | Result |
| --- | ---: |
| Employee records audited | 1,766 |
| Legacy/grandfathered policies | 1,765 |
| `three-proof-v1` policies | 1 |
| Records missing an enrollment policy | 0 |
| Employee records containing plaintext Aadhaar data | 0 |
| Employee records containing Aadhaar file URLs | 0 |
| Private Aadhaar records | 1,442 |
| Private records with encrypted Aadhaar numbers | 1,435 |
| Private records with restricted Aadhaar copies | 1,429 |
| Fully complete private Aadhaar records | 1,424 |
| Incomplete legacy private records | 18 |
| Private records left in migration-pending state | 0 |
| Restricted Aadhaar files | 2,780 |
| Restricted files with permanent download tokens | 0 |
| Restricted files without `Cache-Control: no-store` | 0 |
| Referenced restricted files missing from Storage | 0 |
| Unreferenced restricted files | 0 |
| Sensitive audit events recorded | 1,719 |

The 18 incomplete private records and 342 employees whose Aadhaar status is missing are grandfathered legacy cases. They remain operational and receive the optional missing-document workflow. No data was fabricated to mark these records complete.

## Remediation applied

### Restricted data model

- Migrated legacy Aadhaar data from `employees/{employeeDocId}` to `employeeAadhaarPrivate/{employeeDocId}`.
- Removed dedicated Aadhaar fields and Aadhaar-labelled identity/address proof fields from employee records after verifying the private record.
- Left only non-sensitive completion status in employee records.
- Preserved legacy enrollment status for the 1,765 employees present at the initial audit.
- Classified the subsequently created employee under `three-proof-v1`; no record is now missing a policy.

### Encryption and file protection

- Created `projects/ciss-workforce/locations/asia-south1/keyRings/ciss-sensitive/cryptoKeys/aadhaar`.
- Enabled 90-day automatic KMS key rotation.
- Granted only the runtime service account KMS encrypt/decrypt permission at the key scope.
- Envelope-encrypted each available 12-digit Aadhaar number and verified decryption before removing plaintext.
- Moved recoverable Aadhaar copies into `restrictedEmployeeAadhaar/{employeeDocId}/...`.
- Removed permanent Firebase download tokens and applied `no-store, private, max-age=0` metadata.
- Recovered 274 historical Aadhaar document sets from legacy identity/address folders.
- Thirteen historical references pointed to files that no longer existed; these records remain missing and are offered the optional upload action.
- Removed four duplicate, unreferenced restricted files created during migration retries.

### Authorization and platform controls

- Firestore and Storage rules deny every direct client read/write to private Aadhaar, consent, audit, correction, restricted and staging paths.
- Server-side Aadhaar access requires the exact verified account `admin@cisskerala.app`, a valid non-revoked Firebase token, and the admin role/claim.
- Firebase Auth verification confirmed that account is enabled, email-verified, and has the admin claim and role.
- Firestore deletion protection is enabled.
- Point-in-time recovery is enabled with a seven-day retention period.
- Aadhaar reveal/view, submission, replacement, correction, migration and cleanup operations write audit records without Aadhaar values or file URLs.
- Replacement and deletion remove every employee-scoped restricted Aadhaar copy, including migrated front/back `additionalDocuments` entries.

## Legacy handling

- Missing documents do not convert a legacy employee to `three-proof-v1`.
- Attendance, payroll, deployment and profile access remain unaffected for grandfathered employees.
- Missing Aadhaar, identity, or address categories are presented as optional completion actions.
- Guards can submit missing Aadhaar with ESIC/EPF-purpose consent, but the API returns status only and never returns the Aadhaar number, last four digits, copy, or storage path.
- Admin-added Aadhaar requires an existing guard consent record or an uploaded signed consent form.

## New-enrollment enforcement

- New enrollment defaults and server validation require Aadhaar number, Aadhaar copy, ESIC/EPF-purpose consent, terms acceptance, identity proof, a different address proof, signature and the configured profile/document references.
- The protected fields remain mandatory even if a remote enrollment configuration attempts to disable them or mark them optional.
- The enrollment API verifies that each required file exists in the enrollment's own Firebase Storage folder. External URLs, fabricated paths and files from another draft/employee folder are rejected.
- These requirements apply only to new enrollments; grandfathered employees retain the legacy policy and optional missing-document completion workflow.

## Repeatable controls

- `npm run aadhaar:audit-security` performs the aggregate, non-PII database and Storage audit.
- `npm run aadhaar:migrate` provides a migration dry run.
- `npm run aadhaar:repair-legacy-documents -- --read-time=<ISO>` audits historical file recovery.
- `npm run aadhaar:reconcile-security` detects missing policies and orphan restricted files without changing data unless `--apply` is supplied.

## Verification performed

- Live Firebase MCP checks of Firebase Auth, Firestore configuration, Firestore Rules and Storage Rules.
- Post-migration aggregate database and Storage audit.
- TypeScript typecheck passed.
- Production Next.js build completed successfully.
- ESLint passed.
- 32 focused authorization, cleanup, enrollment, document-reference, rule-configuration and enrollment-schema tests passed.
- All temporary migration credentials were revoked after their individual operations.

## Operational follow-up

The application deployment environment must contain the exact `AADHAAR_KMS_KEY_NAME` used above before the new Aadhaar upload, reveal or document-streaming routes are deployed. Local environment configuration is present; this audit does not claim that an external hosting provider's environment has been updated or that the current local application changes have been deployed there.
