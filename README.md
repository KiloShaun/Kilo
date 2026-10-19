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

- **Phase 1 — Auth + RBAC**: registration/login/refresh, JWT access + refresh tokens,
  six roles (`SUPER_ADMIN`, `TRANSPORT_OPERATOR`, `SCHOOL_ADMIN`, `DRIVER`, `PARENT`,
  `CHILD`), scoped authorization guards, a one-time `/auth/bootstrap` for the first
  `SUPER_ADMIN`, and an invite-token flow (`/auth/accept-invite`) for every
  admin-provisioned account.
- **Phase 2 — Core entities**: Schools, Parents, Children, Drivers, Vehicles,
  Transport Operators, School Admins — full CRUD/provisioning, scoped by role/ownership,
  audited.
- A complete Prisma schema for the full data model described in the product brief (routes,
  journeys, GPS tracking, notifications, emergency incidents, audit log), so later phases
  are additive migrations rather than a redesign.
- **Phase 9 (partial) — Admin web UI**: a minimal real dashboard (`apps/admin-web`, React +
  Vite) that logs in/bootstraps/accepts invites, lists and creates schools, provisions
  staff, and creates/looks up children — every action is a real call to the live API.

See [`docs/mvp-roadmap.md`](docs/mvp-roadmap.md) for what's next and why the implementation
stops where it does in this iteration.

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

To also run the admin web UI against it:

```bash
cp apps/admin-web/.env.example apps/admin-web/.env.local
npm run --workspace apps/admin-web dev
```

Open `http://localhost:5173`. On a fresh database, use the "First-time setup" tab to
bootstrap the first `SUPER_ADMIN`.

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
  admin-web/      minimal admin dashboard (React + Vite) — Phase 9, partial
docs/             architecture, ERD, API spec, security, testing, roadmap
docker-compose.yml
```

Mobile apps (parent, driver, child) are added as their own workspaces starting at Phase
4/6 of the roadmap, once the API they depend on is stable. The admin web app will grow
routes/journeys/live-ops views as those phases land.
