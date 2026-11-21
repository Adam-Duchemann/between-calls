# Look busy

Event types have an optional `metadata.lookBusy` policy. Absence or `{ "mode": "off" }` preserves genuine availability. The Limits screen supports:

- `{ "mode": "day", "count": 3 }`: up to three choices per schedule-local day.
- `{ "mode": "week", "count": 10 }`: up to ten choices across Monday–Sunday, with empty days allowed.
- `{ "mode": "percentage", "percentage": 66 }`: hide about 66% per day, keeping one choice when any remain. Presets are 10, 20, 33 and 66.

Counts are offered choices, independent of booking-frequency limits. Real bookings, provider conflicts, notice, buffers and schedule rules still apply. Hidden choices never create provider calendar events.

## Selection and persistence

The policy is saved through Cal.diy's existing event-type update endpoint and PostgreSQL JSON metadata. The private seed is the installation's persistent `NEXTAUTH_SECRET`. Keep this secret stable and backed up with the deployment configuration; rotating it changes the choices, as well as invalidating authentication sessions. No browser storage or public seed is required.

The server ranks eligible UTC instants using HMAC-SHA256 with owner, event type and host-local period identity. Input ordering and guest timezone cannot change that ranking. Removing a busy choice retains the other selected choices and fills from the next eligible rank. The full host day or week is calculated before returning the requested date range. Midnight boundaries are resolved independently for DST.

The signed-in owner sees genuine availability without artificial hiding. The public endpoint verifies the session server-side; a request body cannot grant that bypass. Authenticated or reservation-specific requests do not use the shared slot cache, and availability responses use `Cache-Control: private, no-store`.

The booking service checks that a public booking or reschedule uses an offered instant. The trusted booking context carries the guest's reservation cookie so a selected time does not conflict with its own hold. Hidden times return HTTP 409; normal conflict checks remain in the booking service.

## Verification

Focused Vitest suites cover ranking, counts, 66%, DST, canonical weekly queries, guest timezone changes, owner bypass, session loading, cache isolation, direct-booking rejection and form controls. The startup regression suite uses Node's test runner separately.
