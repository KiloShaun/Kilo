import { NotificationStatus } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationChannelProvider } from './providers/notification-channel-provider.interface';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: { notification: { create: jest.Mock } };
  let provider: NotificationChannelProvider;

  beforeEach(() => {
    prisma = { notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) } };
    provider = { send: jest.fn().mockResolvedValue({ status: NotificationStatus.SENT }) };
    service = new NotificationsService(prisma as unknown as PrismaService, provider);
  });

  it('delegates to the channel provider and persists the result', async () => {
    await service.send({
      recipientUserId: 'user-1',
      eventType: 'Child picked up',
      title: 'Child picked up',
      body: 'Amy has been picked up.',
    });

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'user-1' }),
    );
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: NotificationStatus.SENT }),
      }),
    );
  });

  it('records a failure reason when the provider fails', async () => {
    (provider.send as jest.Mock).mockResolvedValue({
      status: NotificationStatus.FAILED,
      failureReason: 'No credentials configured',
    });

    await service.send({
      recipientUserId: 'user-1',
      eventType: 'Child picked up',
      title: 'Child picked up',
      body: 'Amy has been picked up.',
    });

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationStatus.FAILED,
          failureReason: 'No credentials configured',
        }),
      }),
    );
  });
});
