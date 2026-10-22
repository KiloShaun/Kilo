# HomeSafe — MVP Roadmap

Phased per the product brief (§19). Each phase should be shippable/demoable on its own —
no phase is "half of a feature."

| Phase | Scope | Status |
|---|---|---|
| 1 | Authentication + user roles (RBAC) | **Built** |
| 2 | Schools, parents, children, drivers, vehicles (CRUD, ownership scoping) | **Built** |
| 3 | Routes and route assignments | **Built** |
| 4 | Driver application | **Built as a responsive web app** (`apps/driver-web`), not native mobile — see "Why responsive web" below |
| 5 | GPS tracking | **Built** — Redis-backed latest-location cache, LIVE/STALE/OFFLINE freshness, WebSocket push |
| 6 | Parent application | **Built as a responsive web app** (`apps/parent-web`) |
| 7 | Child pickup/drop-off verification | **Built** — idempotent journey state machine |
| 8 | Notifications | **Built** — in-app feed via a provider-swappable interface; only the in-app channel is wired to a real provider (see below) |
| 9 | Admin dashboard (web) | **Built** — schools, staff, fleet, routes, live journeys, notifications, emergency ops |
| 10 | Emergency / SOS | **Built** — trigger, affected-children snapshot, acknowledge/resolve, notification fan-out |
| 11 | Analytics and reporting | Not started |

WhatsApp, NFC/RFID hardware integration, SMS, and route optimisation are explicitly
post-core-platform, per the brief, and remain unbuilt.

## What's built, concretely

### Backend (`apps/api`)

- **Auth & accounts** (Phase 1): JWT access + refresh tokens, bcrypt password hashing,
  `POST /auth/register` (self-service, always `PARENT`), `POST /auth/bootstrap` (one-time
  first `SUPER_ADMIN`), `POST /auth/accept-invite` (the one-time-token flow every
  admin-provisioned account — `DRIVER`, `SCHOOL_ADMIN`, `TRANSPORT_OPERATOR` — must complete
  before it can log in). See `docs/security.md`.
- **Core entities** (Phase 2): full CRUD for Schools, Parents, Children, Drivers, Vehicles,
  each scoped by role. `GET /parents?email=` lets an admin find a parent's internal id to
  enrol their child — the only way to discover it, since a parent's own id is otherwise only
  ever resolved server-side from their JWT.
- **Routes** (Phase 3): `RoutesModule` — create a route with stops, assign a driver+vehicle
  (closing any prior active assignment), enrol/unenrol a child, all scoped to the route's
  school for a `SCHOOL_ADMIN`.
- **GPS tracking** (Phase 5): `POST /tracking/locations` (driver-only, verified against the
  journey they're assigned to) persists a sampled trail to Postgres and writes the latest
  point to Redis; `GET /tracking/journeys/:id/location` classifies it LIVE / STALE / OFFLINE
  against `LOCATION_LIVE_WINDOW_SECONDS` / `LOCATION_STALE_WINDOW_SECONDS`. A WebSocket
  gateway (`/tracking` namespace) pushes updates to clients watching a journey, re-checking
  the same visibility rules as `GET /journeys/:id` on every subscription. No ETA engine yet —
  not attempted, not faked.
- **Journey lifecycle** (Phase 7): `JourneysModule` implements start → in-progress →
  completed/cancelled, plus per-child pickup/dropoff/missed-pickup, each idempotent (a second
  identical call is a no-op, not an error) and each only callable by the journey's assigned
  driver. Every transition writes an immutable `JourneyEvent` and emits a domain event via
  `EventEmitter2` for the notifications module to react to.
- **Notifications** (Phase 8): `NotificationsListener` subscribes to the journey/emergency
  domain events and fans out `Notification` rows through a `NotificationChannelProvider`
  interface (`src/notifications/providers/`). Only `InAppNotificationProvider` is wired up —
  a notification "sends" by existing in `GET /notifications`. Real push/SMS/WhatsApp/email
  providers are a matter of implementing that interface and rebinding
  `NOTIFICATION_CHANNEL_PROVIDER`; no credentials for those exist in this environment, so
  they were not stubbed-and-claimed-working. There is no read/unread tracking — the schema's
  `NotificationStatus` models provider delivery state, not a read receipt, and inventing one
  by misusing that field would have been dishonest about what it does.
- **Emergency/SOS** (Phase 10): `POST /emergency/sos` snapshots every child currently
  `ON_VEHICLE` on the journey (a point-in-time copy, not a live join — see
  `docs/domain-model-erd.md`), writes a timeline (`SOS_TRIGGERED`, `LOCATION_CAPTURED` if a
  position was given, `OPERATOR_NOTIFIED`, `PARENTS_NOTIFIED`), and notifies every operator
  (`SUPER_ADMIN`, `TRANSPORT_OPERATOR`, the journey's school's admins) plus every affected
  child's parent. `POST /emergency/:id/acknowledge` and `.../resolve` are idempotent.
- Global request validation, a consistent `{ error: { code, message, correlationId } }`
  envelope, correlation IDs, structured logging, an audit-log interceptor on mutating admin
  actions, and Swagger/OpenAPI docs at `/api/docs`.
- 59 unit tests + a 28-case e2e suite (`test/full-platform-lifecycle.e2e-spec.ts`) exercising
  the entire chain against real Postgres and Redis: provisioning every role, building a
  route, scheduling a journey, starting it, reporting GPS and reading it back as a scoped
  parent, picking up and dropping off a child idempotently, triggering/acknowledging/
  resolving an SOS, and completing the journey.

### Three web apps, one shared pattern

All three are React + TypeScript + Vite, call the live API directly (nothing mocked), and
were verified with a real cross-app Playwright run driving all three browsers at once against
a running API + Postgres + Redis — see "How this was verified" below.

- **`apps/admin-web`** — schools, staff provisioning, fleet, routes (create, assign
  driver/vehicle, enrol children), live journeys (schedule, view detail, see the event
  timeline), emergency ops (acknowledge/resolve, plus a manual SOS trigger for testing), and
  a notifications feed.
- **`apps/driver-web`** — today's assigned routes, start/end route, per-child pickup/dropoff
  (manual verification only — no QR/NFC/RFID reader hardware exists to integrate against;
  the `VerificationMethod` enum and API already accept those values), delay reporting, an SOS
  button, and a GPS send loop using the browser's Geolocation API every 10s while the route
  is in progress.
- **`apps/parent-web`** — account creation/login, children list, today's trips, a live trip
  view polling the tracking endpoint for a freshness-coded position indicator, and a
  notifications feed.

### Why responsive web instead of native mobile (Phases 4 & 6)

React Native was the brief's original assumption, but this sandbox has no iOS/Android
simulator, so a native app could not be run, screenshotted, or verified here — only written
on faith. Responsive web apps against the same API can be launched, driven with a real
browser, and verified end-to-end in this environment, which is why that's what got built.
The API has no native-vs-web assumptions baked in (plain REST + a standard WebSocket
namespace), so a native shell could be added later without backend changes.

### No map provider

The parent's live trip view shows a freshness-coded indicator (a pulsing dot + raw
coordinates + "last updated"), not a tile map — `architecture.md`'s `MapProvider` abstraction
point still applies for whoever wires up Google Maps/Mapbox/Leaflet later. This was a
deliberate choice, not a missed feature: a real tile provider needs an API key and live
internet access to tile servers, which can't be guaranteed in every environment this runs in,
and a map that silently fails to load would be worse than an honest, always-working
indicator.

## How this was verified

Beyond the automated unit/e2e suite, the full §20 acceptance scenario was driven through real
Chromium browsers (Playwright) against a running API + Postgres + Redis, with three separate
browser contexts standing in for the admin, the driver, and the parent simultaneously:
bootstrap → school/driver/vehicle/route → parent registration → admin finds the parent by
email and enrols their child → journey scheduled → driver starts the route and the GPS send
loop begins → driver picks up the child → **parent sees the pickup notification and a
genuinely LIVE position reading** (real GPS data, not a stub) → driver triggers SOS → admin
sees, acknowledges, and resolves the incident → driver drops the child off and ends the route
→ parent sees the final notification. This run caught four real bugs that no unit test had
(a CORS allowlist missing two of the three app origins, a Prisma query that omitted a nested
relation only on the list endpoint, three admin panels that never refreshed each other's
reference data, and a GPS validator that rejected a legitimate `0` reading) — all fixed, with
a regression test added for the last one.

## What's genuinely not done

- **Analytics/reporting (Phase 11)** — not started.
- **ETA calculation** — the tracking endpoint classifies freshness, not a predicted arrival
  time.
- **Real push/SMS/WhatsApp/email delivery** — the provider interface exists; no provider
  behind it does.
- **A real map** — see above.
- **NFC/RFID/QR hardware integration** — the data model and API accept those verification
  methods; no physical reader integration exists (there's no hardware to integrate against).
- **Notification read/unread state** — not modeled; see above.
