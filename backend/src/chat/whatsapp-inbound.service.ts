import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CONVERSATION_CHANNEL } from '@rentai/shared';
import { PropertyEntity } from '../property/entities/property.entity';
import { PropertyService } from '../property/property.service';
import { TelegramService } from '../telegram/telegram.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { GuestAiPipelineService } from './guest-ai-pipeline.service';
import { WhatsappProcessedMessageEntity } from './entities/whatsapp-processed-message.entity';
import { MessageChannel } from './enums/message-channel.enum';

export interface WaInboundParsed {
  phoneNumberId: string;
  wamid: string;
  fromDigits: string;
  text: string;
  guestProfileName?: string;
}

@Injectable()
export class WhatsappInboundService {
  private readonly logger = new Logger(WhatsappInboundService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly propertyService: PropertyService,
    private readonly conversationService: ConversationService,
    private readonly chatService: ChatService,
    private readonly chatRealtime: ChatRealtimeService,
    private readonly guestAiPipeline: GuestAiPipelineService,
    private readonly telegramService: TelegramService,
    @InjectRepository(WhatsappProcessedMessageEntity)
    private readonly dedupRepo: Repository<WhatsappProcessedMessageEntity>,
  ) {}

  /**
   * Fire-and-forget from webhook: persist, realtime, optional AI (same rules as web guest chat).
   */
  async processWebhookPayload(body: unknown): Promise<void> {
    const parsed = this.extractFirstInboundMessage(body);
    if (!parsed) {
      return;
    }

    const firstInsert = await this.tryInsertDedup(parsed.wamid);
    if (!firstInsert) {
      this.logger.debug(`WhatsApp dedup skip wamid=${parsed.wamid}`);
      return;
    }

    const property = await this.propertyService.findByWhatsappPhoneNumberId(parsed.phoneNumberId);
    if (!property) {
      this.logger.warn(`WhatsApp: no property for phone_number_id=${parsed.phoneNumberId}`);
      return;
    }

    await this.ingestMessage(property, parsed);
  }

  private async tryInsertDedup(wamid: string): Promise<boolean> {
    try {
      await this.dedupRepo.insert({ wamid });
      return true;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === '23505') {
        return false;
      }
      throw e;
    }
  }

  private extractFirstInboundMessage(body: unknown): WaInboundParsed | null {
    const b = body as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          value?: {
            metadata?: { phone_number_id?: string };
            messages?: Array<{
              id?: string;
              from?: string;
              type?: string;
              text?: { body?: string };
            }>;
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
          };
        }>;
      }>;
    };
    if (b.object !== 'whatsapp_business_account' || !Array.isArray(b.entry) || !b.entry.length) {
      return null;
    }
    const entry = b.entry[0];
    const change = entry?.changes?.[0]?.value;
    if (!change?.messages?.length) {
      return null;
    }
    const msg = change.messages[0];
    if (!msg) {
      return null;
    }
    if (msg.type !== 'text' || !msg.text?.body?.trim()) {
      this.logger.warn(`WhatsApp: unsupported or empty message type=${msg.type ?? '?'}`);
      return null;
    }
    const phoneNumberId = change.metadata?.phone_number_id?.trim();
    const wamid = msg.id?.trim();
    const fromDigits = (msg.from ?? change.contacts?.[0]?.wa_id ?? '').replace(/\D/g, '');
    if (!phoneNumberId || !wamid || !fromDigits) {
      return null;
    }
    const guestProfileName = change.contacts?.[0]?.profile?.name?.trim();
    return {
      phoneNumberId,
      wamid,
      fromDigits,
      text: msg.text.body.trim(),
      guestProfileName,
    };
  }

  private async ingestMessage(property: PropertyEntity, parsed: WaInboundParsed): Promise<void> {
    const externalGuestKey = `wa:${parsed.fromDigits}`;
    let conversation = await this.conversationService.findOrCreate(
      property.id,
      CONVERSATION_CHANNEL.WHATSAPP,
      externalGuestKey,
    );

    if (parsed.guestProfileName) {
      await this.conversationService.setGuestDisplayName(conversation.id, parsed.guestProfileName);
      conversation = await this.conversationService.findById(conversation.id);
    }

    if (conversation.status === 'resolved') {
      await this.conversationService.setStatus(conversation.id, 'ai_handling');
      conversation = await this.conversationService.findById(conversation.id);
    }

    const userMessage = await this.chatService.saveMessage({
      propertyId: property.id,
      conversationId: conversation.id,
      content: parsed.text,
      role: 'user',
      channel: MessageChannel.WHATSAPP,
    });

    const listPreview = parsed.text.slice(0, 200);
    await this.conversationService.touch(conversation.id, listPreview);

    const msgPayload = {
      ...this.chatService.toSocketPayload(userMessage),
      conversationId: conversation.id,
    };
    this.chatRealtime.emitToInbox(property.id, 'message:saved', msgPayload);
    this.chatRealtime.emitToInbox(property.id, 'conversation:updated', {
      conversationId: conversation.id,
      lastMessagePreview: listPreview.slice(0, 200),
      lastActivityAt: userMessage.createdAt.toISOString(),
      status: conversation.status,
    });

    const aiOn = this.configService.get<boolean>('INBOUND_WHATSAPP_AI_ENABLED', true);

    if (!aiOn) {
      await this.conversationService.setStatus(conversation.id, 'needs_human');
      this.chatRealtime.emitToInbox(property.id, 'conversation:updated', {
        conversationId: conversation.id,
        status: 'needs_human',
        lastMessagePreview: listPreview.slice(0, 200),
        lastActivityAt: new Date().toISOString(),
      });
      void this.telegramService.sendEscalationIfConfigured({
        propertyId: property.id,
        ownerId: property.ownerId,
        propertyName: property.name,
        guestQuestion: listPreview,
        guestMessageId: userMessage.id,
        conversationId: conversation.id,
      });
      return;
    }

    const prop = await this.propertyService.findByIdBare(property.id);
    if (!prop) return;

    await this.guestAiPipeline.runAfterGuestUserMessage({
      property: { id: prop.id, name: prop.name, ownerId: prop.ownerId },
      conversation,
      userMessage,
      content: parsed.text,
      listPreview,
      streamClient: null,
      guestReplyChannel: 'whatsapp',
    });
  }
}
