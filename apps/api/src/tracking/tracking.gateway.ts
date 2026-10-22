import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma/prisma.service';
import { JourneysService } from '../journeys/journeys.service';
import { AccessTokenPayload } from '../auth/auth.types';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { LocationUpdatedPayload, TRACKING_LOCATION_UPDATED_EVENT } from './tracking.service';

/**
 * Pushes live GPS updates to parent/admin/driver clients watching a journey. Auth happens
 * per-subscription (not at socket handshake) so a single connection can watch several
 * journeys, each re-checked against the same visibility rules as GET /journeys/:id — see
 * JourneysService.findOneScoped.
 *
 * Single-process pub/sub via EventEmitter2 is sufficient for this deployment; scaling the API
 * horizontally would need a Redis adapter (socket.io-redis) subscribing to the same channel
 * TrackingService already writes through — see docs/architecture.md.
 */
@Injectable()
@WebSocketGateway({ namespace: '/tracking', cors: { origin: '*' } })
export class TrackingGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(TrackingGateway.name);
  private readonly subscriptions = new Map<string, Set<string>>(); // journeyId -> socket ids

  @WebSocketServer()
  private server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly journeysService: JourneysService,
  ) {}

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    client: Socket,
    data: { journeyId: string; token: string },
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const user = await this.authenticate(data.token);
      await this.journeysService.findOneScoped(data.journeyId, user);

      const room = `journey:${data.journeyId}`;
      await client.join(room);
      if (!this.subscriptions.has(room)) {
        this.subscriptions.set(room, new Set());
      }
      this.subscriptions.get(room)!.add(client.id);

      return { ok: true };
    } catch (error) {
      this.logger.warn(`Rejected tracking subscription: ${(error as Error).message}`);
      return { ok: false, error: 'Not authorized to watch this journey.' };
    }
  }

  handleDisconnect(client: Socket) {
    for (const sockets of this.subscriptions.values()) {
      sockets.delete(client.id);
    }
  }

  private async authenticate(token: string): Promise<AuthenticatedUser> {
    const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
      secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
    });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { parent: true, driver: true },
    });
    if (!user || !user.isActive) {
      throw new Error('Account is no longer active.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      parentId: user.parent?.id,
      driverId: user.driver?.id,
      schoolAdminSchoolId: user.schoolAdminSchoolId ?? undefined,
    };
  }

  @OnEvent(TRACKING_LOCATION_UPDATED_EVENT)
  handleLocationUpdated(payload: LocationUpdatedPayload) {
    this.server.to(`journey:${payload.journeyId}`).emit('location', payload);
  }
}
