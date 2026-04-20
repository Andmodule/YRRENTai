import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

/**
 * WebSocket gateway for real-time calendar updates.
 * After a booking change (webhook / sync / manual edit) emits `calendar.changed`
 * so the frontend invalidates its React Query cache immediately.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/calendar',
  path: '/api/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class CalendarGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CalendarGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new UnauthorizedException('No token');
      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });
      if (payload.typ === 'refresh' || !payload.sub) {
        throw new UnauthorizedException('Invalid token');
      }
      this.logger.log(`Calendar socket connected: ${client.id} (user: ${String(payload.email ?? payload.sub)})`);
    } catch (e) {
      this.logger.warn(`Calendar connection rejected: ${(e as Error).message}`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  /**
   * Notify all connected clients that calendar data has changed.
   * `propertyId` is optional — frontend always refetches all visible data.
   */
  emitCalendarChanged(payload: { propertyId?: string; source: string }): void {
    this.server.emit('calendar.changed', payload);
  }

  private extractToken(client: Socket): string | null {
    const cookieHeader = client.handshake.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/access_token=([^;]+)/);
      if (match?.[1]) return match[1];
    }
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string') return authToken;
    return null;
  }
}
