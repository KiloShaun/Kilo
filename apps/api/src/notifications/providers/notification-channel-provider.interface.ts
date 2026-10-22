import { NotificationStatus } from '@prisma/client';

export interface NotificationSendRequest {
  recipientUserId: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationSendResult {
  status: NotificationStatus;
  failureReason?: string;
}

/**
 * Every delivery channel (in-app feed, push, SMS, WhatsApp, email) implements this. The MVP
 * only wires up the in-app provider below — adding push/SMS/WhatsApp/email later means
 * implementing this interface and binding it under NOTIFICATION_CHANNEL_PROVIDER for that
 * channel, not changing NotificationsService. See docs/architecture.md.
 */
export const NOTIFICATION_CHANNEL_PROVIDER = 'NOTIFICATION_CHANNEL_PROVIDER';

export interface NotificationChannelProvider {
  send(request: NotificationSendRequest): Promise<NotificationSendResult>;
}
