import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * Bridges Socket.IO server to injectable services (avoids circular ChatGateway ↔ pipeline deps).
 */
@Injectable()
export class ChatRealtimeService {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private server: Server | null = null;

  attachServer(server: Server): void {
    this.server = server;
    this.logger.log('Socket.IO attached for inbox/property realtime');
  }

  private ensure(): Server {
    if (!this.server) {
      throw new Error('ChatRealtimeService: server not attached');
    }
    return this.server;
  }

  emitToInbox(propertyId: string, event: string, payload: unknown): void {
    this.ensure().to(`inbox:${propertyId}`).emit(event, payload);
  }

  emitToProperty(propertyId: string, event: string, payload: unknown): void {
    this.ensure().to(`property:${propertyId}`).emit(event, payload);
  }
}
