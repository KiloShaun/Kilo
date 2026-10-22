import { Inject, Injectable } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { Paginated, PaginationQueryDto } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import {
  NOTIFICATION_CHANNEL_PROVIDER,
  NotificationChannelProvider,
} from './providers/notification-channel-provider.interface';

export interface SendNotificationInput {
  recipientUserId: string;
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATION_CHANNEL_PROVIDER)
    private readonly provider: NotificationChannelProvider,
  ) {}

  async send(input: SendNotificationInput) {
    const result = await this.provider.send({
      recipientUserId: input.recipientUserId,
      title: input.title,
      body: input.body,
      metadata: input.metadata,
    });

    return this.prisma.notification.create({
      data: {
        recipientUserId: input.recipientUserId,
        channel: NotificationChannel.PUSH,
        status: result.status,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        metadata: input.metadata as never,
        sentAt: new Date(),
        failureReason: result.failureReason,
      },
    });
  }

  async findAllForUser(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<Paginated<unknown>> {
    const where = { recipientUserId: user.id };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }
}
