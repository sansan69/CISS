# Privacy and retention implementation register

This is an engineering register, not the company's approved public privacy notice.
The office must approve retention, legal holds, access, rights-request handling and
processor settings before enabling destructive expiry in production.

| Data | Implemented handling | Retention / outstanding action |
| --- | --- | --- |
| Employee access audits | Server-generated actor UID, employee document ID, action and timestamp after role/district authorization; no copied profile fields | `expiresAt` defaults to 366 days after access. TTL is excluded from routine Firestore indexes and kept in the explicit opt-in deployment configuration. No TTL deployment has been run. |
| Attendance and reports in mobile outbox | Encrypted Hive store using existing key, retained until acknowledged; permanent server rejects remain reviewable | No silent retry/capacity eviction. Officer recovery is required for rejects; no auto-deletion introduced. |
| Duty willingness | Separate encrypted owner/origin-scoped spool, local coalescing with server CAS | Pending/conflict rows retained; saved receipt history bounded to 100. |
| Analytics | Event stages, aggregate counts and reason codes | No explicit names, IDs, phone numbers, photos, GPS or token payloads. Confirm Analytics console retention and privacy disclosures before production activation. |
| Crash reports | Reason-code nonfatals; pre-existing fatal reporting retained | Confirm Crashlytics processor/console retention and existing fatal-error payloads. |
| freeRASP | Advisory root/debugger/hook flags; disabled until configured with real certificate/report email | Vendor processing and watcher recipient must be approved/configured; no enforcement or trusted verdict asserted. |
| Raw tracking, payroll and employee documents | Existing collections and policy unchanged | No migration or deletion of attendance, wages, photos or employee records is part of this change. |

The 366-day audit default is a conservative preparation for the final DPDP Rules,
not a claim that every retention obligation is satisfied. Rule 6(1)(e) addresses
retention of relevant security logs/data for one year, and Rule 8(3) addresses a
minimum one-year processing-log period for its specified purposes. Rule 1(4)
provides staggered commencement for these rules. Applicability and other legal
retention duties must be confirmed by the company's adviser before deployment.
Source: [MeitY official final DPDP Rules, 13 November 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).

Firestore TTL is asynchronous; a timestamp alone does not erase data. After the
office approves audit expiry and resolves any legal hold/archive requirements,
an operator can explicitly deploy the full index set with the audit TTL enabled:

```sh
npx firebase-tools@15.34.0 deploy --only firestore:indexes --config firebase.audit-ttl.json
```

Ordinary deploys use `firebase.json` and do not enable employee audit expiry.
Collection writes use Admin SDK only; client access remains denied by default
rules. There is no new client bypass for audit creation, reading or mutation.
