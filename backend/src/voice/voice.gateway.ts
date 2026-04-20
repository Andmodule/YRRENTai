import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { VoiceRealtimeService } from './voice-realtime.service';
import { VoiceHandoffService } from './voice-handoff.service';
import { VoiceSessionService } from './voice-session.service';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    email: string;
    role: string;
  };
}

@WebSocketGateway({
  namespace: '/calls',
  path: '/api/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class VoiceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly realtimeService: VoiceRealtimeService,
    private readonly handoffService: VoiceHandoffService,
    private readonly sessionService: VoiceSessionService,
  ) {}

  afterInit(): void {
    this.realtimeService.attachServer(this.server);
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new UnauthorizedException('No token');

      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });

      if (payload.typ === 'refresh' || !payload.sub) {
        throw new UnauthorizedException('Invalid token type');
      }

      client.data = { userId: payload.sub, email: payload.email, role: payload.role };
      // All authenticated clients join the operators room for broadcast
      await client.join('operators');
      this.logger.log(`Calls socket connected: ${client.id} (${payload.email})`);
    } catch (err) {
      this.logger.warn(`Calls connection rejected: ${(err as Error).message}`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.log(`Calls socket disconnected: ${client.id}`);
  }

  /** Subscribe to a specific call's events */
  @SubscribeMessage('call:join')
  async handleJoinCall(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { sessionId: string },
  ): Promise<void> {
    if (!body?.sessionId) {
      client.emit('error', { message: 'sessionId is required' });
      return;
    }
    await client.join(`call:${body.sessionId}`);
    this.logger.log(`Client ${client.id} joined call:${body.sessionId}`);

    // Send current session state on join
    const session = await this.sessionService.getSessionWithEvents(body.sessionId);
    if (session) {
      client.emit('call.updated', { sessionId: body.sessionId, session });
    }
  }

  @SubscribeMessage('call:leave')
  async handleLeaveCall(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { sessionId: string },
  ): Promise<void> {
    if (body?.sessionId) {
      await client.leave(`call:${body.sessionId}`);
    }
  }

  /** Operator initiates a takeover of the call */
  @SubscribeMessage('call:takeover')
  async handleTakeover(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { sessionId: string },
  ): Promise<void> {
    if (!body?.sessionId) {
      client.emit('error', { message: 'sessionId is required' });
      return;
    }
    try {
      await this.handoffService.operatorTakeover(body.sessionId, client.data.userId);
      client.emit('call:takeover:ack', { sessionId: body.sessionId, success: true });
    } catch (err) {
      this.logger.error(`Takeover failed: ${(err as Error).message}`);
      client.emit('error', { message: 'Takeover failed', detail: (err as Error).message });
    }
  }

  /** Operator accepts a pending handoff */
  @SubscribeMessage('call:handoff:accept')
  async handleHandoffAccept(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { handoffId: string },
  ): Promise<void> {
    if (!body?.handoffId) {
      client.emit('error', { message: 'handoffId is required' });
      return;
    }
    try {
      await this.handoffService.acceptHandoff(body.handoffId, client.data.userId);
      client.emit('call:handoff:accept:ack', { handoffId: body.handoffId, success: true });
    } catch (err) {
      this.logger.error(`Handoff accept failed: ${(err as Error).message}`);
      client.emit('error', { message: 'Handoff accept failed' });
    }
  }

  private extractToken(client: Socket): string | null {
    const cookieHeader = client.handshake.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/access_token=([^;]+)/);
      if (match?.[1]) return match[1];
    }
    const authHeader = client.handshake.auth?.token;
    if (typeof authHeader === 'string') return authHeader;
    return null;
  }
}
