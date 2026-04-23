import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { IncidentManagerNoteEvent } from '../common/events/incident.events';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    email: string;
    role: string;
  };
}

@WebSocketGateway({
  namespace: '/tasks',
  path: '/api/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class TasksGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TasksGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        throw new UnauthorizedException('No token');
      }

      const secret = this.configService.get<string>('JWT_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });

      if (payload.typ === 'refresh' || !payload.sub) {
        throw new UnauthorizedException('Invalid token');
      }

      client.data = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      this.logger.log(`Tasks socket connected: ${client.id}`);
    } catch (error) {
      this.logger.warn(`Tasks connection rejected: ${(error as Error).message}`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  emitTaskUpdated(payload: { uuid: string; status: string }) {
    this.server.emit('task_updated', payload);
  }

  emitTaskNoteAdded(payload: { taskId: string; propertyOwnerId: string }) {
    this.server.emit('task_note_added', payload);
  }

  emitChecklistItemUpdated(payload: { taskId: string; itemId: string; checked: boolean }) {
    this.server.emit('checklist_item_updated', payload);
  }

  emitIncidentCreated(payload: { incidentId: string; propertyOwnerId: string }) {
    this.server.emit('incident_created', payload);
  }

  emitIncidentUpdated(payload: { incidentId: string; propertyOwnerId: string }) {
    this.server.emit('incident_updated', payload);
  }

  /** Staff text/voice interpretation finished or manager cleared an item — refresh supply queue without reload. */
  emitSupplyInterpretationsChanged() {
    this.server.emit('supply_interpretations_changed', {});
  }

  /** Manager assigned / reassigned driver on a delivery route — staff app refetches active route. */
  emitDeliveryRouteAssigned(payload: { routeId: string; driverUserId: string }) {
    this.server.emit('delivery_route_assigned', payload);
  }

  /** Остановка закрыта или маршрут завершён — список маршрутов водителя без перезагрузки страницы. */
  emitDeliveryRouteUpdated(payload: { routeId: string; driverUserId: string | null; status: string }) {
    this.server.emit('delivery_route_updated', payload);
  }

  /** Manager replied in Telegram (thread on incident alert) — staff app shows toast if reportedBy matches. */
  emitIncidentManagerNote(payload: {
    incidentId: string;
    text: string;
    reportedByUserId: string;
  }) {
    this.server.emit('incident_manager_note', payload);
  }

  @OnEvent('incident.manager_note')
  onIncidentManagerNoteFromTelegram(event: IncidentManagerNoteEvent): void {
    this.emitIncidentManagerNote({
      incidentId: event.incidentId,
      text: event.text,
      reportedByUserId: event.reportedByUserId,
    });
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
