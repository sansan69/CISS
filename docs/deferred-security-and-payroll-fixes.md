# Deferred security and payroll fixes

These items were intentionally left unchanged during the July 2026 remediation
and should remain visible in the product backlog.

## Enrollment approval workflow

Public enrollment currently creates an employee with `Active` status
immediately. A future change should introduce `Pending Review`, admin approval
or rejection, document-review history, and notifications before the guard can
use protected guard features.

## Signed QR identity

Guard QR codes currently carry a stable employee identifier. A future change
should use a server-signed, versioned QR payload with key rotation and a
transition period for previously printed cards.

## Payroll expression engine

Payroll formula/expression handling needs a separate redesign. The future
implementation should use a restricted expression parser, typed variables,
formula versioning, validation, preview calculations, audit history, and
regression fixtures before it is used for final payroll.
