/**
 * Domain events emitted via EventEmitter2 as journeys progress. NotificationsModule listens
 * to these to fan out in-app notifications without JourneysService knowing who to notify —
 * see docs/architecture.md's event-driven notification design.
 */
export const JourneyEvents = {
  STARTED: 'journey.started',
  DELAYED: 'journey.delayed',
  COMPLETED: 'journey.completed',
  CHILD_PICKED_UP: 'journey.child.pickedUp',
  CHILD_DROPPED_OFF: 'journey.child.droppedOff',
  CHILD_MISSED_PICKUP: 'journey.child.missedPickup',
} as const;

export interface JourneyStartedPayload {
  journeyId: string;
  routeId: string;
  routeName: string;
  driverId: string;
}

export interface JourneyDelayedPayload {
  journeyId: string;
  reason: string;
}

export interface JourneyCompletedPayload {
  journeyId: string;
  routeId: string;
}

export interface ChildJourneyPayload {
  journeyId: string;
  routeId: string;
  childId: string;
  childFirstName: string;
  parentUserId: string;
}
