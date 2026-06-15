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
  type EmailInboundAttachment,
  type EmailInboundMessageMetadata,
} from '@rentai/shared';

import { AgentService } from '../agent/agent.service';

import {
  assistantReplyIndicatesEscalationWithoutMarker,
  formatKnowledgeBaseEntriesForAgent,
  buildAgentKnowledgeContext,
  parseAssistantEscalation,
  resolveGuestEscalationFallback,
  shouldForceEscalationGuestReply,
} from '../agent/constants/agent-prompts';

import { ChatGateway } from '../chat/chat.gateway';

import { ChatService } from '../chat/chat.service';

import { conversationChannelToMessageChannel } from '../chat/chat-channel.mapper';
import { MessageDeliveryStatus } from '../chat/enums/message-delivery-status.enum';

import { BookingComMetadataService } from '../chat/booking-com-metadata.service';

import { ConversationService } from '../chat/conversation.service';
import { AiDraftApprovalService } from '../chat/ai-draft-approval.service';

import type { ChatMessageEntity } from '../chat/entities/chat-message.entity';

import { BookingService } from '../booking/booking.service';
import type { BookingEntity } from '../booking/entities/booking.entity';

import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { CompanyGlobalRulesService } from '../company/company-global-rules.service';

import { PropertyService } from '../property/property.service';

import { TelegramService } from '../telegram/telegram.service';

import { MessagingMessageEntity } from './entities/messaging-message.entity';

import { MessagingAttachmentEntity } from './entities/messaging_attachments.entity';

import { MessagingThreadEntity, type MessagingChannel } from './entities/messaging-thread.entity';

import { StorageService } from '../modules/storage/storage.service';

import { MessageParserService } from './message-parser.service';

import { ReplySenderService } from './reply-sender.service';

import type { ResendWebhookDto } from './dto/resend-webhook.dto';
import type { MessagingMessagePublicDto } from './dto/messaging-thread-public.dto';

import { shouldDropInboundByMailHeaders } from './inbound-email-heuristics';

import { extractResendWebhookEventId } from './resend-webhook.util';

import { buildGuestAgentText, parseResendInboundAttachments } from './inbound-attachments.util';



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

    @InjectRepository(MessagingAttachmentEntity)

    private readonly attachmentRepo: Repository<MessagingAttachmentEntity>,

    private readonly storageService: StorageService,

    private readonly parser: MessageParserService,

    private readonly replySender: ReplySenderService,

    private readonly agentService: AgentService,

    private readonly dataSource: DataSource,

    private readonly config: ConfigService,

    private readonly propertyService: PropertyService,

    private readonly bookingService: BookingService,

    private readonly knowledgeBaseService: KnowledgeBaseService,

    private readonly companyGlobalRulesService: CompanyGlobalRulesService,

    @Inject(forwardRef(() => TelegramService))

    private readonly telegramService: TelegramService,

    private readonly conversationService: ConversationService,

    private readonly chatService: ChatService,

    private readonly bookingComMetadataService: BookingComMetadataService,

    @Inject(forwardRef(() => ChatGateway))

    private readonly chatGateway: ChatGateway,

    @Inject(forwardRef(() => AiDraftApprovalService))

    private readonly aiDraftApproval: AiDraftApprovalService,

  ) {}

  /** Outbound Resend `to`: Reply-To from last inbound, else guest mailbox. */
  private recipientForOutbound(thread: { replyTo: string; guestEmail: string }): string | null {
    const to = (thread.replyTo?.trim() || thread.guestEmail?.trim() || '').trim();
    return to || null;
  }

  /**
   * From `conversations.externalGuestKey` (`email:user@host` or `email:user@host|reservation:id`). Rejects display names
   * so we do not query `guest_email` with values like "john smith".
   */
  private normalizeGuestEmailFromExternalKey(externalGuestKey?: string | null): string | null {
    let raw = externalGuestKey?.replace(/^email:/i, '').trim().toLowerCase() ?? '';
    const pipeIdx = raw.indexOf('|reservation:');
    if (pipeIdx >= 0) {
      raw = raw.slice(0, pipeIdx).trim();
    }
    if (!raw || !raw.includes('@')) return null;
    return raw;
  }

  /** Parsed from `externalGuestKey` suffix when present. */
  private parseReservationFromExternalKey(externalGuestKey?: string | null): string | null {
    const m = externalGuestKey?.match(/\|reservation:([0-9]+)\s*$/i);
    return m?.[1]?.trim() ?? null;
  }

  async processInbound(dto: ResendWebhookDto, ownerId: string): Promise<void> {
    const eventId = extractResendWebhookEventId(dto.data);
    try {
      await this.processInboundCore(dto, ownerId);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (e instanceof AggregateError && e.errors?.length) {
        const detail = e.errors.map((x, i) => `[${i}] ${x instanceof Error ? x.message : String(x)}`).join('; ');
        this.logger.error(
          `processInbound failed eventId=${eventId ?? 'n/a'} (AggregateError): ${detail}`,
          err.stack,
        );
      } else {
        this.logger.error(`processInbound failed eventId=${eventId ?? 'n/a'}: ${err.message}`, err.stack);
      }
      await this.telegramService
        .notifyOwnerOpsMessage(
          ownerId,
          `Inbound email pipeline error\nEvent: ${eventId ?? 'n/a'}\n${err.message.slice(0, 900)}`,
        )
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Downloads files from Resend (list + `download_url`), uploads to R2, persists `messaging_attachments` rows.
   */
  private async persistInboundAttachmentsToR2(
    messageId: string,
    resendInboundId: string | null | undefined,
    hadAttachmentMetadataHint: boolean,
  ): Promise<void> {
    const emailId = resendInboundId?.trim();
    if (!emailId) {
      if (hadAttachmentMetadataHint) {
        this.logger.warn(
          'Inbound attachment metadata present but no Resend email id — cannot download attachments',
        );
      }
      return;
    }
    if (!this.storageService.isConfigured()) {
      if (hadAttachmentMetadataHint) {
        this.logger.warn(
          'Inbound attachments skipped: configure R2 (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)',
        );
      }
      return;
    }
    const files = await this.replySender.fetchReceivedEmailAttachmentFiles(emailId, {
      retryIfEmpty: hadAttachmentMetadataHint,
    });
    if (files.length === 0) {
      if (hadAttachmentMetadataHint) {
        this.logger.warn(
          `No attachment files returned from Resend for email ${emailId} (metadata had attachments)`,
        );
      }
      return;
    }
    for (const f of files) {
      try {
        const { key } = await this.storageService.uploadAttachment(
          f.buffer,
          f.filename,
          f.contentType,
        );
        await this.attachmentRepo.save(
          this.attachmentRepo.create({
            messageId,
            fileName: f.filename,
            contentType: f.contentType,
            sizeBytes: f.sizeBytes,
            storageKey: key,
          }),
        );
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.logger.error(
          `Inbound attachment upload failed for ${f.filename}: ${err.message}`,
          err.stack,
        );
      }
    }
  }

  private async processInboundCore(dto: ResendWebhookDto, ownerId: string): Promise<void> {

    const { from, subject, replyTo, headers, id: resendDataId, email_id: resendEmailId } = dto.data;

    let text = dto.data.text ?? '';

    let html: string | null | undefined = dto.data.html ?? null;

    const resendEmailIdTrim = resendEmailId?.trim() ?? null;
    const resendDataIdTrim = resendDataId?.trim() ?? null;
    const resendInboundId = resendEmailIdTrim ?? resendDataIdTrim;
    if (!resendEmailIdTrim && resendDataIdTrim) {
      this.logger.warn(
        'Inbound: data.email_id missing; using data.id for Resend receiving API — if attachments fail, confirm webhook includes email_id (see Resend email.received docs).',
      );
    }

    let didFetchInboundBody = false;

    let inboundAttachments = parseResendInboundAttachments(
      (dto.data as Record<string, unknown> | undefined)?.attachments,
    );

    const ensureInboundBodyFromApi = async (): Promise<void> => {

      if (!resendInboundId || didFetchInboundBody) return;

      didFetchInboundBody = true;

      const fetched = await this.replySender.fetchReceivedEmailBody(resendInboundId);

      if (!fetched) return;

      if (fetched.text != null) text = fetched.text;

      if (fetched.html != null) html = fetched.html;

      if (fetched.attachments.length > 0) {
        inboundAttachments = fetched.attachments;
      }

    };

    const normHeaders = normalizeHeaders(headers as Record<string, string | string[]> | undefined);

    const headerDrop = shouldDropInboundByMailHeaders(normHeaders);
    if (headerDrop.drop) {
      this.logger.warn(`Inbound skipped: reason=mail_headers ${headerDrop.reason ?? 'auto'}`);
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
     * When fetch runs, `attachments` from the receiving API override webhook metadata.
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

    let aliasBooking: BookingEntity | null = null;
    if (channel === 'booking') {
      aliasBooking = await this.bookingService.findByGuestEmailAliasForOwner(
        ownerId,
        guestEmail,
      );
    }

    const guestName =
      this.parser.extractGuestNameFromBookingSubject(subjectTrim) ??
      bookingHints.guestName?.trim() ??
      aliasBooking?.guestName?.trim() ??
      this.parser.extractGuestName(from);

    const propertyIdHint =
      bookingHints.bookingHotelId ?? bookingHints.zodomusPropertyId;

    let resolvedPropertyId: string | null = null;
    if (aliasBooking) {
      resolvedPropertyId = aliasBooking.propertyId;
      this.logger.log(
        `Inbound routing: guest_email_alias → propertyId=${aliasBooking.propertyId} bookingId=${aliasBooking.id}`,
      );
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

    /** UI + chat_messages: cleaned guest text for Booking; plain body otherwise. */
    const guestDisplayBase =
      channel === 'booking'
        ? this.parser.extractBookingGuestInquiryForAgent(cleanText.trim()) ||
          subjectTrim ||
          '(empty message)'
        : cleanText.trim() || subjectTrim || '(empty message)';
    /** Attachments only in metadata + chips — never append attachment boilerplate to bubble text. */
    const guestDisplayText = guestDisplayBase;

    /** Normalized for LLM / KB (Booking strip + attachment placeholders). Stored as `agent_text`. */
    const guestAgentText = buildGuestAgentText(
      channel,
      cleanText,
      subjectTrim,
      inboundAttachments,
      (t) => this.parser.extractBookingGuestInquiryForAgent(t),
    );

    const bodyForAgent = guestAgentText;

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

            agentText: guestAgentText,

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

    await this.persistInboundAttachmentsToR2(
      guestMessage.id,
      resendInboundId,
      inboundAttachments.length > 0,
    );

    const emailAttachmentRows = await this.attachmentRepo.find({
      where: { messageId: guestMessage.id },
    });
    if (inboundAttachments.length > 0 && emailAttachmentRows.length === 0) {
      this.logger.warn(
        `Inbound: webhook listed ${inboundAttachments.length} attachment(s) but no rows in messaging_attachments after R2 persist (messageId=${guestMessage.id}). ` +
          `Usually Resend GET .../attachments returned empty, or R2 upload failed — check logs above and RESEND_API_KEY.`,
      );
    }
    const emailInboundAttachments: EmailInboundAttachment[] = emailAttachmentRows.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
    }));

    this.chatGateway.server.to(`messaging:${thread.id}`).emit('new_message', { message: guestMessage });

    const syncInbox = await this.syncInboundToChatInbox(
      ownerId,
      thread.id,
      guestEmail,
      guestDisplayText,
      thread.propertyId,
      thread.guestName,
      channel,
      thread.reservationId,
      guestMessage.id,
      emailInboundAttachments,
      bookingHints.bookingHotelId?.trim() ?? null,
    );

    const inboundAiAutoReplyEnabled =

      this.config.get<boolean>('INBOUND_EMAIL_AI_AUTO_REPLY_ENABLED') ?? true;

    if (inboundAiAutoReplyEnabled) {

      await this.generateAndEmitDraft(

        thread,

        guestMessage.id,

        bodyForAgent,

        syncInbox?.chatGuestMessageId ?? null,

        syncInbox?.listPreview ?? guestDisplayText,

      );

    } else {

      this.logger.log(

        `Inbound email: AI auto-reply disabled (INBOUND_EMAIL_AI_AUTO_REPLY_ENABLED=false); threadId=${thread.id}`,

      );

      const freshThread = await this.threadRepo.findOne({ where: { id: thread.id } });

      const cid = freshThread?.conversationId?.trim();

      const pid = freshThread?.propertyId?.trim();

      if (cid && pid) {

        await this.conversationService.setStatus(cid, 'needs_human');

        const preview = (syncInbox?.listPreview ?? guestDisplayText).slice(0, 200);

        this.chatGateway.server.to(`inbox:${pid}`).emit('conversation:updated', {

          conversationId: cid,

          lastMessagePreview: preview,

          lastActivityAt: new Date().toISOString(),

          status: 'needs_human',

        });

      }

    }

  }



  /**
   * Listing resolution for inbound mail. Guest email is not used here — only OTA hints from the message.
   *
   * 1) External listing id (`hotel_id` / Zodomus id) → `property_channel_listings.externalListingId` / `properties.zodomusPropertyId`
   * 2) For **Booking**, if `hotel_id` was present in the email but no row matches → **stop** (do not guess via reservation/name/default).
   * 3) Otherwise: reservation id → booking row; property name (loose).
   * 4) **Booking / Airbnb:** if nothing matched → **null** (no default listing, no `RESEND_INBOUND_PROPERTY_ID`).
   * 5) **Direct:** optional `RESEND_INBOUND_PROPERTY_ID` only — never “first property”.
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

    if (channel === 'booking' || channel === 'airbnb') {
      this.logger.warn(
        `Inbound routing: no property match for ${channel} (listing/reservation/name); refusing default listing`,
      );
      return null;
    }

    return this.resolveInboundPropertyId(ownerId);

  }

  /**
   * Direct / generic inbound only: explicit `RESEND_INBOUND_PROPERTY_ID` if set and owned.
   * Does not pick the owner’s first property (avoids wrong assignment).
   */
  private async resolveInboundPropertyId(ownerId: string): Promise<string | null> {
    const explicit = this.config.get<string>('RESEND_INBOUND_PROPERTY_ID')?.trim();
    if (!explicit) return null;
    try {
      await this.propertyService.findOne(explicit, ownerId);
      return explicit;
    } catch {
      this.logger.warn(
        `RESEND_INBOUND_PROPERTY_ID=${explicit} is missing or not owned by this user; no property fallback`,
      );
      return null;
    }
  }



  /**
   * Mirror inbound mail into the property chat inbox. Conversation key = email, or email+reservation when known
   * (same guest email, different OTA booking → separate inbox rows). Does not choose the listing.
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
    reservationId: string | null,
    messagingGuestMessageId: string,
    emailAttachments: EmailInboundAttachment[],
    bookingHotelIdFromEmail: string | null = null,
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

          'Email→chat: no resolved property (OTA needs linked listing/reservation; direct may set RESEND_INBOUND_PROPERTY_ID).',

        );

        return null;

      }



      const guestKey = this.conversationService.buildEmailExternalGuestKey(guestEmail, reservationId);

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
        bookingMeta = await this.bookingComMetadataService.buildForUserMessage(conv.id, previewText, {
          hotelIdFromEmail: bookingHotelIdFromEmail,
        });
      } catch (metaErr) {
        this.logger.warn(
          `Email→chat: booking metadata skipped for conv ${conv.id}: ${(metaErr as Error).message}`,
        );
      }

      let chatMetadata: BookingComMessageMetadata | EmailInboundMessageMetadata | undefined;
      if (emailAttachments.length > 0) {
        const inbound: EmailInboundMessageMetadata = {
          channel: 'email_inbound',
          messagingMessageId: messagingGuestMessageId,
          attachments: emailAttachments,
          ...(bookingMeta ? { bookingCom: bookingMeta } : {}),
        };
        chatMetadata = inbound;
      } else if (bookingMeta) {
        chatMetadata = bookingMeta;
      }

      const listPreviewBookingArg =
        chatMetadata?.channel === 'email_inbound' && chatMetadata.bookingCom
          ? chatMetadata.bookingCom
          : chatMetadata?.channel === 'booking_com'
            ? chatMetadata
            : null;
      const listPreview = listPreviewForInbox(previewText, listPreviewBookingArg);

      const saved = await this.chatService.saveMessage({
        propertyId,
        conversationId: conv.id,
        content: previewText,
        role: 'user',
        source: 'ai',
        metadata: chatMetadata,
        channel: conversationChannelToMessageChannel(conv.channel),
      });

      await this.conversationService.touch(conv.id, listPreview);

      await this.conversationService.setGuestDisplayName(
        conv.id,
        guestDisplayName?.trim() || bookingMeta?.guestName?.trim() || null,
      );

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

        content: (m.agentText?.trim() || m.text) ?? '',

      }));

      const freshEarly = await this.threadRepo.findOne({ where: { id: thread.id } });

      if (freshEarly?.conversationId) {
        await this.aiDraftApproval.supersedePendingDrafts(freshEarly.conversationId);
      }

      let kbEmpty = true;

      let kbWeakMatch = true;

      let kbContextForAgent = 'No knowledge base entries yet.';

      let propertyLabel = `Property (${thread.channel})`;

      if (freshEarly?.propertyId) {

        try {

          const property = await this.propertyService.findOne(freshEarly.propertyId, thread.ownerId);

          propertyLabel = property.name;

        } catch {

          /* keep generic label */

        }

        const [kbSearch, globalRulesRow] = await Promise.all([

          this.knowledgeBaseService.searchRelevant(freshEarly.propertyId, userText, 8),

          this.companyGlobalRulesService.getForProperty(freshEarly.propertyId),

        ]);

        kbWeakMatch = kbSearch.isWeakMatch;

        const propertyKbText = kbWeakMatch ? '' : formatKnowledgeBaseEntriesForAgent(kbSearch.entries);

        const globalRules = globalRulesRow ?? {
          globalDescription: null,
          globalRules: null,
          globalQaEntries: [],
        };

        const built = buildAgentKnowledgeContext({

          globalRules,

          propertyKbText,

          propertyKbWeakMatch: kbWeakMatch,

        });

        kbContextForAgent = built.kbContextForAgent;

        kbEmpty = !built.hasAnyKnowledge;

      }

      const rawDraft = await this.agentService.processMessage(propertyLabel, kbContextForAgent, userText, chatHistory);

      const { rawEndsEscalate, textWithoutMarker } = parseAssistantEscalation(rawDraft);

      const forcedByForbidden = shouldForceEscalationGuestReply(textWithoutMarker);

      const modelSaysEscalateWithoutMarker =
        assistantReplyIndicatesEscalationWithoutMarker(textWithoutMarker);

      /** Same as web chat `chat.gateway` — without this, Telegram stays silent when KB looks strong but the model omits [ESCALATE]. */
      const kbWeakWithoutCoverage = kbWeakMatch && kbEmpty;

      const notifyStaff =
        kbEmpty ||
        forcedByForbidden ||
        kbWeakWithoutCoverage ||
        rawEndsEscalate ||
        modelSaysEscalateWithoutMarker;

      /** Canned reply iff no KB-backed answer to show: same rule as `GuestAiPipelineService`. */
      const guestEscalationUi =
        kbEmpty ||
        forcedByForbidden ||
        kbWeakWithoutCoverage ||
        rawEndsEscalate ||
        modelSaysEscalateWithoutMarker;

      const escalationFallback = resolveGuestEscalationFallback(userText);

      /** Always use the fixed localized phrase for escalation — model wording is too variable. */
      let guestSafe: string;

      if (!guestEscalationUi) {

        guestSafe = textWithoutMarker;

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

      const requiresApproval = this.config.get<boolean>('AI_REPLY_REQUIRES_APPROVAL') ?? false;

      /** Guest email — skipped when manager must approve the draft in inbox first. */
      if (!requiresApproval) {
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
      } else {
        this.logger.log(
          `AI reply email held for approval (AI_REPLY_REQUIRES_APPROVAL=true); threadId=${thread.id}`,
        );
      }

      const fresh = await this.threadRepo.findOne({ where: { id: thread.id } });

      /** До сохранения assistant в чат: иначе ошибка saveMessage/inbox уводит в catch и Telegram не вызывается. */
      const propertyIdForTg = fresh?.propertyId ?? thread.propertyId;

      if (notifyStaff && propertyIdForTg) {

        try {

          const property = await this.propertyService.findOne(propertyIdForTg, thread.ownerId);

          const attRows = await this.attachmentRepo.find({ where: { messageId: guestMessageId } });

          const escalationAttachments =
            attRows.length > 0
              ? attRows.map((a) => ({
                  storageKey: a.storageKey,
                  contentType: a.contentType,
                  fileName: a.fileName,
                }))
              : undefined;

          await this.telegramService.sendEscalationIfConfigured({

            propertyId: propertyIdForTg,

            ownerId: thread.ownerId,

            propertyName: property.name,

            guestQuestion: guestQuestionForTelegram,

            guestMessageId: chatGuestMessageId,

            conversationId: fresh?.conversationId ?? undefined,

            messagingThreadId: thread.id,

            escalationAttachments,

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

            channel: conversationChannelToMessageChannel(CONVERSATION_CHANNEL.EMAIL),

            deliveryStatus: requiresApproval ? MessageDeliveryStatus.DRAFT : MessageDeliveryStatus.SENT,

          });

          const inboxStatus = requiresApproval || notifyStaff ? 'needs_human' : 'resolved';

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
    let convId = await this.conversationService.findEmailConversationIdByGuestEmail(
      propertyId,
      email,
      t.reservationId,
    );
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
      this.conversationService.buildEmailExternalGuestKey(email, t.reservationId),
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
    opts?: {
      messagingThreadId?: string | null;
      staffAttachments?: Array<{ storageKey: string; fileName: string; contentType: string }>;
    },
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
          const resFromKey = this.parseReservationFromExternalKey(conv.externalGuestKey);
          const qb = this.threadRepo
            .createQueryBuilder('t')
            .where('t.property_id = :pid', { pid: conv.propertyId })
            .andWhere('LOWER(t.guest_email) = :email', { email: guestEmailAddr });
          if (resFromKey) {
            qb.andWhere('t.reservation_id = :rid', { rid: resFromKey });
          }
          thread = await qb.orderBy('t.updated_at', 'DESC').getOne();
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
        const resFromKey = this.parseReservationFromExternalKey(conv.externalGuestKey);
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
                reservationId: resFromKey,
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
      let emailAttachments: Array<{ filename: string; content: Buffer; contentType?: string }> | undefined;
      if (opts?.staffAttachments?.length && this.storageService.isConfigured()) {
        emailAttachments = [];
        for (const a of opts.staffAttachments) {
          const { buffer, contentType } = await this.storageService.getObjectBuffer(a.storageKey);
          emailAttachments.push({
            filename: a.fileName,
            content: buffer,
            contentType: a.contentType || contentType,
          });
        }
      }
      await this.replySender.send(toAddr, guestSafe, emailAttachments?.length ? { attachments: emailAttachments } : undefined);
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

      throw err;

    }

  }

  async sendReply(threadId: string, text: string, ownerId: string): Promise<void> {

    const thread = await this.threadRepo.findOneOrFail({ where: { id: threadId, ownerId } });

    const guestSafe =

      stripEscalationForGuestDisplay(text) || resolveGuestEscalationFallback(text);



    if (thread.conversationId && thread.propertyId) {

      const convForThread = await this.conversationService.findById(thread.conversationId);

      const saved = await this.chatService.saveMessage({

        propertyId: thread.propertyId,

        conversationId: thread.conversationId,

        userId: ownerId,

        content: guestSafe,

        role: 'assistant',

        source: 'staff',

        channel: conversationChannelToMessageChannel(convForThread.channel),

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



  private toMessagingMessagePublic(m: MessagingMessageEntity): MessagingMessagePublicDto {
    return {
      id: m.id,
      threadId: m.threadId,
      role: m.role,
      text: m.text,
      agentText: m.agentText,
      rawEmailId: m.rawEmailId,
      sentAt: m.sentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      attachments: (m.attachments ?? []).map((a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    };
  }

  async getThreadWithMessages(
    threadId: string,
    ownerId: string,
  ): Promise<{ thread: MessagingThreadEntity; messages: MessagingMessagePublicDto[] }> {
    const thread = await this.threadRepo.findOneOrFail({ where: { id: threadId, ownerId } });
    const messages = await this.messageRepo.find({
      where: { threadId },
      order: { createdAt: 'ASC' },
      relations: ['attachments'],
    });
    return { thread, messages: messages.map((m) => this.toMessagingMessagePublic(m)) };
  }
}


