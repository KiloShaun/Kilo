# HomeSafe — Security & Child Privacy

Child data is treated as the most sensitive data in the system. Every design decision below
follows from that.

## Roles

`SUPER_ADMIN`, `TRANSPORT_OPERATOR`, `SCHOOL_ADMIN`, `DRIVER`, `PARENT`, `CHILD` — stored as
`User.role` (a single role per user for MVP; a multi-role model is a straightforward later
extension if e.g. a school admin is also a parent, but is not needed yet and would add
authorization complexity before there's a real requirement for it).

## Provisioning, not self-registration, for staff roles

`POST /auth/register` only ever creates a `PARENT` account. This prevents anyone from
self-granting elevated access by simply calling the public registration endpoint with a
different role in the body — a mistake that's easy to make if `role` is a trusted
client-supplied field on a public endpoint (the global `ValidationPipe`'s
`forbidNonWhitelisted` also rejects the field outright if someone tries).

Every other role comes into being one of two ways:

- **`DRIVER`, `SCHOOL_ADMIN`, `TRANSPORT_OPERATOR`** are admin-provisioned via
  `POST /drivers` (`SUPER_ADMIN`/`TRANSPORT_OPERATOR`), `POST /school-admins`
  (`SUPER_ADMIN`/`TRANSPORT_OPERATOR`, scoped to a `schoolId`), and `POST /transport-operators`
  (`SUPER_ADMIN` only — an operator account is powerful enough that only the top role can
  mint one). All three go through the same `AccountsService.createInvitedAccount`: the user
  row is created with an unusable random placeholder password (bcrypt-hashed, never
  returned), alongside a one-time invite token (a 32-byte random value; only its SHA-256
  hash is persisted, in `AccountInvite.tokenHash`, expiring after
  `INVITE_EXPIRES_IN_DAYS`, default 7). The plaintext token is returned once, in the create
  response, to the calling admin. Until a real email/SMS provider exists (see
  `docs/mvp-roadmap.md`), relaying that token to the invitee is a manual, out-of-band step
  for the admin — the account is provably unusable (login fails) until they do.
  `POST /auth/accept-invite` (public, token + new password) is the only way such an account
  gets a real, usable password; it consumes the token (marks it used, so it can't be
  replayed) and logs the user in immediately.
- **`SUPER_ADMIN`** has no ordinary creation path at all — every other admin action already
  requires one to exist, so nothing can create the first one through normal authorization.
  `POST /auth/bootstrap` breaks that circularity: it creates a `SUPER_ADMIN` directly, but
  only when the `users` table is completely empty, checked and enforced inside a single
  `Serializable` database transaction (so two concurrent calls against an empty database
  can't both slip through) and tightly rate-limited (3/hour). Once any user exists, it
  refuses permanently — there is deliberately no way to re-run it or mint a second
  `SUPER_ADMIN` through it. It exists purely to let a fresh deployment stand itself up; a
  lost `SUPER_ADMIN` password afterwards is a direct-database-access recovery, not an API
  call.
- **`CHILD`** has no login-credential account at all, by design, not oversight — children are
  identified at pickup/drop-off via QR/NFC/RFID or (for older children, later phases) a
  dedicated child app that doesn't require the same credential model as an adult account.

## Authorization model: scope, not just role

A role answers "what kind of actions can this user attempt." It does not answer "which
records can they act on." Every read/write path additionally scopes by ownership:

- **Parent** → only children where `Child.parentId = currentUser.parentId` (enforced in the
  service layer via a repository-level `where` clause, never by filtering after an
  unscoped fetch).
- **Driver** → only children currently assigned to a route on the driver's *active* journey
  today — not "any child the driver has ever driven," and not the child's home address or
  parent contact details beyond what's needed to complete a pickup/dropoff. This is the
  "minimum information required to safely perform the driver's job" principle from the
  brief: the driver's `GET /journeys/:id/passengers` DTO deliberately omits fields like the
  child's home address once it's not the current stop, and omits the parent's full contact
  history.
- **School Admin** → only records belonging to their `schoolId`, unless explicitly granted
  cross-school access by a `SUPER_ADMIN` (modeled as a future `AdminGrant`, not built yet —
  not needed until there's a real multi-school-admin use case).
- **Transport Operator** → only vehicles/drivers/routes they operate.
- **Super Admin** → unscoped, but every action is audit-logged (see below) precisely
  because it's unscoped.

This is implemented directly in each module's service layer: every query that returns a
scoped resource (a child, a driver, a school's data) takes the requesting
`AuthenticatedUser` and adds the ownership filter to the Prisma `where` clause itself,
rather than fetching broadly and filtering in application code afterwards. A generic
scope-enforcing guard/decorator was considered but deliberately not built yet — with five
modules and a handful of scoping rules, an explicit `where` clause per query is easier to
read and to get right than a generic reflection-based mechanism would be at this stage.
That abstraction is worth revisiting once the number of scoped resource types grows enough
that per-module repetition becomes the bigger risk.

## AuthN

- Passwords hashed with bcrypt (cost factor 12, configurable).
- JWT access tokens (short-lived, 15 min) + refresh tokens (long-lived, rotated on use,
  stored hashed server-side so a leaked refresh token can be revoked).
- Rate limiting on `/auth/*` (via `@nestjs/throttler`) to slow down credential stuffing.
- No secrets in source: JWT signing keys, DB URL, Redis URL, and provider API keys are read
  from environment variables (validated at boot with a `class-validator`-backed config
  schema — the app refuses to start with a missing/malformed secret rather than silently
  running insecurely).

## Transport & storage

- HTTPS/WSS everywhere in every environment above local dev; local dev documents this
  clearly rather than pretending plaintext HTTP dev is representative of prod.
- Postgres connections use TLS in staging/production (`sslmode=require`), configured via
  the connection string, not hard-coded.
- At-rest encryption is delegated to the managed database/cloud provider (RDS/Cloud SQL
  encryption-at-rest) rather than reinvented at the application layer, per "use managed
  services where appropriate."

## Audit logging

Every sensitive admin mutation (child↔route assignment/removal, driver↔vehicle assignment,
parent account creation, journey modification, incident acknowledgement) is captured by an
`AuditLogInterceptor` that records `actorUserId`, `action`, `resourceType`, `resourceId`,
`ipAddress`, `userAgent`, and before/after snapshots (diffed, not full dumps, to keep rows
small) into the append-only `AuditLog` table. This is an interceptor, not something each
handler has to remember to call — new mutating endpoints get audit coverage by being
annotated with `@Audited('ACTION_NAME')` rather than by hand-rolled logging calls that are
easy to forget.

## Input validation

Every DTO uses `class-validator` decorators; the global `ValidationPipe` runs with
`whitelist: true, forbidNonWhitelisted: true, transform: true` — unexpected fields are
rejected outright rather than silently ignored (which matters for a public endpoint like
registration, where an extra `role` or `isAdmin` field must be rejected, not tolerated).

## Never expose child location publicly

There is no unauthenticated route anywhere in the API that returns a location, a child's
name, or a journey's real-time status. `GET /vehicles/:id/location` and the WebSocket
`journey:{id}:location` room both require an authenticated, scoped subscriber (the room join
itself checks the connecting user is authorized for that journey, not just that they hold
*a* valid token).

## Session / device management

Refresh tokens are stored per-device (a `Session` record: `userId`, `deviceId`, hashed
token, `lastSeenAt`), so a user can list and revoke individual device sessions
(`GET /users/me/sessions`, `DELETE /users/me/sessions/:id`) — necessary for "I lost my
phone" scenarios given this app handles child-safety data.
