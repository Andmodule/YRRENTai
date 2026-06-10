import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { forwardRef, Inject, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { conversationChannelToMessageChannel } from './chat-channel.mapper';
import { BookingComMetadataService } from './booking-com-metadata.service';
import { ConversationService } from './conversation.service';
import { PropertyService } from '../property/property.service';
import { MessagingService } from '../messaging/messaging.service';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { sendChatMessageSchema, listPreviewForInbox } from '@rentai/shared';
import { ChatRealtimeService } from './chat-realtime.service';
import { GuestAiPipelineService } from './guest-ai-pipeline.service';

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
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly bookingComMetadataService: BookingComMetadataService,
    private readonly conversationService: ConversationService,
    private readonly propertyService: PropertyService,
    private readonly chatRealtime: ChatRealtimeService,
    private readonly guestAiPipeline: GuestAiPipelineService,
    @Inject(forwardRef(() => MessagingService))
    private readonly messagingService: MessagingService,
  ) {}

  afterInit(): void {
    this.chatRealtime.attachServer(this.server);
  }

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
      await this.propertyService.findOneForUser(propertyId, userId, client.data.role);
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

    const bookingMeta = await this.bookingComMetadataService.buildForUserMessage(
      conversation.id,
      content,
    );

    const userMessage = await this.chatService.saveMessage({
      propertyId,
      conversationId: conversation.id,
      userId,
      content,
      role: 'user',
      metadata: bookingMeta ?? undefined,
      channel: conversationChannelToMessageChannel(conversation.channel),
    });

    const listPreview = listPreviewForInbox(content, bookingMeta);

    await this.conversationService.touch(conversation.id, listPreview);

    const msgPayload = {
      ...this.chatService.toSocketPayload(userMessage),
      conversationId: conversation.id,
    };

    client.emit('message:saved', msgPayload);
    /** Инбокс менеджера: иначе новый текст гостя виден только после refetch по conversation:updated (задержка / кэш). */
    this.chatRealtime.emitToInbox(conversation.propertyId, 'message:saved', msgPayload);
    this.chatRealtime.emitToInbox(conversation.propertyId, 'conversation:updated', {
      conversationId: conversation.id,
      lastMessagePreview: listPreview.slice(0, 200),
      lastActivityAt: userMessage.createdAt.toISOString(),
      status: conversation.status,
    });

    const property = await this.propertyService.findOneForUser(propertyId, userId, client.data.role);
    try {
      await this.guestAiPipeline.runAfterGuestUserMessage({
        property: { id: property.id, name: property.name, ownerId: property.ownerId },
        conversation,
        userMessage,
        content,
        listPreview,
        streamClient: client,
        guestReplyChannel: 'web_socket',
      });
    } catch (err) {
      this.logger.error(
        `Guest AI pipeline failed conv=${conversation.id}`,
        err as Error,
      );
      client.emit('agent:error', {
        propertyId,
        conversationId: conversation.id,
        message: (err as Error).message || 'AI reply failed',
      });
    }
  }

  /**
   * Только Socket.IO — состояние диалога уже обновил StaffReplyService (иначе дубль + риск ошибки до emit).
   */
  emitStaffReplyToSockets(event: StaffRepliedEvent): void {
    const cid = event.conversationId ? event.conversationId.toLowerCase() : undefined;
    const msgPayload = {
      id: event.messageId,
      propertyId: event.propertyId,
      conversationId: cid,
      content: event.content,
      role: 'assistant' as const,
      source: 'staff' as const,
      userId: null,
      createdAt: event.createdAt,
      ...(event.channel !== undefined ? { channel: event.channel } : {}),
      ...(event.deliveryStatus !== undefined ? { deliveryStatus: event.deliveryStatus } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };

    this.chatRealtime.emitToProperty(event.propertyId, 'agent:streamEnd', msgPayload);
    this.chatRealtime.emitToProperty(event.propertyId, 'message:saved', msgPayload);

    if (event.conversationId) {
      const convUpd = {
        conversationId: cid,
        status: 'resolved' as const,
        lastMessagePreview: event.content.slice(0, 200),
        lastActivityAt: event.createdAt,
      };

      this.chatRealtime.emitToInbox(event.propertyId, 'conversation:updated', convUpd);
      this.chatRealtime.emitToProperty(event.propertyId, 'conversation:updated', convUpd);

      this.chatRealtime.emitToInbox(event.propertyId, 'message:saved', msgPayload);
    }
  }

  emitMessageDeliveryStatus(payload: {
    propertyId: string;
    conversationId?: string;
    messageId: string;
    deliveryStatus: string;
    channel: string;
  }): void {
    const base = {
      propertyId: payload.propertyId,
      messageId: payload.messageId,
      status: payload.deliveryStatus,
      channel: payload.channel,
      conversationId: payload.conversationId,
    };
    this.chatRealtime.emitToProperty(payload.propertyId, 'message_status_updated', base);
    this.chatRealtime.emitToInbox(payload.propertyId, 'message_status_updated', base);
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
      await this.propertyService.findOneForUser(
        body.propertyId,
        client.data.userId,
        client.data.role,
      );
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

    const { data } = await this.chatService.getLastMessagesForConversation(
      body.propertyId,
      conversation.id,
      100,
    );
    client.emit('chat:history', {
      propertyId: body.propertyId,
      conversationId: conversation.id,
      status: conversation.status,
      messages: data.map((m) => ({
        ...this.chatService.toSocketPayload(m),
        conversationId: m.conversationId,
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

  @SubscribeMessage('join_messaging_thread')
  async handleJoinMessagingThread(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const threadId =
      typeof body === 'string' ? body : (body as { threadId?: string })?.threadId;
    if (typeof threadId !== 'string' || !threadId) {
      client.emit('error', { message: 'threadId is required' });
      return;
    }
    try {
      await this.messagingService.assertThreadOwnedBy(threadId, client.data.userId);
    } catch {
      client.emit('error', { message: 'Thread not found or access denied' });
      return;
    }
    await client.join(`messaging:${threadId}`);
    this.logger.log(`Client ${client.id} joined messaging:${threadId}`);
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
