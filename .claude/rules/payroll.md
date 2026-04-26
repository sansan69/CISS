---
paths:
  - "src/lib/payroll/**"
  - "src/app/(app)/payroll/**"
  - "src/app/api/admin/payroll/**"
  - "src/app/(app)/settings/wage-config/**"
  - "src/app/api/admin/clients/[id]/wage-config/**"
---

## Payroll Rules

- Wage components have types: `earning | deduction | employer_contribution`.
- Calc types: `fixed_amount | pct_of_basic | pct_of_ctc | pct_of_gross | pct_of_epf_base | balancing | kerala_slab | tds_projected`.
- Payroll run uses `employeeDoc.id` (Firestore doc ID), passed to `aggregateAttendance(employeeDocId, period, db)`.
- Payroll cycles: `payrollCycles` collection. Entries: `payrollEntries` collection.
- Wage config stored in `clientWageConfig/{clientId}` collection.
- `kerala_slab` calc type: uses Kerala Professional Tax slab rates. Lookup slab based on monthly gross.
- `tds_projected` calc type: projects annual TDS liability and divides by 12.
- `balancing` calc type: ensures total deductions match target (used for rounding adjustments).
- EPF base = basic + DA. EPF rate = 12% (employee) + 12% (employer).
- ESI rate = 0.75% (employee) + 3.25% (employer). Threshold: gross <= 21,000.
- When editing payroll logic, always read `src/lib/payroll/` files first to understand current calc flow.
- Attendance aggregation: `src/lib/payroll/attendance-aggregator.ts` handles present days, OT, leave, half-days.