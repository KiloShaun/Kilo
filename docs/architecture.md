# HomeSafe — System Architecture

> **HomeSafe** is a school transport safety, accountability, and communication platform for
> South Africa. It does not answer "where is the bus?" — it answers **"where is my child,
> what stage of the journey are they in, who is responsible for them right now, and is
> everything happening on schedule?"**

## 1. Guiding Principles

- **Modular monolith, not microservices-for-its-own-sake.** One deployable NestJS backend
  with strict domain module boundaries (Clean Architecture / DDD-flavoured). Modules can be
  extracted into services later (Tracking and Notifications are the most likely first
  candidates, since they have different scaling profiles — high-frequency writes and
  fan-out delivery, respectively).
- **API-first.** Every capability is exposed as a documented REST endpoint before any UI
  consumes it. OpenAPI is generated from the NestJS code (`@nestjs/swagger` decorators) so
  the spec never drifts from the implementation.
- **Event-driven where it matters.** Domain events (`ChildPickedUpEvent`,
  `SosTriggeredEvent`, etc.) are emitted internally via NestJS `EventEmitter2` and consumed
  by the Notification module, the Audit module, and (in a later phase) an outbox publisher
  to Redis Pub/Sub. This keeps notification providers swappable without touching business
  logic.
- **Stateless application tier.** All application servers are horizontally scalable;
  session state lives in JWTs, live location state lives in Redis, durable state lives in
  PostgreSQL.
- **Secure and least-privilege by default.** Every entity is scoped by role (see
  `docs/security.md`). Nothing about a child — their identity, location, or schedule — is
  ever reachable through an unauthenticated or over-broad endpoint.
- **Offline-first for the driver app.** The driver is the most connectivity-constrained
  actor and the one whose data loss is least acceptable (a missed "child picked up" event
  is a safety incident, not a UX papercut). See §7.
- **Build in phases, ship a walking skeleton first.** See `docs/mvp-roadmap.md`.

## 2. High-Level System Diagram

```
                        ┌───────────────────────┐
                        │      Parent App        │
                        │  (React Native + TS)   │
                        └───────────┬────────────┘
                                    │ HTTPS + WSS
                        ┌───────────▼────────────┐        ┌─────────────────┐
   ┌────────────────┐   │                        │        │  Admin / Ops    │
   │   Driver App    │──▶│      API Gateway       │◀───────│  Web Dashboard  │
   │ (React Native)  │   │   (NestJS - REST +     │        │ (React + TS)    │
   └────────────────┘   │    WebSocket Gateway)   │        └─────────────────┘
                        └──────┬──────────┬───────┘
                               │          │
                 ┌─────────────┘          └──────────────┐
                 ▼                                        ▼
        ┌─────────────────┐                     ┌───────────────────┐
        │   Core Domain    │                     │  Tracking Service  │
        │   Modules        │                     │  (GPS ingestion,   │
        │ Auth / Users /   │                     │  ETA engine)       │
        │ Schools / Children│                    └─────────┬──────────┘
        │ Drivers / Vehicles│                               │
        │ Routes / Journeys │                               ▼
        │ Emergency / Audit │                     ┌───────────────────┐
        └────────┬──────────┘                     │  Redis             │
                 │                                 │  - latest location │
                 │                                 │  - pub/sub channel │
                 ▼                                 │  - rate/queue state│
        ┌─────────────────┐                        └─────────┬──────────┘
        │   PostgreSQL     │                                  │
        │ (system of record)│◀───── persisted journey events ─┘
        └─────────────────┘
                 │
                 ▼
        ┌─────────────────┐        ┌───────────────────┐
        │ Notification     │──────▶│ Push / Email /     │
        │ Module (event-   │       │ (future: SMS/      │
        │ driven fan-out)  │       │  WhatsApp)          │
        └─────────────────┘        └───────────────────┘
```

## 3. Real-Time Location Flow

```
Driver App (GPS every N seconds, configurable, default 15s while ON_TRIP)
      │  buffers locally if offline
      ▼
POST /journeys/{id}/location   (batched, idempotent by client-generated eventId)
      │
      ▼
Tracking Service
   - validates journey is ACTIVE and location is plausible (accuracy, jump detection)
   - writes latest position to Redis:  key = vehicle:{id}:location, TTL = staleAfterSeconds
   - publishes to Redis channel:       journey:{id}:location
   - persists a sampled subset to GPSLocation table (system of record; not every point)
      │
      ▼
WebSocket Gateway (Socket.IO)
   - subscribed clients (parents/admins watching that journey) receive the update
   - fallback: GET /vehicles/{id}/location for clients that reconnect/poll

Location freshness classification (computed at read time, not stored):
  now - lastUpdate <  livenessWindow (e.g. 45s)   → LIVE
  now - lastUpdate <  staleWindow    (e.g. 5 min) → STALE
  now - lastUpdate >= staleWindow                 → OFFLINE
```

Redis is a **cache and pub/sub layer only**. The GPSLocation table in PostgreSQL is the
system of record for anything that must survive a Redis restart or be queried historically
(journey replay, incident investigation). We deliberately do not persist every raw GPS
ping — the ingestion endpoint writes every point to Redis/pub-sub for live tracking, but
persists a down-sampled trail (e.g. one point per ~20s, plus every point that triggers a
journey event) to keep the table's growth manageable. This ratio is configurable per
environment.

## 4. Journey Lifecycle

See `docs/domain-model-erd.md` for the full state machine and event schema. In short:
`SCHEDULED → DRIVER_STARTED → EN_ROUTE → PICKUP → CHILD_ONBOARD → SCHOOL_ARRIVAL →
SCHOOL_DROPOFF → RETURN_ROUTE → CHILD_DROPPED_OFF → COMPLETED`, with every transition
recorded as an immutable `JourneyEvent` row (append-only, never updated or deleted).

## 5. Notification Architecture

- Domain modules emit events (`CHILD_PICKED_UP`, `SOS_TRIGGERED`, `VEHICLE_DELAYED`, ...)
  via an internal event bus (`EventEmitter2` in-process for the monolith).
- A `NotificationsModule` subscribes to relevant events and resolves **who** should be
  notified (parent(s) of the child, transport operator, school admin) and **how**
  (push now; SMS/WhatsApp/email are pluggable `NotificationChannel` providers registered
  behind a common interface, so adding a provider never touches domain code).
- Every attempted notification is persisted as a `Notification` row with delivery status,
  so delivery can be audited and retried.
- This is the extraction seam if/when notification volume justifies a separate service.

## 6. Emergency / SOS Handling

SOS is treated as a priority interrupt, not a regular event:

1. Driver or child app calls `POST /emergency/sos` (idempotent, single retry-safe call).
2. The `EmergencyModule` immediately (synchronously, in the same request) creates an
   `EmergencyIncident` row with the vehicle, driver, active journey, and all children
   currently `ON_VEHICLE` snapshotted onto the incident — this snapshot must not depend on
   a later join, because assignments can change after the fact.
3. It emits `SosTriggeredEvent`, which the Notification module treats as **highest
   priority**: bypasses per-user notification-preference muting, and fans out to the
   transport operator and every affected parent in parallel.
5. Escalation policy (e.g. "if operator does not acknowledge within 2 minutes, notify
   SCHOOL_ADMIN and a secondary emergency contact") is configuration-driven per operator,
   evaluated by a scheduled job that checks unacknowledged incidents.
6. Every state change on the incident (`triggered`, `location_captured`, `operator_notified`,
   `parents_notified`, `operator_acknowledged`, `resolved`) is appended to the incident's
   timeline (modeled as `JourneyEvent`-style rows scoped to the incident) — never mutated.

## 7. Offline Support (Driver App)

```
GPS/event occurs on device
      │
      ▼
Write to local queue (SQLite / MMKV) with a client-generated UUID (idempotency key)
      │
      ▼
Attempt immediate sync ──success──▶ mark as synced, remove from queue
      │
      failure (no network)
      ▼
Stay in queue, retry with exponential backoff
      │
      ▼
Network restored → flush queue in order → server dedupes by idempotency key
```

- Every mutating event the driver app produces (`pickup confirmed`, `dropoff confirmed`,
  `route started`, `incident reported`) carries a client-generated `eventId` (UUID). The
  server's write path is `INSERT ... ON CONFLICT (event_id) DO NOTHING`-style idempotent,
  so a retried sync can never double-record a pickup.
- GPS pings are batched client-side (e.g. up to 30 points) so a reconnect doesn't cause a
  request storm.
- The default tracking interval is 15s while a journey is active and paused entirely when
  no journey is active; both the interval and the "active" heuristic (moving vs. stationary)
  are server-configurable per operator to trade off battery vs. freshness.

## 8. Observability

- **Structured logging**: JSON logs via `nestjs-pino`, one line per request, including
  `correlationId`, `userId`, `role`, route, status, latency.
- **Correlation IDs**: generated (or propagated from `X-Correlation-Id`) by middleware at
  the edge, attached to the async context (`AsyncLocalStorage`), included in every log line
  and in every error response.
- **Metrics**: Prometheus-style counters/histograms exposed on `/metrics` (excluded from
  public routing): `active_journeys`, `gps_updates_total`, `gps_update_failures_total`,
  `api_request_duration_seconds`, `notification_delivery_total{status}`,
  `sos_response_time_seconds`, `offline_sync_failures_total`, `late_pickups_total`,
  `late_arrivals_total`.
- **Tracing**: correlation ID is sufficient for MVP; OpenTelemetry spans are a Phase 11+
  addition once there's more than one service boundary worth tracing across.
- **Error monitoring**: a global exception filter normalizes all errors to the
  `{ error: { code, message, correlationId } }` shape (§ API spec) and reports 5xx errors to
  an error tracker (Sentry-compatible DSN, injected via config — not hard-coded).

## 9. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | Node.js 22 + TypeScript, NestJS | Modular monolith, see §1 |
| Database | PostgreSQL 16 | System of record |
| ORM | Prisma | Schema-first migrations, generated types |
| Cache / Pub-Sub | Redis 7 | Latest location, active-journey state, WS fan-out |
| Real-time | Socket.IO (NestJS WebSocket Gateway) | Room-per-journey subscription model |
| Web dashboard | React + TypeScript (Vite) | Operator/admin console |
| Mobile (parent, driver, child) | React Native + TypeScript | Phases 4/6/7 |
| Maps | Provider-abstracted (`MapProvider` interface) | Google Maps first; Mapbox swappable |
| Infra | Docker, docker-compose (dev); IaC (Terraform) for cloud (later) | Cloud-portable (AWS/GCP/Azure) |
| CI | GitHub Actions | Lint, typecheck, unit + e2e tests, build |

## 10. Repository Structure

```
HomeSafe/ (this repo)
├── apps/
│   └── api/                     # NestJS modular monolith (backend)
│       ├── prisma/              # schema.prisma, migrations
│       ├── src/
│       │   ├── auth/            # Phase 1
│       │   ├── users/           # Phase 1
│       │   ├── schools/         # Phase 2
│       │   ├── parents/         # Phase 2
│       │   ├── children/        # Phase 2
│       │   ├── drivers/         # Phase 2
│       │   ├── vehicles/        # Phase 2
│       │   ├── routes/          # Phase 3 (scaffolded)
│       │   ├── journeys/        # Phase 3/5 (scaffolded)
│       │   ├── tracking/        # Phase 5 (scaffolded)
│       │   ├── notifications/   # Phase 8 (scaffolded)
│       │   ├── emergency/       # Phase 10 (scaffolded)
│       │   ├── audit/           # cross-cutting
│       │   └── common/          # guards, filters, interceptors, decorators
│       └── test/
├── docs/                        # this document + ERD, API spec, roadmap, security, testing
├── docker-compose.yml           # postgres + redis + api, for local dev
└── .github/workflows/ci.yml
```

Mobile apps (`apps/parent-mobile`, `apps/driver-mobile`, `apps/child-mobile`) and the admin
web dashboard (`apps/admin-web`) are added as their own workspace packages starting Phase 4,
once the API surface they depend on is stable — scaffolding them before there's an API to
call would just be UI that has to be redone.
