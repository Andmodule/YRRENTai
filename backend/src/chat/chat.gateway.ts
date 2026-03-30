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
import { ConversationService } from './conversation.service';
import { AgentService } from '../agent/agent.service';
import { PropertyService } from '../property/property.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { TelegramService } from '../telegram/telegram.service';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { sendChatMessageSchema } from '@rentai/shared';
import {
  GUEST_ESCALATION_FALLBACK_MESSAGE,
  parseAssistantEscalation,
  shouldForceEscalationGuestReply,
} from '../agent/constants/agent-prompts';

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
    private readonly conversationService: ConversationService,
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

    const { propertyId, content, conversationId: bodyConversationId, guestSessionKey } = parsed.data;
    const userId = client.data.userId;

    try {
      await this.propertyService.findOne(propertyId, userId);
    } catch {
      client.emit('error', { message: 'Property not found or access denied' });
      return;
    }

    let conversation;
    if (bodyConversationId) {
      const conv = await this.conversationService.findById(bodyConversationId);
      if (conv.propertyId !== propertyId) {
        client.emit('error', { message: 'Conversation does not match property' });
        return;
      }
      conversation = conv;
    } else {
      conversation = await this.conversationService.findOrCreate(propertyId, 'web_app', guestSessionKey);
    }

    if (conversation.status === 'resolved') {
      await this.conversationService.setStatus(conversation.id, 'ai_handling');
      conversation = await this.conversationService.findById(conversation.id);
    }

    const userMessage = await this.chatService.saveMessage({
      propertyId,
      conversationId: conversation.id,
      userId,
      content,
      role: 'user',
    });

    await this.conversationService.touch(conversation.id, content);

    const msgPayload = {
      id: userMessage.id,
      propertyId,
      conversationId: conversation.id,
      content,
      role: 'user',
      source: 'ai',
      userId,
      createdAt: userMessage.createdAt.toISOString(),
    };

    client.emit('message:saved', msgPayload);
    this.server.to(`inbox:${conversation.propertyId}`).emit('conversation:updated', {
      conversationId: conversation.id,
      lastMessagePreview: content.slice(0, 200),
      lastActivityAt: userMessage.createdAt.toISOString(),
      status: conversation.status,
    });

    const property = await this.propertyService.findOne(propertyId, userId);
    const kbSearch = await this.knowledgeBaseService.searchRelevant(propertyId, content, 8);
    const { entries: kbEntries, isWeakMatch: kbWeakMatch } = kbSearch;
    const knowledgeBase = kbWeakMatch
      ? ''
      : kbEntries.map((e) => `## ${e.title}\n${e.content}`).join('\n\n');
    const kbContextForAgent = kbWeakMatch
      ? '(No sufficiently relevant knowledge base match for this question — do not invent facts; you MUST escalate: short message to the guest, then [ESCALATE] on a new line.)'
      : knowledgeBase || 'No knowledge base entries yet.';
    const history = await this.chatService.getRecentHistory(propertyId, 20, conversation.id);

    client.emit('agent:streamStart', { propertyId, conversationId: conversation.id });

    await this.agentService.processMessageStream(
      property.name,
      kbContextForAgent,
      content,
      history,
      {
        onChunk: (text) => {
          client.emit('agent:streamChunk', { propertyId, conversationId: conversation.id, text });
        },
        onDone: async (fullText) => {
          const { rawEndsEscalate, textWithoutMarker } = parseAssistantEscalation(fullText);

          const kbEmpty = kbEntries.length === 0;
          const kbHasReliableMatch = kbEntries.length > 0 && !kbWeakMatch;
          const forcedByForbidden = shouldForceEscalationGuestReply(textWithoutMarker);

          /** Staff / Telegram: any explicit escalation or missing KB / weak KB / forbidden wording. */
          const notifyStaff =
            kbEmpty || forcedByForbidden || kbWeakMatch || rawEndsEscalate;

          /**
           * Guest-facing text: legacy rules — when the model escalated but KB still had a strong match,
           * we only strip `[ESCALATE]` and show the model reply (same as before). Staff may still be
           * notified via `notifyStaff` so Telegram is not silent.
           */
          const guestEscalationUi =
            kbEmpty || forcedByForbidden || kbWeakMatch || (rawEndsEscalate && !kbHasReliableMatch);

          let cleanText: string;
          if (!guestEscalationUi) {
            cleanText = textWithoutMarker;
          } else if (rawEndsEscalate && !forcedByForbidden) {
            cleanText = textWithoutMarker || GUEST_ESCALATION_FALLBACK_MESSAGE;
          } else {
            cleanText = GUEST_ESCALATION_FALLBACK_MESSAGE;
          }

          if (!cleanText.trim()) {
            cleanText = GUEST_ESCALATION_FALLBACK_MESSAGE;
          }

          const agentMessage = await this.chatService.saveMessage({
            propertyId,
            conversationId: conversation.id,
            content: cleanText,
            role: 'assistant',
            source: 'ai',
          });

          await this.conversationService.touch(conversation.id, cleanText);

          client.emit('agent:streamEnd', {
            id: agentMessage.id,
            propertyId,
            conversationId: conversation.id,
            content: cleanText,
            role: 'assistant',
            source: 'ai',
            createdAt: agentMessage.createdAt.toISOString(),
          });

          if (notifyStaff) {
            await this.conversationService.setStatus(conversation.id, 'needs_human');
            this.server.to(`inbox:${propertyId}`).emit('conversation:updated', {
              conversationId: conversation.id,
              status: 'needs_human',
              lastMessagePreview: cleanText.slice(0, 200),
              lastActivityAt: agentMessage.createdAt.toISOString(),
            });
            this.handleEscalation(propertyId, property.name, content, userMessage.id, property.ownerId, conversation.id).catch(
              (err) => this.logger.error(`Escalation failed: ${(err as Error).message}`),
            );
          }
        },
        onError: (error) => {
          client.emit('agent:error', {
            propertyId,
            conversationId: conversation.id,
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
    conversationId?: string,
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
      conversationId,
    );
  }

  @OnEvent('staff.replied')
  async handleStaffReplied(event: StaffRepliedEvent) {
    this.server.to(`property:${event.propertyId}`).emit('agent:streamEnd', {
      id: event.messageId,
      propertyId: event.propertyId,
      conversationId: event.conversationId,
      content: event.content,
      role: 'assistant',
      source: 'staff',
      createdAt: event.createdAt,
    });

    if (event.conversationId) {
      await this.conversationService.setStatus(event.conversationId, 'resolved');
      await this.conversationService.touch(event.conversationId, event.content);
      this.server.to(`inbox:${event.propertyId}`).emit('conversation:updated', {
        conversationId: event.conversationId,
        status: 'resolved',
        lastMessagePreview: event.content.slice(0, 200),
        lastActivityAt: event.createdAt,
      });
    }
  }

  @SubscribeMessage('chat:join')
  async handleJoinChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { propertyId: string; conversationId?: string },
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
    await client.join(`inbox:${body.propertyId}`);
    this.logger.log(`Client ${client.id} joined room ${room}`);

    let conversation;
    if (body.conversationId) {
      const conv = await this.conversationService.findById(body.conversationId);
      if (conv.propertyId !== body.propertyId) {
        client.emit('error', { message: 'Conversation does not match property' });
        return;
      }
      conversation = conv;
    } else {
      conversation = await this.conversationService.findOrCreate(body.propertyId, 'web_app');
    }

    const { data } = await this.chatService.getMessages(body.propertyId, 1, 50, conversation.id);
    client.emit('chat:history', {
      propertyId: body.propertyId,
      conversationId: conversation.id,
      status: conversation.status,
      messages: data.map((m) => ({
        id: m.id,
        propertyId: m.propertyId,
        conversationId: m.conversationId,
        userId: m.userId,
        content: m.content,
        role: m.role,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  @SubscribeMessage('inbox:subscribe')
  async handleInboxSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { propertyIds: string[] },
  ) {
    if (!Array.isArray(body?.propertyIds)) {
      client.emit('error', { message: 'propertyIds[] is required' });
      return;
    }
    for (const pid of body.propertyIds) {
      await client.join(`inbox:${pid}`);
    }
    this.logger.log(`Client ${client.id} subscribed to inbox rooms: ${body.propertyIds.length}`);
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
