import { NotificationsListener } from './notifications.listener';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsListener', () => {
  let listener: NotificationsListener;
  let prisma: {
    childJourney: { findMany: jest.Mock };
    route: { findUnique: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let notifications: { send: jest.Mock };

  beforeEach(() => {
    prisma = {
      childJourney: { findMany: jest.fn() },
      route: { findUnique: jest.fn() },
      user: { findMany: jest.fn() },
    };
    notifications = { send: jest.fn().mockResolvedValue({}) };
    listener = new NotificationsListener(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('notifies every parent on the journey when it starts', async () => {
    prisma.childJourney.findMany.mockResolvedValue([
      { childId: 'child-1', child: { parent: { userId: 'parent-user-1' } } },
      { childId: 'child-2', child: { parent: { userId: 'parent-user-2' } } },
    ]);

    await listener.onJourneyStarted({
      journeyId: 'journey-1',
      routeId: 'route-1',
      routeName: 'Route 1',
      driverId: 'driver-1',
    });

    expect(notifications.send).toHaveBeenCalledTimes(2);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'parent-user-1' }),
    );
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'parent-user-2' }),
    );
  });

  it('notifies the picked-up child directly without a database lookup', async () => {
    await listener.onChildPickedUp({
      journeyId: 'journey-1',
      routeId: 'route-1',
      childId: 'child-1',
      childFirstName: 'Amy',
      parentUserId: 'parent-user-1',
    });

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'parent-user-1', title: 'Child picked up' }),
    );
  });

  it('notifies school admins when a journey completes', async () => {
    prisma.route.findUnique.mockResolvedValue({
      id: 'route-1',
      schoolId: 'school-1',
      name: 'Route 1',
    });
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

    await listener.onJourneyCompleted({ journeyId: 'journey-1', routeId: 'route-1' });

    expect(notifications.send).toHaveBeenCalledTimes(2);
  });

  it('fans out an SOS notification to operators and affected parents, de-duplicated', async () => {
    await listener.onEmergencyTriggered({
      incidentId: 'incident-1',
      operatorUserIds: ['op-1', 'op-2'],
      affectedParentUserIds: ['op-1', 'parent-1'],
      note: null,
    });

    expect(notifications.send).toHaveBeenCalledTimes(3);
  });
});
