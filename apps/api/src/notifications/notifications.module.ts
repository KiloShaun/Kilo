import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { NOTIFICATION_CHANNEL_PROVIDER } from './providers/notification-channel-provider.interface';
import { InAppNotificationProvider } from './providers/in-app-notification.provider';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsListener,
    { provide: NOTIFICATION_CHANNEL_PROVIDER, useClass: InAppNotificationProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
