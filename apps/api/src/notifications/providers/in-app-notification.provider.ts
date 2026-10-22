import { Injectable } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import {
  NotificationChannelProvider,
  NotificationSendResult,
} from './notification-channel-provider.interface';

/**
 * The only channel genuinely implemented today: a notification "sends" by existing in the
 * recipient's GET /notifications feed. No external credentials (FCM/APNs/Twilio) are
 * required, so this always succeeds — real push/SMS/WhatsApp/email providers would call out
 * to their respective APIs here and can fail.
 */
@Injectable()
export class InAppNotificationProvider implements NotificationChannelProvider {
  async send(): Promise<NotificationSendResult> {
    return { status: NotificationStatus.SENT };
  }
}
