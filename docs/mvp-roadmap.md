# HomeSafe — MVP Roadmap

Phased per the product brief (§19). Each phase should be shippable/demoable on its own —
no phase is "half of a feature."

| Phase | Scope | Status |
|---|---|---|
| 1 | Authentication + user roles (RBAC) | **Built in this iteration** |
| 2 | Schools, parents, children, drivers, vehicles (CRUD, ownership scoping) | **Built in this iteration** |
| 3 | Routes and route assignments | Schema modeled; API scaffolded, not implemented |
| 4 | Driver mobile application | Not started |
| 5 | GPS tracking | Schema modeled (`GPSLocation`); ingestion endpoint scaffolded |
| 6 | Parent mobile application | Not started |
| 7 | Child pickup/drop-off verification | Schema modeled (`JourneyEvent`, `ChildJourney`); not implemented |
| 8 | Notifications | Schema modeled (`Notification`); event bus scaffolded |
| 9 | Admin dashboard (web) | Not started |
| 10 | Emergency / SOS | Schema modeled (`EmergencyIncident`); not implemented |
| 11 | Analytics and reporting | Not started |

WhatsApp, NFC/RFID hardware integration, SMS, and route optimisation are explicitly
post-core-platform, per the brief.

## What "Built in this iteration" means concretely

- A working NestJS backend (`apps/api`) with:
  - `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` — JWT access + refresh
    tokens, bcrypt-hashed passwords, self-service always creates a `PARENT`.
  - `POST /auth/bootstrap` — creates the platform's first `SUPER_ADMIN` on an empty
    database (the only way one ever comes into existence); `POST /auth/accept-invite` — the
    one-time token flow every admin-provisioned account (`DRIVER`, `SCHOOL_ADMIN`,
    `TRANSPORT_OPERATOR`) must complete before it can log in. See `docs/security.md` for why
    both exist and how they're made race- and replay-safe.
  - `POST /drivers`, `POST /school-admins`, `POST /transport-operators` — admin-provisioned
    account creation for every remaining staff role, all sharing one `AccountsService`.
  - Full CRUD for `Schools`, `Parents`, `Children`, `Drivers`, `Vehicles`, each scoped by
    role (a parent only ever sees their own children; a school admin only sees their
    school's data).
  - A Prisma schema covering the entire data model in §11 of the brief, so later phases
    are additive migrations, not redesigns.
  - Global request validation, a consistent error envelope, correlation IDs, structured
    logging, an audit-log interceptor on mutating admin actions, and Swagger/OpenAPI docs
    served at `/api/docs`.
  - Unit tests for auth/accounts/scoping and an e2e suite covering the full
    bootstrap → provision → accept-invite → login chain plus the critical-path
    parent-scoping boundary (a parent cannot read another parent's child).

## Why stop the implementation here for this iteration

The brief's §20 acceptance scenario (parent watches a live vehicle, child gets verified,
parent gets push notifications in real time) depends on Phases 3–8 being built on top of a
correct Phase 1/2 foundation — routes and assignments, the journey state machine, GPS
ingestion, the WebSocket gateway, and a real push provider integration. Building those
convincingly (rather than as unverified stubs) is itself multiple phases of work per the
brief's own phasing. Rather than generate large amounts of speculative, untested code across
mobile apps and real-time infrastructure in one pass, this iteration delivers a solid,
tested foundation (auth + core entities + full schema) exactly as instructed in §22 ("do not
immediately start generating large amounts of code" / "begin implementation incrementally"),
with the next phases sequenced and ready to build on it.

## Next steps (in order)

1. **Phase 3 — Routes**: `RoutesModule`, `RouteStop` CRUD, `ChildRouteAssignment`, admin
   endpoints to build a route and assign children/drivers/vehicles to it.
2. **Phase 5 — GPS ingestion + ETA engine**: `POST /journeys/:id/location`, Redis-backed
   latest-location cache, the LIVE/STALE/OFFLINE classifier, and a first-pass ETA
   calculation (haversine distance / average speed; swappable for a routing-API-based ETA
   later).
3. **Phase 7 — Journey lifecycle + child verification**: `JourneyModule` implementing the
   state machine in `docs/domain-model-erd.md`, `POST /journeys/:id/start`,
   `.../children/:childId/pickup`, `.../dropoff`, `.../end`.
4. **Phase 8 — Notifications**: event subscribers wired to the events above, a push
   provider (e.g. FCM) behind the `NotificationChannel` interface, delivery-status tracking.
5. **Phase 4/6 — Driver and Parent mobile apps**: React Native apps consuming the now-real
   API + WebSocket gateway; this is where the brief's acceptance scenario becomes literally
   demonstrable end-to-end.
6. **Phase 10 — Emergency/SOS**, **Phase 9 — Admin dashboard web UI**, **Phase 11 —
   Analytics**, then WhatsApp/SMS/NFC hardware and route optimisation.
