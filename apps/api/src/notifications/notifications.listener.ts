import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import {
  ChildJourneyPayload,
  JourneyCompletedPayload,
  JourneyDelayedPayload,
  JourneyEvents,
  JourneyStartedPayload,
} from '../journeys/journey.events';
import { EmergencyEvents, EmergencyTriggeredPayload } from '../emergency/emergency.events';

/**
 * Translates domain events into in-app notifications. Kept separate from the services that
 * emit the events (JourneysService, EmergencyService) so neither needs to know who to notify
 * — see docs/architecture.md.
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async notifyParentsOnJourney(journeyId: string, title: string, body: string) {
    const childJourneys = await this.prisma.childJourney.findMany({
      where: { journeyId },
      include: { child: { include: { parent: true } } },
    });
    await Promise.all(
      childJourneys.map((cj) =>
        this.notifications.send({
          recipientUserId: cj.child.parent.userId,
          eventType: title,
          title,
          body,
          metadata: { journeyId, childId: cj.childId },
        }),
      ),
    );
  }

  @OnEvent(JourneyEvents.STARTED)
  async onJourneyStarted(payload: JourneyStartedPayload) {
    await this.notifyParentsOnJourney(
      payload.journeyId,
      'Route started',
      `The driver has started the "${payload.routeName}" route.`,
    );
  }

  @OnEvent(JourneyEvents.DELAYED)
  async onJourneyDelayed(payload: JourneyDelayedPayload) {
    await this.notifyParentsOnJourney(
      payload.journeyId,
      'Route delayed',
      `The driver reported a delay: ${payload.reason}`,
    );
  }

  @OnEvent(JourneyEvents.COMPLETED)
  async onJourneyCompleted(payload: JourneyCompletedPayload) {
    const route = await this.prisma.route.findUnique({ where: { id: payload.routeId } });
    if (!route) return;

    const schoolAdmins = await this.prisma.user.findMany({
      where: { schoolAdminSchoolId: route.schoolId, isActive: true },
    });
    await Promise.all(
      schoolAdmins.map((admin) =>
        this.notifications.send({
          recipientUserId: admin.id,
          eventType: 'Route completed',
          title: 'Route completed',
          body: `Route "${route.name}" has been completed.`,
          metadata: { journeyId: payload.journeyId, routeId: payload.routeId },
        }),
      ),
    );
  }

  @OnEvent(JourneyEvents.CHILD_PICKED_UP)
  async onChildPickedUp(payload: ChildJourneyPayload) {
    await this.notifications.send({
      recipientUserId: payload.parentUserId,
      eventType: 'Child picked up',
      title: 'Child picked up',
      body: `${payload.childFirstName} has been picked up and is on the vehicle.`,
      metadata: { journeyId: payload.journeyId, childId: payload.childId },
    });
  }

  @OnEvent(JourneyEvents.CHILD_DROPPED_OFF)
  async onChildDroppedOff(payload: ChildJourneyPayload) {
    await this.notifications.send({
      recipientUserId: payload.parentUserId,
      eventType: 'Child dropped off',
      title: 'Child dropped off',
      body: `${payload.childFirstName} has been dropped off safely.`,
      metadata: { journeyId: payload.journeyId, childId: payload.childId },
    });
  }

  @OnEvent(JourneyEvents.CHILD_MISSED_PICKUP)
  async onChildMissedPickup(payload: ChildJourneyPayload) {
    await this.notifications.send({
      recipientUserId: payload.parentUserId,
      eventType: 'Missed pickup',
      title: 'Missed pickup',
      body: `${payload.childFirstName} was not picked up as scheduled.`,
      metadata: { journeyId: payload.journeyId, childId: payload.childId },
    });
  }

  @OnEvent(EmergencyEvents.TRIGGERED)
  async onEmergencyTriggered(payload: EmergencyTriggeredPayload) {
    this.logger.warn(
      `Emergency incident ${payload.incidentId} triggered — notifying everyone affected.`,
    );

    const recipients = new Set<string>(payload.operatorUserIds);
    for (const parentUserId of payload.affectedParentUserIds) {
      recipients.add(parentUserId);
    }

    await Promise.all(
      Array.from(recipients).map((recipientUserId) =>
        this.notifications.send({
          recipientUserId,
          eventType: 'SOS triggered',
          title: 'SOS: Emergency reported',
          body: payload.note
            ? `An emergency was reported on a vehicle. ${payload.note}`
            : 'An emergency was reported on a vehicle.',
          metadata: { incidentId: payload.incidentId },
        }),
      ),
    );
  }
}
