# HomeSafe — Domain Model & ERD

The authoritative schema is `apps/api/prisma/schema.prisma`. This document explains the
relationships, the journey/incident state machines, and the indexing rationale in prose so
reviewers don't have to reverse-engineer intent from the schema alone.

## 1. Entity Relationship Overview

```
User ──1:1──> Parent            User ──1:1──> Driver
User ──1:1──> SchoolAdmin*                       │
                                                  │
School ──1:N──> Child <──N:1── Parent (guardian)  │
  │               │                               │
  │               │ N:1                           │
  │               ▼                               │
  │            Route  <───────N:1─────────── Vehicle ◀──N:1── Driver
  │               │                               (assigned driver, current)
  │               │ 1:N
  │               ▼
  │          RouteStop
  │               ▲
  │               │ N:1
  │        ChildRouteAssignment ──N:1──> Child
  │               (pickup/dropoff stop, sequence)
  │
  └──1:N──> Journey ──N:1──> Route
                │  ──N:1──> Vehicle
                │  ──N:1──> Driver
                │
                ├──1:N──> JourneyEvent (immutable, append-only)
                ├──1:N──> ChildJourney (per-child status within this journey)
                ├──1:N──> GPSLocation (sampled trail)
                └──0:1──> EmergencyIncident (if SOS triggered during this journey)

AuditLog ──N:1──> User (actor)  [logs sensitive admin actions across all of the above]

* SchoolAdmin / TransportOperator / SuperAdmin are represented as `User.role`, not
  separate tables — they don't have the rich domain attributes Parent/Driver have
  (license number, emergency contact, etc.), so a role enum on User is sufficient and
  avoids an unnecessary join for every admin-authenticated request.
```

### Why `ChildJourney` is separate from `JourneyEvent`

- `JourneyEvent` is the **immutable audit trail**: every timestamped thing that happened
  on a journey (`DRIVER_STARTED`, `CHILD_PICKED_UP`, `VEHICLE_DELAYED`, ...), who recorded
  it, how it was verified, and where it happened. Never updated, never deleted.
- `ChildJourney` is the **current-state projection** for a child within a journey (`status`,
  `scheduledPickupTime`, `actualPickupTime`, `scheduledDropoffTime`, `actualDropoffTime`).
  It's what the parent app reads to render "ON VEHICLE" without replaying the whole event
  log on every request. It is derived from and kept in sync with `JourneyEvent` writes
  (same transaction), so the two never disagree.

This mirrors the classic event-sourcing-lite pattern: append-only log for history/audit,
denormalized read-model row for "what's true right now."

## 2. Journey State Machine

```
SCHEDULED
   │  driver taps "Start Route"
   ▼
DRIVER_STARTED
   │
   ▼
EN_ROUTE ───────────────┐
   │  arrives at a stop │  (loops for each stop)
   ▼                    │
PICKUP                  │
   │  child verified    │
   ▼                    │
CHILD_ONBOARD ──────────┘
   │  all stops done, arrives at school
   ▼
SCHOOL_ARRIVAL
   │  child checked out of vehicle at school
   ▼
SCHOOL_DROPOFF
   │  (afternoon: same journey type reversed, or a new Journey record for the PM run)
   ▼
RETURN_ROUTE
   │  child verified at home stop
   ▼
CHILD_DROPPED_OFF
   │  last child dropped off, driver taps "End Route"
   ▼
COMPLETED
```

Morning and afternoon runs are modeled as **separate `Journey` rows** (same Route, same
day, `direction = TO_SCHOOL | FROM_SCHOOL`), not a single journey spanning the whole day.
This keeps the state machine linear and makes "journey duration" and "on-time %" reporting
per-run rather than needing to split a combined record.

Per-child status (`ChildJourney.status`) has a narrower state set, since a child's
experience within a journey is simpler than the vehicle's:

```
NOT_YET_BOARDED → PICKED_UP → ON_VEHICLE → ARRIVED_AT_SCHOOL → DROPPED_OFF
                       (or) → MISSED_PICKUP
```

## 3. Event Schema

Every `JourneyEvent` row matches this shape (see the master prompt's example — this is the
same contract, persisted):

```json
{
  "id": "uuid",
  "journeyId": "uuid",
  "childId": "uuid | null",
  "eventType": "CHILD_PICKED_UP",
  "occurredAt": "2026-09-18T06:42:31+02:00",
  "latitude": -26.123,
  "longitude": 28.456,
  "recordedBy": "DRIVER | PARENT | SYSTEM",
  "recordedByUserId": "uuid | null",
  "verificationMethod": "NFC | QR | MANUAL | RFID | null",
  "metadata": { "...": "event-specific extra fields, jsonb" }
}
```

`metadata` is `jsonb` deliberately: different event types carry different extra context
(a `VEHICLE_DELAYED` event carries `delayMinutes` and `reason`; a `CHILD_MISSED_PICKUP`
carries `reason`) and we don't want a migration for every new event-specific field. The
fields that are common to *all* events (who, when, where, what) are real typed columns so
they can be indexed and queried without JSON operators.

## 4. Indexing Rationale (addressing §11 of the brief)

High-write, high-growth tables (`GPSLocation`, `JourneyEvent`, `Notification`, `AuditLog`)
are indexed for the access patterns that actually happen in production:

| Table | Index | Why |
|---|---|---|
| `GPSLocation` | `(vehicleId, recordedAt DESC)` | "latest N points for this vehicle" (journey replay, map trail) |
| `GPSLocation` | `(journeyId, recordedAt)` | replay a specific journey's path in order |
| `JourneyEvent` | `(journeyId, occurredAt)` | render a journey's timeline in order |
| `JourneyEvent` | `(childId, occurredAt)` | a child's history across journeys ("historical journeys" in the parent app) |
| `Journey` | `(routeId, scheduledDate)` | "today's journey for this route" lookups, driver's daily list |
| `Journey` | `(driverId, status)` | "does this driver have an active journey" checks |
| `ChildRouteAssignment` | unique `(childId, routeId)` | a child isn't double-assigned to the same route |
| `ChildJourney` | unique `(journeyId, childId)` | one status row per child per journey |
| `Notification` | `(recipientUserId, createdAt DESC)` | "my notifications" feed, paginated |
| `AuditLog` | `(actorUserId, createdAt DESC)` and `(resourceType, resourceId)` | "who did what" and "what happened to this record" |
| `Vehicle` | unique `(registrationNumber)` | can't register the same plate twice |
| `User` | unique `(email)` | login lookup, uniqueness |

All foreign keys are indexed by default (Prisma/Postgres convention); the table above calls
out the *additional* composite/covering indexes that matter for the query patterns in §7 of
the brief (journey_id, child_id, driver_id, vehicle_id, route_id, timestamp).

## 5. Soft Deletion

`deletedAt` (nullable timestamp) is used on entities where "removal" needs to preserve
history for audit/compliance rather than hard-delete: `Child`, `Parent`, `Driver`,
`Vehicle`, `Route`, `User`. Journey and event tables are never deleted at all (append-only,
full stop — a journey that was created in error is marked `CANCELLED`, not removed).
`AuditLog` is immutable and never soft-deleted either.

## 6. Emergency Incident Timeline

`EmergencyIncident` snapshots `vehicleId`, `driverId`, `journeyId`, and a `jsonb` array of
`affectedChildIds` at trigger time (not a live join), because who was on the vehicle at
`08:17:03` must remain answerable even if `ChildJourney` rows change afterwards. Its
timeline (`triggered`, `location_captured`, `operator_notified`, `parents_notified`,
`operator_acknowledged`, `resolved`) is stored as rows in the same `JourneyEvent` table,
scoped by `incidentId` instead of `journeyId` — same append-only shape, same query patterns,
no need for a parallel timeline table.
