import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { AgentService } from '../agent/agent.service';
import { PropertyService } from '../property/property.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { TelegramService } from '../telegram/telegram.service';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { sendChatMessageSchema } from '@rentai/shared';

const ESCALATION_MARKER = '[ESCALATE]';

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    email: string;
    role: string;
  };
}

@WebSocketGateway({
  namespace: '/chat',
  path: '/api/socket.io',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly agentService: AgentService,
    private readonly propertyService: PropertyService,
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly telegramService: TelegramService,
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

      this.logger.log(`Client connected: ${client.id} (user: ${payload.email})`);
    } catch (error) {
      this.logger.warn(`Connection rejected: ${(error as Error).message}`);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('message:send')
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ) {
    const parsed = sendChatMessageSchema.safeParse(body);
    if (!parsed.success) {
      client.emit('error', { message: 'Invalid message format', details: parsed.error.flatten() });
      return;
    }

    const { propertyId, content } = parsed.data;
    const userId = client.data.userId;

    try {
      await this.propertyService.findOne(propertyId, userId);
    } catch {
      client.emit('error', { message: 'Property not found or access denied' });
      return;
    }

    const userMessage = await this.chatService.saveMessage({
      propertyId,
      userId,
      content,
      role: 'user',
    });

    client.emit('message:saved', {
      id: userMessage.id,
      propertyId,
      content,
      role: 'user',
      source: 'ai',
      userId,
      createdAt: userMessage.createdAt.toISOString(),
    });

    const property = await this.propertyService.findOne(propertyId, userId);
    const kbEntries = await this.knowledgeBaseService.searchRelevant(propertyId, content, 8);
    const knowledgeBase = kbEntries.map((e) => `## ${e.title}\n${e.content}`).join('\n\n');
    const history = await this.chatService.getRecentHistory(propertyId);

    client.emit('agent:streamStart', { propertyId });

    await this.agentService.processMessageStream(
      property.name,
      knowledgeBase || 'No knowledge base entries yet.',
      content,
      history,
      {
        onChunk: (text) => {
          client.emit('agent:streamChunk', { propertyId, text });
        },
        onDone: async (fullText) => {
          const isEscalation = fullText.trimEnd().endsWith(ESCALATION_MARKER);
          const cleanText = isEscalation
            ? fullText.replace(new RegExp(`\\n?\\${ESCALATION_MARKER}$`), '').trim()
            : fullText;

          const agentMessage = await this.chatService.saveMessage({
            propertyId,
            content: cleanText,
            role: 'assistant',
            source: 'ai',
          });

          client.emit('agent:streamEnd', {
            id: agentMessage.id,
            propertyId,
            content: cleanText,
            role: 'assistant',
            source: 'ai',
            createdAt: agentMessage.createdAt.toISOString(),
          });

          if (isEscalation) {
            this.handleEscalation(propertyId, property.name, content, userMessage.id, property.ownerId).catch(
              (err) => this.logger.error(`Escalation failed: ${(err as Error).message}`),
            );
          }
        },
        onError: (error) => {
          client.emit('agent:error', {
            propertyId,
            message: error.message || 'Agent processing failed',
          });
        },
      },
    );
  }

  private async handleEscalation(
    propertyId: string,
    propertyName: string,
    guestQuestion: string,
    guestMessageId: string,
    ownerId: string,
  ): Promise<void> {
    const chatId = await this.telegramService.resolveAlertChatId(propertyId, ownerId);
    if (!chatId) {
      this.logger.warn(
        `Escalation for property ${propertyId} but no Telegram chat configured (property or account)`,
      );
      return;
    }

    await this.telegramService.sendEscalationAlert(
      propertyId,
      propertyName,
      guestQuestion,
      guestMessageId,
      chatId,
    );
  }

  @OnEvent('staff.replied')
  handleStaffReplied(event: StaffRepliedEvent) {
    this.server.to(`property:${event.propertyId}`).emit('agent:streamEnd', {
      id: event.messageId,
      propertyId: event.propertyId,
      content: event.content,
      role: 'assistant',
      source: 'staff',
      createdAt: event.createdAt,
    });
  }

  @SubscribeMessage('chat:join')
  async handleJoinChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { propertyId: string },
  ) {
    if (!body?.propertyId) {
      client.emit('error', { message: 'propertyId is required' });
      return;
    }

    try {
      await this.propertyService.findOne(body.propertyId, client.data.userId);
    } catch {
      client.emit('error', { message: 'Property not found or access denied' });
      return;
    }

    const room = `property:${body.propertyId}`;
    await client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);

    const { data } = await this.chatService.getMessages(body.propertyId, 1, 50);
    client.emit('chat:history', {
      propertyId: body.propertyId,
      messages: data.map((m) => ({
        id: m.id,
        propertyId: m.propertyId,
        userId: m.userId,
        content: m.content,
        role: m.role,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  @SubscribeMessage('chat:leave')
  async handleLeaveChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { propertyId: string },
  ) {
    if (body?.propertyId) {
      const room = `property:${body.propertyId}`;
      await client.leave(room);
      this.logger.log(`Client ${client.id} left room ${room}`);
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
