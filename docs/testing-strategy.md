# HomeSafe — Testing Strategy

## Layers

- **Unit tests** (`*.spec.ts`, colocated with source): pure business logic — guards,
  scoping rules, DTO validation edge cases, the (future) ETA calculator, the (future)
  journey state machine transition rules. Fast, no DB, no network; mocks/fakes for Prisma.
- **Integration/e2e tests** (`apps/api/test/*.e2e-spec.ts`): exercise real HTTP requests
  against a real (test) Postgres instance via Prisma, covering the critical workflows:
  register → login → access own resources → denied access to others' resources; and the
  full staff-provisioning chain (bootstrap → create account → accept invite → login). Run
  against a disposable database (docker-compose test profile / a `DATABASE_URL` pointed at
  a throwaway schema). e2e files run with Jest's `maxWorkers: 1` (see `test/jest-e2e.json`)
  because the bootstrap test needs the whole `users` table empty and wipes it itself —
  running e2e files in parallel against the same database would race.
- **Contract/OpenAPI**: the Swagger document is generated from the same decorators that
  drive validation, so contract drift is structurally prevented rather than tested for
  separately at this stage. A consumer-driven contract test suite is worth adding once a
  mobile client exists to break against the contract.

## What must be tested before a feature is "done" (per §22 of the brief)

For every module, before it's considered complete:

1. **Functionality** — happy path + the documented error cases (e.g.
   `CHILD_ALREADY_CHECKED_IN`).
2. **Security** — a test that proves a user *without* the right scope/role gets 403/404
   (404, not 403, when leaking existence would itself be a privacy issue — e.g. a parent
   probing another parent's child ID should not learn the child exists).
3. **Error handling** — invalid input returns the standard error envelope with a 4xx, not
   a 500.
4. **Data integrity** — unique constraints and required foreign keys are actually enforced
   (tested against the real Prisma schema, not mocked away).

Performance, mobile UX, and offline-behaviour testing are called out in the brief but are
only meaningful once there's a mobile client and real GPS ingestion load (Phases 4+); they
are tracked in `docs/mvp-roadmap.md` rather than faked with placeholder tests now.

## Test commands

```bash
npm run lint         --workspace apps/api
npm run test         --workspace apps/api   # unit
npm run test:e2e     --workspace apps/api   # integration (requires DATABASE_URL)
npm run build        --workspace apps/api
```

## CI

`.github/workflows/ci.yml` runs lint, unit tests, a Postgres-backed e2e run, and a
production build on every push/PR, so a regression is caught before merge rather than in
review.
