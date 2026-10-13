# Guard PIN-status contract

`POST /api/guard/auth/pin-status` is an unauthenticated, rate-limited endpoint
that validates input but intentionally does not reveal employee existence or
PIN state. It does not return employee names, employee IDs, `found`, or
`hasPin`.

Clients must not use this endpoint to choose a sign-in or setup screen. They
should offer both paths locally:

- Sign in submits the identifier and PIN to the existing login endpoint.
- First-time setup submits the identifier, date of birth, and new PIN to the
  existing setup endpoint.

This is a required mobile-client migration: remove the PIN-status preflight and
present the existing explicit setup action instead. The same-repository web
guard login already follows this pattern. The endpoint applies fail-closed,
distributed limits by client IP and every supplied one-way identifier
fingerprint. Ordinary formatting and Indian `+91`/`0091` prefixes are accepted
and canonicalized to the stored national number; other characters are rejected.
