import { createHash } from 'crypto';

import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, EntityManager, IsNull, Not, QueryFailedError, Repository } from 'typeorm';

import {
  CONVERSATION_CHANNEL,
  listPreviewForInbox,
  stripEscalationForGuestDisplay,
  type BookingComMessageMetadata,
} from '@rentai/shared';

import { AgentService } from '../agent/agent.service';

import {
  assistantReplyIndicatesEscalationWithoutMarker,
  parseAssistantEscalation,
  resolveGuestEscalationFallback,
  shouldForceEscalationGuestReply,
} from '../agent/constants/agent-prompts';

import { ChatGateway } from '../chat/chat.gateway';

import { ChatService } from '../chat/chat.service';

import { BookingComMetadataService } from '../chat/booking-com-metadata.service';

import { ConversationService } from '../chat/conversation.service';

import type { ChatMessageEntity } from '../chat/entities/chat-message.entity';

import { BookingService } from '../booking/booking.service';

import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';

import { PropertyService } from '../property/property.service';

import { TelegramService } from '../telegram/telegram.service';

import { MessagingMessageEntity } from './entities/messaging-message.entity';

import { MessagingThreadEntity, type MessagingChannel } from './entities/messaging-thread.entity';

import { MessageParserService } from './message-parser.service';

import { ReplySenderService } from './reply-sender.service';

import type { ResendWebhookDto } from './dto/resend-webhook.dto';

import { shouldDropInboundByMailHeaders } from './inbound-email-heuristics';

import { extractResendWebhookEventId } from './resend-webhook.util';



function normalizeHeaders(

  h?: Record<string, string | string[]>,

): Record<string, string | string[] | undefined> {

  if (!h) return {};

  const out: Record<string, string | string[] | undefined> = {};

  for (const [k, v] of Object.entries(h)) {

    out[k.toLowerCase()] = v;

  }

  return out;

}



@Injectable()

export class MessagingService {

  private readonly logger = new Logger(MessagingService.name);



  constructor(

    @InjectRepository(MessagingThreadEntity)

    private readonly threadRepo: Repository<MessagingThreadEntity>,

    @InjectRepository(MessagingMessageEntity)

    private readonly messageRepo: Repository<MessagingMessageEntity>,

    private readonly parser: MessageParserService,

    private readonly replySender: ReplySenderService,

    private readonly agentService: AgentService,

    private readonly dataSource: DataSource,

    private readonly config: ConfigService,

    private readonly propertyService: PropertyService,

    private readonly bookingService: BookingService,

    private readonly knowledgeBaseService: KnowledgeBaseService,

    @Inject(forwardRef(() => TelegramService))

    private readonly telegramService: TelegramService,

    private readonly conversationService: ConversationService,

    private readonly chatService: ChatService,

    private readonly bookingComMetadataService: BookingComMetadataService,

    @Inject(forwardRef(() => ChatGateway))

    private readonly chatGateway: ChatGateway,

  ) {}

  /** Outbound Resend `to`: Reply-To from last inbound, else guest mailbox. */
  private recipientForOutbound(thread: { replyTo: string; guestEmail: string }): string | null {
    const to = (thread.replyTo?.trim() || thread.guestEmail?.trim() || '').trim();
    return to || null;
  }

  /**
   * From `conversations.externalGuestKey` (`email:user@host` or legacy). Rejects display names
   * so we do not query `guest_email` with values like "john smith".
   */
  private normalizeGuestEmailFromExternalKey(externalGuestKey?: string | null): string | null {
    const raw = externalGuestKey?.replace(/^email:/i, '').trim().toLowerCase() ?? '';
    if (!raw || !raw.includes('@')) return null;
    return raw;
  }

  async processInbound(dto: ResendWebhookDto, ownerId: string): Promise<void> {
    const eventId = extractResendWebhookEventId(dto.data);
    try {
      await this.processInboundCore(dto, ownerId);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error(`processInbound failed eventId=${eventId ?? 'n/a'}: ${err.message}`, err.stack);
      await this.telegramService
        .notifyOwnerOpsMessage(
          ownerId,
          `Inbound email pipeline error\nEvent: ${eventId ?? 'n/a'}\n${err.message.slice(0, 900)}`,
        )
        .catch(() => undefined);
      throw err;
    }
  }

  private async processInboundCore(dto: ResendWebhookDto, ownerId: string): Promise<void> {

    const { from, subject, replyTo, headers, id: resendDataId, email_id: resendEmailId } = dto.data;

    let text = dto.data.text ?? '';

    let html: string | null | undefined = dto.data.html ?? null;

    const resendInboundId = resendEmailId?.trim() ?? resendDataId?.trim();

    let didFetchInboundBody = false;

    const ensureInboundBodyFromApi = async (): Promise<void> => {

      if (!resendInboundId || didFetchInboundBody) return;

      didFetchInboundBody = true;

      const fetched = await this.replySender.fetchReceivedEmailBody(resendInboundId);

      if (!fetched) return;

      if (fetched.text != null) text = fetched.text;

      if (fetched.html != null) html = fetched.html;

    };

    const normHeaders = normalizeHeaders(headers as Record<string, string | string[]> | undefined);

    const headerDrop = shouldDropInboundByMailHeaders(normHeaders);
    if (headerDrop.drop) {
      this.logger.log(`Inbound skipped (headers): ${headerDrop.reason ?? 'auto'}`);
      return;
    }

    const rawEmailId =

      this.parser.extractMessageId(normHeaders) ?? resendDataId?.trim() ?? resendEmailId?.trim() ?? null;



    const guestEmail = this.parser.extractEmailFromFrom(from);

    const channel = this.parser.parseChannel(guestEmail);

    let cleanText = this.parser.extractInboundBody(text, html ?? undefined);

    /**
     * Webhooks often omit `html` (metadata only); href with `hotel_id` lives in full HTML from API.
     * Fetch when plain is empty OR when we have no HTML to parse for Booking routing.
     */
    if (!cleanText.trim() || !html?.trim()) {

      await ensureInboundBodyFromApi();

      cleanText = this.parser.extractInboundBody(text, html ?? undefined);

    }

    cleanText = this.parser.stripInboundQuoteNoise(cleanText);

    const subjectTrim = subject?.trim() ?? '';

    const htmlPlain = html
      ? this.parser.decodeHtmlEntities(this.parser.htmlToPlainForInbound(html))
      : '';

    const bookingHints = this.parser.parseBookingStyleInboxHints(
      `${cleanText}\n${subjectTrim}\n${htmlPlain}`,
    );

    if (html?.trim()) {
      const hotelFromHref = this.parser.extractBookingHotelIdFromHtml(html);
      if (hotelFromHref) {
        bookingHints.bookingHotelId = hotelFromHref;
      }
    }

    const reservationId = this.parser.resolveInboundReservationId(subject, cleanText, bookingHints);

    const guestName =
      this.parser.extractGuestNameFromBookingSubject(subjectTrim) ??
      bookingHints.guestName?.trim() ??
      this.parser.extractGuestName(from);

    const propertyIdHint =
      bookingHints.bookingHotelId ?? bookingHints.zodomusPropertyId;

    let resolvedPropertyId: string | null = null;
    if (channel === 'booking') {
      const aliasBooking = await this.bookingService.findByGuestEmailAliasForOwner(
        ownerId,
        guestEmail,
      );
      if (aliasBooking) {
        resolvedPropertyId = aliasBooking.propertyId;
        this.logger.log(
          `Inbound routing: guest_email_alias → propertyId=${aliasBooking.propertyId} bookingId=${aliasBooking.id}`,
        );
      }
    }
    if (resolvedPropertyId == null) {
      resolvedPropertyId = await this.resolveInboundTargetPropertyId(
        ownerId,
        propertyIdHint,
        reservationId,
        bookingHints.propertyName,
        channel,
        bookingHints.bookingHotelId?.trim() ?? null,
      );
    }

    /** UI + chat_messages: plain body first; if empty (HTML-only, delayed fetch), show subject — avoids "(empty message)" when subject carries the text. */
    const guestDisplayText = cleanText.trim() || subjectTrim || '(empty message)';

    const bodyForAgent =

      cleanText.trim() || subjectTrim || 'The guest sent an empty or non-text message.';

    const replyAddr = replyTo?.trim() || guestEmail;



    const lockMaterial = rawEmailId

      ? `resend-msg:${rawEmailId}`

      : `${ownerId}|${channel}|${guestEmail}|${reservationId ?? ''}`;

    const buf = createHash('sha256').update(lockMaterial).digest();

    const lockK1 = buf.readInt32BE(0);

    const lockK2 = buf.readInt32BE(4);



    const result = await this.dataSource.transaction(async (manager) => {

      await manager.query(`SELECT pg_advisory_xact_lock($1, $2)`, [lockK1, lockK2]);



      if (rawEmailId) {

        const dup = await manager.findOne(MessagingMessageEntity, { where: { rawEmailId } });

        if (dup) {

          this.logger.log(`Resend inbound skipped (already stored): raw_email_id=${rawEmailId}`);

          return null;

        }

      }



      let thread = await this.findThreadForUpsertWithManager(manager, {

        channel,

        guestEmail,

        ownerId,

        reservationId,

      });



      if (!thread) {

        thread = manager.create(MessagingThreadEntity, {

          channel,

          guestEmail,

          guestName,

          replyTo: replyAddr,

          reservationId,

          ownerId,

          status: 'open',

          zodomusReservationId: null,

          propertyId: resolvedPropertyId ?? null,

          conversationId: null,

          lastInboundSubject: subjectTrim || null,

        });

        await manager.save(thread);

      } else {

        if (reservationId && !thread.reservationId) {

          thread.reservationId = reservationId;

        }

        if (resolvedPropertyId) {
          thread.propertyId = resolvedPropertyId;
        }

        thread.lastInboundSubject = subjectTrim || null;

        if (guestName?.trim()) {
          thread.guestName = guestName.trim();
        }

        await manager.save(thread);

      }



      let guestMessage: MessagingMessageEntity;

      try {

        guestMessage = await manager.save(

          manager.create(MessagingMessageEntity, {

            threadId: thread.id,

            role: 'guest',

            text: guestDisplayText,

            rawEmailId,

            sentAt: null,

          }),

        );

      } catch (e) {

        if (

          e instanceof QueryFailedError &&

          (e as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505'

        ) {

          return null;

        }

        throw e;

      }



      return { thread, guestMessage, bodyForAgent, guestDisplayText };

    });



    if (!result) return;



    const { thread, guestMessage } = result;



    this.chatGateway.server.to(`messaging:${thread.id}`).emit('new_message', { message: guestMessage });



    const syncInbox = await this.syncInboundToChatInbox(

      ownerId,

      thread.id,

      guestEmail,

      guestDisplayText,

      thread.propertyId,

      thread.guestName,

      channel,

    );

    await this.generateAndEmitDraft(

      thread,

      guestMessage.id,

      bodyForAgent,

      syncInbox?.chatGuestMessageId ?? null,

      syncInbox?.listPreview ?? guestDisplayText,

    );

  }



  /**
   * Listing resolution for inbound mail. Guest email is not used here — only OTA hints from the message.
   *
   * 1) External listing id (`hotel_id` / Zodomus id) → `property_channel_listings.externalListingId` / `properties.zodomusPropertyId`
   * 2) For **Booking**, if `hotel_id` was present in the email but no row matches → **stop** (do not guess via reservation/name/default).
   * 3) Otherwise: reservation id → booking row; property name (loose); `RESEND_INBOUND_PROPERTY_ID` / first property.
   */
  private async resolveInboundTargetPropertyId(

    ownerId: string,

    /** Booking `hotel_id` or Zodomus listing id from the message body/links. */
    zodomusPropertyIdHint: string | null,

    reservationId: string | null,

    propertyNameHint: string | null,

    channel: MessagingChannel,

    /**
     * Booking extranet `hotel_id` extracted from this email (links/HTML). When set, step (1) is authoritative for Booking.
     */
    bookingHotelIdFromEmail: string | null,

  ): Promise<string | null> {

    if (zodomusPropertyIdHint?.trim()) {

      const byZ = await this.propertyService.findIdByZodomusPropertyIdForOwner(

        ownerId,

        zodomusPropertyIdHint.trim(),

      );

      if (byZ) {

        this.logger.log(

          `Inbound routing: listing id ${zodomusPropertyIdHint.trim()} → propertyId=${byZ}`,

        );

        return byZ;

      }

      if (channel === 'booking' && bookingHotelIdFromEmail?.trim()) {

        this.logger.warn(

          `Inbound routing: Booking hotel_id=${bookingHotelIdFromEmail.trim()} not linked to any property for this owner; refusing reservation/name fallback`,

        );

        return null;

      }

    }

    if (reservationId) {

      const fromBooking = await this.bookingService.findPropertyIdByZodomusReservationForOwner(

        ownerId,

        reservationId,

      );

      if (fromBooking) {

        this.logger.log(`Inbound routing: reservation ${reservationId} → propertyId=${fromBooking}`);

        return fromBooking;

      }

    }

    if (propertyNameHint?.trim()) {

      const fromName = await this.propertyService.findIdByOwnerAndNameLooseMatch(

        ownerId,

        propertyNameHint,

      );

      if (fromName) {

        this.logger.log(

          `Inbound routing: property name "${propertyNameHint.slice(0, 80)}" → propertyId=${fromName}`,

        );

        return fromName;

      }

    }

    return this.resolveInboundPropertyId(ownerId);

  }



  private async resolveInboundPropertyId(ownerId: string): Promise<string | null> {

    const explicit = this.config.get<string>('RESEND_INBOUND_PROPERTY_ID');

    if (explicit) {

      try {

        await this.propertyService.findOne(explicit, ownerId);

        return explicit;

      } catch {

        this.logger.warn(

          `RESEND_INBOUND_PROPERTY_ID=${explicit} is missing or not owned by this user; falling back to first property`,

        );

      }

    }

    const props = await this.propertyService.findAllByOwner(ownerId);

    if (props.length === 0) return null;

    const sorted = [...props].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const first = sorted[0];

    return first ? first.id : null;

  }



  /**
   * Mirror inbound mail into the property chat inbox. `guestEmail` keys the conversation only — it does not choose the listing.
   * For OTA channels, if no property was resolved for this message, do not fall back to the owner’s first property (avoids wrong assignment).
   */

  private async syncInboundToChatInbox(

    ownerId: string,

    threadId: string,

    guestEmail: string,

    previewText: string,

    threadPropertyId: string | null | undefined,

    guestDisplayName: string | null | undefined,

    channel: MessagingChannel,

  ): Promise<{ chatGuestMessageId: string; listPreview: string } | null> {

    try {

      if (!guestEmail?.trim()) {

        this.logger.warn('Email→chat: empty guest email; skip inbox sync.');

        return null;

      }

      let propertyId: string | null = threadPropertyId?.trim() ? threadPropertyId.trim() : null;

      if (!propertyId) {

        if (channel === 'booking' || channel === 'airbnb') {

          this.logger.warn(

            'Email→chat: no propertyId on thread for OTA inbound; skip inbox sync (listing must come from message, not guest email).',

          );

          return null;

        }

        propertyId = await this.resolveInboundPropertyId(ownerId);

      }

      if (!propertyId) {

        this.logger.warn(

          'Email→chat: no property for owner; add a property or set RESEND_INBOUND_PROPERTY_ID.',

        );

        return null;

      }



      const guestKey = `email:${guestEmail.toLowerCase()}`;

      let conv = await this.conversationService.findOrCreate(

        propertyId,

        CONVERSATION_CHANNEL.EMAIL,

        guestKey,

      );

      if (conv.status === 'resolved') {

        await this.conversationService.setStatus(conv.id, 'ai_handling');

        conv = await this.conversationService.findById(conv.id);

      }



      await this.threadRepo.update(threadId, { conversationId: conv.id, propertyId });

      let bookingMeta: BookingComMessageMetadata | null = null;
      try {
        bookingMeta = await this.bookingComMetadataService.buildForUserMessage(conv.id, previewText);
      } catch (metaErr) {
        this.logger.warn(
          `Email→chat: booking metadata skipped for conv ${conv.id}: ${(metaErr as Error).message}`,
        );
      }

      const saved = await this.chatService.saveMessage({
        propertyId,
        conversationId: conv.id,
        content: previewText,
        role: 'user',
        source: 'ai',
        metadata: bookingMeta ?? undefined,
      });

      const listPreview = listPreviewForInbox(previewText, bookingMeta);

      await this.conversationService.touch(conv.id, listPreview);

      await this.conversationService.setGuestDisplayName(conv.id, guestDisplayName);

      this.emitInboxMessageSaved(propertyId, saved);

      this.chatGateway.server.to(`inbox:${propertyId}`).emit('conversation:updated', {
        conversationId: conv.id,
        lastMessagePreview: listPreview.slice(0, 200),
        lastActivityAt: saved.createdAt.toISOString(),
        status: conv.status,
      });

      this.logger.log(

        `Email→chat: linked conversationId=${conv.id} propertyId=${propertyId} threadId=${threadId} key=${guestKey}`,

      );

      return { chatGuestMessageId: saved.id, listPreview };

    } catch (err) {

      this.logger.error('Email→chat sync failed', err as Error);

      return null;

    }

  }



  private emitInboxMessageSaved(propertyId: string, msg: ChatMessageEntity): void {
    this.chatGateway.server
      .to(`inbox:${propertyId}`)
      .emit('message:saved', this.chatService.toSocketPayload(msg));
  }



  private async findThreadForUpsertWithManager(

    manager: EntityManager,

    params: {

      channel: MessagingThreadEntity['channel'];

      guestEmail: string;

      ownerId: string;

      reservationId: string | null;

    },

  ): Promise<MessagingThreadEntity | null> {

    const { channel, guestEmail, ownerId, reservationId } = params;

    if (reservationId) {

      return manager.findOne(MessagingThreadEntity, {

        where: { channel, guestEmail, ownerId, reservationId },

        order: { createdAt: 'DESC' },

      });

    }

    return manager.findOne(MessagingThreadEntity, {

      where: { channel, guestEmail, ownerId, reservationId: IsNull() },

      order: { createdAt: 'DESC' },

    });

  }



  private async generateAndEmitDraft(

    thread: MessagingThreadEntity,

    guestMessageId: string,

    userText: string,

    chatGuestMessageId: string | null,

    /** Same string as inbox list preview / web chat Telegram (Booking follow-up → parsed guest question). */
    guestQuestionForTelegram: string,

  ): Promise<void> {

    try {

      const all = await this.messageRepo.find({

        where: { threadId: thread.id },

        order: { createdAt: 'ASC' },

      });

      const prior = all.filter((m) => m.id !== guestMessageId);

      const chatHistory = prior.map((m) => ({

        role: (m.role === 'guest' ? 'user' : 'assistant') as 'user' | 'assistant',

        content: m.text,

      }));



      const rawDraft = await this.agentService.processMessage(

        `Property (${thread.channel})`,

        '',

        userText,

        chatHistory,

      );

      const { rawEndsEscalate, textWithoutMarker } = parseAssistantEscalation(rawDraft);

      let kbEmpty = true;

      let kbWeakMatch = true;

      const freshEarly = await this.threadRepo.findOne({ where: { id: thread.id } });

      if (freshEarly?.propertyId) {

        const kbSearch = await this.knowledgeBaseService.searchRelevant(

          freshEarly.propertyId,

          userText,

          8,

        );

        kbEmpty = kbSearch.entries.length === 0;

        kbWeakMatch = kbSearch.isWeakMatch;

      }

      const kbHasReliableMatch = !kbEmpty && !kbWeakMatch;

      const forcedByForbidden = shouldForceEscalationGuestReply(textWithoutMarker);

      const modelSaysEscalateWithoutMarker =
        assistantReplyIndicatesEscalationWithoutMarker(textWithoutMarker);

      /** Same as web chat `chat.gateway` — without this, Telegram stays silent when KB looks strong but the model omits [ESCALATE]. */
      const notifyStaff =
        kbEmpty ||
        forcedByForbidden ||
        kbWeakMatch ||
        rawEndsEscalate ||
        modelSaysEscalateWithoutMarker;

      const guestEscalationUi =

        kbEmpty || forcedByForbidden || kbWeakMatch || (rawEndsEscalate && !kbHasReliableMatch);

      const escalationFallback = resolveGuestEscalationFallback(userText);

      let guestSafe: string;

      if (!guestEscalationUi) {

        guestSafe = textWithoutMarker;

      } else if (rawEndsEscalate && !forcedByForbidden) {

        guestSafe = textWithoutMarker || escalationFallback;

      } else {

        guestSafe = escalationFallback;

      }

      guestSafe = stripEscalationForGuestDisplay(guestSafe) || escalationFallback;

      if (!guestSafe.trim()) {

        guestSafe = escalationFallback;

      }



      const draftMessage = await this.messageRepo.save(

        this.messageRepo.create({

          threadId: thread.id,

          role: 'ai_draft',

          text: guestSafe,

          rawEmailId: null,

          sentAt: null,

        }),

      );



      await this.threadRepo.update(thread.id, { status: 'ai_draft' });



      this.chatGateway.server.to(`messaging:${thread.id}`).emit('ai_draft_ready', {

        threadId: thread.id,

        draft: guestSafe,

        messageId: draftMessage.id,

      });

      /** Guest email first — do not block on chat sync or Telegram escalation (can be very slow). */
      try {
        const toAddr = this.recipientForOutbound(thread);
        if (toAddr) {
          await this.replySender.send(toAddr, guestSafe);
        } else {
          this.logger.warn(`AI reply email skipped: no recipient for thread ${thread.id}`);
        }
      } catch (sendErr) {
        this.logger.error(`AI reply email failed for thread ${thread.id}`, sendErr as Error);
      }

      const fresh = await this.threadRepo.findOne({ where: { id: thread.id } });

      /** До сохранения assistant в чат: иначе ошибка saveMessage/inbox уводит в catch и Telegram не вызывается. */
      const propertyIdForTg = fresh?.propertyId ?? thread.propertyId;

      if (notifyStaff && propertyIdForTg) {

        try {

          const property = await this.propertyService.findOne(propertyIdForTg, thread.ownerId);

          await this.telegramService.sendEscalationIfConfigured({

            propertyId: propertyIdForTg,

            ownerId: thread.ownerId,

            propertyName: property.name,

            guestQuestion: guestQuestionForTelegram,

            guestMessageId: chatGuestMessageId,

            conversationId: fresh?.conversationId ?? undefined,

            messagingThreadId: thread.id,

          });

        } catch (tgErr) {

          this.logger.error(`Email→Telegram escalation failed for thread ${thread.id}`, tgErr as Error);

        }

      }

      if (fresh?.conversationId && fresh.propertyId) {

        try {

          const cm = await this.chatService.saveMessage({

            propertyId: fresh.propertyId,

            conversationId: fresh.conversationId,

            content: guestSafe,

            role: 'assistant',

            source: 'ai',

          });

          const inboxStatus = notifyStaff ? 'needs_human' : 'resolved';

          await this.conversationService.setStatus(fresh.conversationId, inboxStatus);

          await this.conversationService.touch(fresh.conversationId, guestSafe);

          this.emitInboxMessageSaved(fresh.propertyId, cm);

          this.chatGateway.server.to(`inbox:${fresh.propertyId}`).emit('conversation:updated', {

            conversationId: fresh.conversationId,

            lastMessagePreview: guestSafe.slice(0, 200),

            lastActivityAt: cm.createdAt.toISOString(),

            status: inboxStatus,

          });

        } catch (inboxErr) {

          this.logger.error(

            `Email→chat: assistant message / inbox emit failed for thread ${thread.id}`,

            inboxErr as Error,

          );

        }

      }

    } catch (err) {

      this.logger.error(`AI draft failed for thread ${thread.id}`, err as Error);

    }

  }



  /** Messaging thread linked to an inbox conversation (email bridge). */
  findThreadByConversationId(conversationId: string): Promise<MessagingThreadEntity | null> {
    return this.threadRepo.findOne({ where: { conversationId } });
  }

  /**
   * Telegram escalation: получить `conversations.id` по `messaging_threads.id` (почтовый мост).
   * Если `conversation_id` на треде ещё пустой, ищем инбокс по `email:${guestEmail}` и привязываем тред.
   */
  async resolveConversationIdFromMessagingThread(
    threadId: string,
    propertyId: string,
  ): Promise<string | null> {
    const t = await this.threadRepo.findOne({ where: { id: threadId } });
    if (!t || t.propertyId !== propertyId) return null;
    if (t.conversationId?.trim()) {
      return t.conversationId.trim();
    }
    const email = t.guestEmail?.trim().toLowerCase();
    if (!email) return null;
    let convId = await this.conversationService.findEmailConversationIdByGuestEmail(propertyId, email);
    if (convId) {
      await this.threadRepo.update(threadId, { conversationId: convId });
      this.logger.log(
        `Linked messaging thread ${threadId} to conversation ${convId} via guest email (Telegram bridge)`,
      );
      return convId;
    }
    /** Same as inbound email: ensure inbox row exists, then link thread (guest wrote only via email, no row yet). */
    const conv = await this.conversationService.findOrCreate(
      propertyId,
      CONVERSATION_CHANNEL.EMAIL,
      `email:${email}`,
    );
    await this.threadRepo.update(threadId, { conversationId: conv.id });
    this.logger.log(
      `Linked messaging thread ${threadId} to conversation ${conv.id} via findOrCreate(EMAIL) (Telegram bridge)`,
    );
    return conv.id;
  }

  async resolveConversationIdForEscalationFallback(propertyId: string): Promise<string | null> {
    const row = await this.threadRepo.findOne({
      where: { propertyId, conversationId: Not(IsNull()) },
      order: { updatedAt: 'DESC' },
    });
    return row?.conversationId ?? null;
  }

  /**

   * After staff reply is saved in `chat_messages`, send the same text to the guest by email

   * when this conversation is linked to a messaging thread.

   * Resolves the thread by `conversationId` only — access is enforced by callers (e.g. property scope on HTTP).

   */

  async relayStaffReplyToEmailGuest(
    conversationId: string,
    text: string,
    opts?: { messagingThreadId?: string | null },
  ): Promise<void> {
    const cid = conversationId.trim();
    this.logger.log(`relayStaffReplyToEmailGuest: start conversationId=${cid}`);
    /** Prefer raw column match — avoids edge cases with camelCase `findOne` + naming strategy. */
    let thread = await this.threadRepo
      .createQueryBuilder('t')
      .where('t.conversation_id = :cid', { cid })
      .getOne();

    if (!thread) {
      try {
        const conv = await this.conversationService.findById(cid);
        const guestEmailAddr = this.normalizeGuestEmailFromExternalKey(conv.externalGuestKey);
        if (guestEmailAddr && conv.propertyId) {
          thread = await this.threadRepo
            .createQueryBuilder('t')
            .where('t.property_id = :pid', { pid: conv.propertyId })
            .andWhere('LOWER(t.guest_email) = :email', { email: guestEmailAddr })
            .orderBy('t.updated_at', 'DESC')
            .getOne();
        }
        if (thread && !thread.conversationId) {
          await this.threadRepo.update(thread.id, { conversationId: cid });
        }
      } catch (e) {
        this.logger.warn(
          `relayStaffReplyToEmailGuest: resolve thread by guest email failed for ${cid}: ${(e as Error).message}`,
        );
      }
    }

    if (!thread) {
      try {
        const conv = await this.conversationService.findById(cid);
        const guestEmailAddr = this.normalizeGuestEmailFromExternalKey(conv.externalGuestKey);
        if (
          conv.channel === CONVERSATION_CHANNEL.EMAIL &&
          guestEmailAddr &&
          conv.propertyId
        ) {
          const ownerId = await this.propertyService.getOwnerIdByPropertyId(conv.propertyId);
          if (ownerId) {
            thread = await this.threadRepo.save(
              this.threadRepo.create({
                channel: 'direct',
                guestEmail: guestEmailAddr,
                guestName: null,
                replyTo: guestEmailAddr,
                reservationId: null,
                ownerId,
                propertyId: conv.propertyId,
                conversationId: cid,
                status: 'open',
                zodomusReservationId: null,
                lastInboundSubject: null,
              }),
            );
            this.logger.log(
              `relayStaffReplyToEmailGuest: created messaging thread ${thread.id} for email conversation ${cid}`,
            );
          }
        }
      } catch (e) {
        this.logger.warn(
          `relayStaffReplyToEmailGuest: create thread for email conversation failed ${cid}: ${(e as Error).message}`,
        );
      }
    }

    if (!thread && opts?.messagingThreadId?.trim()) {
      try {
        const conv = await this.conversationService.findById(cid);
        const byId = await this.threadRepo.findOne({ where: { id: opts.messagingThreadId.trim() } });
        if (byId && conv.propertyId === byId.propertyId) {
          if (!byId.conversationId || byId.conversationId !== cid) {
            await this.threadRepo.update(byId.id, { conversationId: cid });
          }
          thread = Object.assign(byId, { conversationId: cid });
          this.logger.log(
            `relayStaffReplyToEmailGuest: resolved thread by messagingThreadId=${byId.id} for email relay`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `relayStaffReplyToEmailGuest: messagingThreadId fallback failed for ${cid}: ${(e as Error).message}`,
        );
      }
    }

    if (!thread) {
      const conv = await this.conversationService.findById(cid).catch(() => null);
      this.logger.warn(
        `relayStaffReplyToEmailGuest: no messaging thread for conversation ${cid} (channel=${conv?.channel ?? 'unknown'}) — email relay skipped; only email-channel conversations have a messaging thread`,
      );
      return;
    }

    const guestSafe =
      stripEscalationForGuestDisplay(text) || resolveGuestEscalationFallback(text);

    const toAddr = this.recipientForOutbound(thread);
    if (!toAddr) {
      this.logger.warn(`relayStaffReplyToEmailGuest: no recipient (replyTo/guest_email) for thread ${thread.id}`);
      return;
    }

    try {
      await this.replySender.send(toAddr, guestSafe);
      this.logger.log(`relayStaffReplyToEmailGuest: sent for thread ${thread.id} conversationId=${cid}`);

      await this.messageRepo.save(

        this.messageRepo.create({

          threadId: thread.id,

          role: 'sent',

          text: guestSafe,

          rawEmailId: null,

          sentAt: new Date(),

        }),

      );

      await this.threadRepo.update(thread.id, { status: 'resolved' });

      this.chatGateway.server.to(`messaging:${thread.id}`).emit('reply_sent', { threadId: thread.id });

    } catch (err) {

      this.logger.error(`Staff reply email failed for thread ${thread.id}`, err as Error);

    }

  }

  async sendReply(threadId: string, text: string, ownerId: string): Promise<void> {

    const thread = await this.threadRepo.findOneOrFail({ where: { id: threadId, ownerId } });

    const guestSafe =

      stripEscalationForGuestDisplay(text) || resolveGuestEscalationFallback(text);



    if (thread.conversationId && thread.propertyId) {

      const saved = await this.chatService.saveMessage({

        propertyId: thread.propertyId,

        conversationId: thread.conversationId,

        userId: ownerId,

        content: guestSafe,

        role: 'assistant',

        source: 'staff',

      });

      await this.conversationService.setStatus(thread.conversationId, 'resolved');

      await this.conversationService.touch(thread.conversationId, guestSafe);

      this.emitInboxMessageSaved(thread.propertyId, saved);

      this.chatGateway.server.to(`inbox:${thread.propertyId}`).emit('conversation:updated', {

        conversationId: thread.conversationId,

        lastMessagePreview: guestSafe.slice(0, 200),

        lastActivityAt: saved.createdAt.toISOString(),

        status: 'resolved',

      });

    }



    try {
      const toAddr = this.recipientForOutbound(thread);
      if (!toAddr) {
        this.logger.warn(`sendReply: no recipient (replyTo/guest_email) for thread ${thread.id}`);
        return;
      }
      await this.replySender.send(toAddr, guestSafe);

      await this.messageRepo.save(

        this.messageRepo.create({

          threadId: thread.id,

          role: 'sent',

          text: guestSafe,

          rawEmailId: null,

          sentAt: new Date(),

        }),

      );

      await this.threadRepo.update(thread.id, { status: 'resolved' });

      this.chatGateway.server.to(`messaging:${thread.id}`).emit('reply_sent', { threadId: thread.id });

    } catch (err) {

      this.logger.error(`Messaging sendReply email failed for thread ${thread.id}`, err as Error);

    }

  }



  async assertThreadOwnedBy(threadId: string, ownerId: string): Promise<MessagingThreadEntity> {

    return this.threadRepo.findOneOrFail({ where: { id: threadId, ownerId } });

  }



  async getThreads(

    ownerId: string,

  ): Promise<Array<MessagingThreadEntity & { lastMessage?: MessagingMessageEntity }>> {

    const threads = await this.threadRepo.find({

      where: { ownerId },

      order: { updatedAt: 'DESC' },

    });

    if (threads.length === 0) {

      return threads;

    }

    const ids = threads.map((t) => t.id);

    const lastMessages = await this.messageRepo

      .createQueryBuilder('m')

      .distinctOn(['m.threadId'])

      .where('m.threadId IN (:...ids)', { ids })

      .orderBy('m.threadId', 'ASC')

      .addOrderBy('m.createdAt', 'DESC')

      .getMany();

    const map = new Map(lastMessages.map((m) => [m.threadId, m]));

    return threads.map((t) => ({

      ...t,

      lastMessage: map.get(t.id),

    }));

  }



  async getThreadWithMessages(

    threadId: string,

    ownerId: string,

  ): Promise<{ thread: MessagingThreadEntity; messages: MessagingMessageEntity[] }> {

    const thread = await this.threadRepo.findOneOrFail({ where: { id: threadId, ownerId } });

    const messages = await this.messageRepo.find({

      where: { threadId },

      order: { createdAt: 'ASC' },

    });

    return { thread, messages };

  }

}


