# Mobile session contract

`GET /api/mobile/session` is the authoritative mobile-role check. A successful
response is unchanged: it supplies the linked guard or field-officer profile
and may repair its Firebase claims.

The endpoint now returns a neutral `401 { "error": "Unauthorized." }` when
the Firebase identity has no linked profile, or when that profile has been
deprovisioned (for example, its status is inactive, disabled, deleted,
terminated, or deprovisioned). Custom claims alone are not authorization.

Mobile clients must sign out and return to login for that 401 response. They
may retain a claims-only fallback only for genuine transient transport or 5xx
failures; falling back after an HTTP 401/403 would bypass profile
deprovisioning.
