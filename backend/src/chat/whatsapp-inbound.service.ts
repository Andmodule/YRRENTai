import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CONVERSATION_CHANNEL } from '@rentai/shared';
import type { WhatsappInboundMessageMetadata, WhatsappWaType } from '@rentai/shared';
import { PropertyEntity } from '../property/entities/property.entity';
import { PropertyService } from '../property/property.service';
import { TelegramService } from '../telegram/telegram.service';
import { StorageService } from '../modules/storage/storage.service';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { GuestAiPipelineService } from './guest-ai-pipeline.service';
import { WhatsappProcessedMessageEntity } from './entities/whatsapp-processed-message.entity';
import { MessageChannel } from './enums/message-channel.enum';
import { WhatsappCloudApiService } from './whatsapp-cloud-api.service';

interface WaExtractResult {
  phoneNumberId: string;
  wamid: string;
  fromDigits: string;
  guestProfileName?: string;
  waType: WhatsappWaType;
  rawWaType: string;
  displayContent: string;
  /** Non-empty → run guest AI pipeline (same as text chat). */
  aiInput: string;
  metadata: WhatsappInboundMessageMetadata;
  mediaId?: string;
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
    private readonly whatsappCloudApi: WhatsappCloudApiService,
    private readonly storageService: StorageService,
    @InjectRepository(WhatsappProcessedMessageEntity)
    private readonly dedupRepo: Repository<WhatsappProcessedMessageEntity>,
  ) {}

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

  private extractFirstInboundMessage(body: unknown): WaExtractResult | null {
    const b = body as {
      object?: string;
      entry?: Array<{
        changes?: Array<{
          value?: {
            metadata?: { phone_number_id?: string };
            messages?: unknown[];
            contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
          };
        }>;
      }>;
    };
    if (b.object !== 'whatsapp_business_account' || !Array.isArray(b.entry) || !b.entry.length) {
      return null;
    }
    const change = b.entry[0]?.changes?.[0]?.value;
    if (!change?.messages?.length) {
      return null;
    }
    const msg = change.messages[0] as Record<string, unknown> & {
      id?: string;
      from?: string;
      type?: string;
      text?: { body?: string };
    };
    if (!msg || typeof msg !== 'object') {
      return null;
    }

    const phoneNumberId = change.metadata?.phone_number_id?.trim();
    const wamid = typeof msg.id === 'string' ? msg.id.trim() : '';
    const fromDigits = (typeof msg.from === 'string' ? msg.from : change.contacts?.[0]?.wa_id ?? '')
      .replace(/\D/g, '');
    if (!phoneNumberId || !wamid || !fromDigits) {
      return null;
    }

    const guestProfileName = change.contacts?.[0]?.profile?.name?.trim();
    const rawType = typeof msg.type === 'string' ? msg.type : 'unknown';

    const built = this.buildExtractFromMessage(msg, rawType);
    if (!built) {
      return null;
    }

    return {
      phoneNumberId,
      wamid,
      fromDigits,
      guestProfileName,
      waType: built.waType,
      rawWaType: rawType,
      displayContent: built.displayContent,
      aiInput: built.aiInput,
      metadata: {
        channel: 'whatsapp_inbound',
        waType: built.waType,
        rawWaType: built.waType === 'unsupported' ? rawType : undefined,
        ...built.metadataExtras,
      },
      mediaId: built.mediaId,
    };
  }

  private buildExtractFromMessage(
    msg: Record<string, unknown>,
    rawType: string,
  ): {
    waType: WhatsappWaType;
    displayContent: string;
    aiInput: string;
    metadataExtras: Partial<WhatsappInboundMessageMetadata>;
    mediaId?: string;
  } | null {
    const t = rawType.toLowerCase();

    if (t === 'text') {
      const body = (msg.text as { body?: string } | undefined)?.body?.trim() ?? '';
      if (!body) {
        return null;
      }
      return {
        waType: 'text',
        displayContent: body,
        aiInput: body,
        metadataExtras: {},
      };
    }

    if (t === 'image') {
      const im = msg.image as { id?: string; caption?: string } | undefined;
      const id = im?.id?.trim();
      const cap = im?.caption?.trim() ?? '';
      const display = cap || '📷 Photo';
      return {
        waType: 'image',
        displayContent: display,
        aiInput: cap,
        mediaId: id,
        metadataExtras: { caption: cap || undefined, waMediaId: id },
      };
    }

    if (t === 'audio') {
      const aud = msg.audio as { id?: string } | undefined;
      const id = aud?.id?.trim();
      return {
        waType: 'audio',
        displayContent: '🎤 Voice message',
        aiInput: '',
        mediaId: id,
        metadataExtras: { waMediaId: id },
      };
    }

    if (t === 'video') {
      const vid = msg.video as { id?: string; caption?: string } | undefined;
      const id = vid?.id?.trim();
      const cap = vid?.caption?.trim() ?? '';
      const display = cap || '📹 Video';
      return {
        waType: 'video',
        displayContent: display,
        aiInput: cap,
        mediaId: id,
        metadataExtras: { caption: cap || undefined, waMediaId: id },
      };
    }

    if (t === 'document') {
      const doc = msg.document as { id?: string; caption?: string; filename?: string } | undefined;
      const id = doc?.id?.trim();
      const fn = doc?.filename?.trim() || 'file';
      const cap = doc?.caption?.trim() ?? '';
      const display = cap ? `${fn}: ${cap}` : `📄 ${fn}`;
      return {
        waType: 'document',
        displayContent: display,
        aiInput: cap || `Guest sent a document: ${fn}`,
        mediaId: id,
        metadataExtras: {
          caption: cap || undefined,
          fileName: fn,
          waMediaId: id,
        },
      };
    }

    if (t === 'sticker') {
      const st = msg.sticker as { id?: string } | undefined;
      const id = st?.id?.trim();
      return {
        waType: 'sticker',
        displayContent: '🎨 Sticker',
        aiInput: '',
        mediaId: id,
        metadataExtras: { waMediaId: id },
      };
    }

    if (t === 'location') {
      const loc = msg.location as {
        latitude?: number;
        longitude?: number;
        name?: string;
        address?: string;
      } | undefined;
      const lat = loc?.latitude;
      const lng = loc?.longitude;
      const name = loc?.name?.trim();
      const address = loc?.address?.trim();
      const parts = [name, address, lat != null && lng != null ? `${lat}, ${lng}` : ''].filter(Boolean);
      const display = `📍 ${parts.join(' · ') || 'Location'}`;
      const aiLine = parts.join('. ');
      return {
        waType: 'location',
        displayContent: display,
        aiInput: aiLine,
        metadataExtras: {
          latitude: lat,
          longitude: lng,
          locationName: name,
          locationAddress: address,
        },
      };
    }

    if (t === 'contacts') {
      const contacts = msg.contacts as Array<{
        name?: { formatted_name?: string };
        phones?: Array<{ phone?: string }>;
      }> | undefined;
      const lines: string[] = [];
      for (const c of contacts ?? []) {
        const nm = c.name?.formatted_name?.trim();
        const ph = c.phones?.map((p) => p.phone).filter(Boolean).join(', ');
        if (nm || ph) {
          lines.push([nm, ph].filter(Boolean).join(' — '));
        }
      }
      const summary = lines.length ? lines.join('; ') : '👤 Contact card';
      return {
        waType: 'contacts',
        displayContent: summary,
        aiInput: summary,
        metadataExtras: {},
      };
    }

    if (t === 'interactive') {
      const iv = msg.interactive as {
        type?: string;
        button_reply?: { title?: string; id?: string };
        list_reply?: { title?: string; id?: string };
        nfm_reply?: { body?: string; name?: string };
      } | undefined;
      const title =
        iv?.button_reply?.title?.trim() ||
        iv?.list_reply?.title?.trim() ||
        iv?.nfm_reply?.body?.trim() ||
        iv?.nfm_reply?.name?.trim() ||
        '';
      if (!title) {
        return {
          waType: 'interactive',
          displayContent: '[Interactive reply]',
          aiInput: '',
          metadataExtras: {},
        };
      }
      return {
        waType: 'interactive',
        displayContent: title,
        aiInput: title,
        metadataExtras: {},
      };
    }

    if (t === 'button') {
      const btn = msg.button as { text?: string } | undefined;
      const tx = btn?.text?.trim() || '[Button]';
      return {
        waType: 'button',
        displayContent: tx,
        aiInput: tx,
        metadataExtras: {},
      };
    }

    if (t === 'reaction') {
      const rx = msg.reaction as { emoji?: string; message_id?: string } | undefined;
      const em = rx?.emoji?.trim() || '❔';
      const mid = rx?.message_id?.trim();
      return {
        waType: 'reaction',
        displayContent: `Reaction: ${em}`,
        aiInput: '',
        metadataExtras: {
          reactionEmoji: em,
          reactionMessageId: mid,
        },
      };
    }

    if (t === 'order') {
      return {
        waType: 'order',
        displayContent: '🛒 Order message',
        aiInput: '',
        metadataExtras: {},
      };
    }

    if (t === 'system') {
      return {
        waType: 'system',
        displayContent: '[System]',
        aiInput: '',
        metadataExtras: {},
      };
    }

    return {
      waType: 'unsupported',
      displayContent: `[WhatsApp: ${rawType}]`,
      aiInput: '',
      metadataExtras: { rawWaType: rawType },
    };
  }

  private async attachMediaToMetadata(
    property: PropertyEntity,
    base: WhatsappInboundMessageMetadata,
    mediaId: string | undefined,
  ): Promise<WhatsappInboundMessageMetadata> {
    if (!mediaId?.trim()) {
      return base;
    }
    const id = mediaId.trim();
    const withId: WhatsappInboundMessageMetadata = { ...base, waMediaId: id };
    if (!this.storageService.isConfigured()) {
      this.logger.warn(
        `WhatsApp media ${id}: R2 not configured — message saved without file (set R2_* env).`,
      );
      return withId;
    }
    try {
      const { buffer, mimeType, fileName } = await this.whatsappCloudApi.fetchMediaBinary(property.id, id);
      const { key } = await this.storageService.uploadAttachment(buffer, fileName, mimeType);
      return {
        ...withId,
        storageKey: key,
        mimeType,
        fileName,
        sizeBytes: buffer.length,
      };
    } catch (err) {
      this.logger.error(`WhatsApp media upload failed mediaId=${id}`, err as Error);
      return withId;
    }
  }

  private async ingestMessage(property: PropertyEntity, parsed: WaExtractResult): Promise<void> {
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

    const metadata = await this.attachMediaToMetadata(property, parsed.metadata, parsed.mediaId);

    const userMessage = await this.chatService.saveMessage({
      propertyId: property.id,
      conversationId: conversation.id,
      content: parsed.displayContent,
      role: 'user',
      channel: MessageChannel.WHATSAPP,
      metadata,
    });

    const listPreview = parsed.displayContent.slice(0, 200);
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

    const aiEnabled = this.configService.get<boolean>('INBOUND_WHATSAPP_AI_ENABLED', true);
    const aiOn = aiEnabled;
    const canRunAi = aiOn && parsed.aiInput.trim().length > 0;

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

    if (!canRunAi) {
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
      content: parsed.aiInput,
      listPreview,
      streamClient: null,
      guestReplyChannel: 'whatsapp',
    });
  }
}
