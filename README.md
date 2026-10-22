# HomeSafe

A school transport safety and tracking platform for South Africa, connecting parents,
children, schools/transport operators, and drivers with real-time visibility of school
transportation journeys.

HomeSafe does not just answer "where is the bus?" — it answers **"where is my child, what
stage of the journey are they in, who is responsible for them right now, and is everything
happening according to schedule?"**

## Documentation

Start here before touching code:

- [`docs/architecture.md`](docs/architecture.md) — system architecture, tech stack, real-time
  data flow, offline support, observability.
- [`docs/domain-model-erd.md`](docs/domain-model-erd.md) — entity relationships, journey
  state machine, event schema, indexing rationale.
- [`docs/api-spec.yaml`](docs/api-spec.yaml) — OpenAPI spec (implemented + planned
  endpoints, each tagged `x-status`).
- [`docs/security.md`](docs/security.md) — roles, scoping, child-privacy rules, audit
  logging.
- [`docs/testing-strategy.md`](docs/testing-strategy.md) — what "done" means for a module.
- [`docs/mvp-roadmap.md`](docs/mvp-roadmap.md) — phased build plan and current status.

## What's implemented today

Every phase except analytics (Phase 11) is built and tested end-to-end — see
[`docs/mvp-roadmap.md`](docs/mvp-roadmap.md) for the full phase-by-phase breakdown, including
what deliberately isn't done (ETA calculation, a real map provider, real push/SMS/WhatsApp
delivery, NFC/RFID hardware integration) and why.

- **Auth + RBAC**: registration/login/refresh, JWT access + refresh tokens, six roles,
  scoped authorization guards, a one-time `/auth/bootstrap` for the first `SUPER_ADMIN`, and
  an invite-token flow for every admin-provisioned account.
- **Core entities**: Schools, Parents, Children, Drivers, Vehicles, Transport Operators,
  School Admins — full CRUD/provisioning, scoped by role/ownership, audited.
- **Routes**: route + stop creation, driver/vehicle assignment, child enrolment, scoped to
  a school admin's own school.
- **GPS tracking**: Redis-backed live location with LIVE/STALE/OFFLINE freshness
  classification and a WebSocket gateway pushing updates to clients watching a journey.
- **Journey lifecycle**: start/end, idempotent per-child pickup/dropoff/missed-pickup, each
  restricted to the journey's assigned driver, each writing an immutable event timeline.
- **Notifications**: an in-app feed driven by journey/emergency domain events through a
  provider-swappable interface (only the in-app channel is actually wired to a provider).
- **Emergency/SOS**: trigger (snapshotting every child currently on the vehicle),
  acknowledge, resolve — each notifying the right operators and parents.
- **Three web apps** (`apps/admin-web`, `apps/driver-web`, `apps/parent-web`, all React +
  Vite, all calling the live API — nothing mocked) covering the full admin/driver/parent
  experience, verified together with a real cross-app Playwright run (see
  `docs/mvp-roadmap.md`).
- A complete Prisma schema for the full data model described in the product brief, an audit
  log, a global error envelope, correlation IDs, and Swagger/OpenAPI docs at `/api/docs`.

## Getting started (local development)

```bash
cp apps/api/.env.example apps/api/.env   # then fill in secrets
docker compose up -d postgres redis
npm install
npm run --workspace apps/api prisma:migrate
npm run start:dev
```

API docs (Swagger UI) are served at `http://localhost:3000/api/docs` once the server is
running.

To also run the three web apps against it:

```bash
cp apps/admin-web/.env.example apps/admin-web/.env.local
cp apps/driver-web/.env.example apps/driver-web/.env.local
cp apps/parent-web/.env.example apps/parent-web/.env.local
npm run --workspace apps/admin-web dev    # http://localhost:5173
npm run --workspace apps/driver-web dev   # http://localhost:5174
npm run --workspace apps/parent-web dev   # http://localhost:5175
```

On the API, set `CORS_ORIGINS` to include all three origins (the `.env.example` already
does). On a fresh database: open admin-web, use the "First-time setup" tab to bootstrap the
first `SUPER_ADMIN`, then provision a driver from the dashboard and relay them the invite
token shown — they redeem it on driver-web's "Accept invite" tab. A parent creates their own
account directly on parent-web.

### Tests

```bash
npm run lint
npm test              # unit tests
npm run test:e2e      # integration tests (requires DATABASE_URL)
```

## Repository layout

```
apps/
  api/            NestJS backend (modular monolith)
  admin-web/      admin dashboard (React + Vite) — schools, staff, fleet, routes, live ops
  driver-web/     driver app (React + Vite) — today's routes, pickup/dropoff, GPS, SOS
  parent-web/     parent app (React + Vite) — children, live trip, notifications
docs/             architecture, ERD, API spec, security, testing, roadmap
docker-compose.yml
```

`driver-web` and `parent-web` are responsive web apps rather than native mobile — see
`docs/mvp-roadmap.md` for why, and for what the API would need (nothing) to add a native
shell later.
