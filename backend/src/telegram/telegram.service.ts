import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeGuestQuestionForAlert } from '@rentai/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import axios from 'axios';
import { EscalationEntity } from './entities/escalation.entity';
import { IncidentManagerNoteEvent } from '../common/events/incident.events';
import { StaffReplyService } from '../chat/staff-reply.service';
import { MessageDeliveryStatus } from '../chat/enums/message-delivery-status.enum';
import { ChatService } from '../chat/chat.service';
import { ConversationService } from '../chat/conversation.service';
import { MessagingService } from '../messaging/messaging.service';
import { UserService } from '../user/user.service';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import {
  TELEGRAM_INCIDENT_REPLY_CONFIRMED,
  TELEGRAM_INSTRUCTION_ESCALATION_NO_CONVERSATION,
  TELEGRAM_INSTRUCTION_NO_THREAD,
  TELEGRAM_INSTRUCTION_REPLY_NEEDS_TEXT,
  TELEGRAM_INSTRUCTION_REPLY_REQUIRED,
  TELEGRAM_STAFF_REPLY_CONFIRMED,
  TELEGRAM_STAFF_REPLY_EMAIL_FAILED,
} from './constants/telegram-instruction.constants';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramMetricsService } from './telegram-metrics.service';
import { sleep } from './telegram-retries.util';
import { StaffTelegramBotService } from './staff-telegram-bot.service';
import { escapeTelegramHtml } from './utils/telegram-html.util';
import type { EscalationAttachmentRef } from './types/escalation-attachments.types';

interface TelegramSendMessageResponse {
  ok: boolean;
  result: { message_id: number };
}

interface TelegramSendMediaGroupResponse {
  ok: boolean;
  result: { message_id: number }[];
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number };
    text?: string;
    caption?: string;
    reply_to_message?: { message_id: number };
  };
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly apiBase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
    private readonly userService: UserService,
    @InjectRepository(EscalationEntity)
    private readonly escalationRepository: Repository<EscalationEntity>,
    @InjectRepository(IncidentEntity)
    private readonly incidentRepository: Repository<IncidentEntity>,
    @Inject(forwardRef(() => MessagingService))
    private readonly messagingService: MessagingService,
    @Inject(forwardRef(() => StaffReplyService))
    private readonly staffReplyService: StaffReplyService,
    private readonly telegramDelivery: TelegramDeliveryService,
    private readonly telegramMetrics: TelegramMetricsService,
    private readonly staffTelegramBot: StaffTelegramBotService,
  ) {
    const token = configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  get isEnabled(): boolean {
    return !!this.configService.get<string>('TELEGRAM_BOT_TOKEN');
  }

  /**
   * Единый чат на аккаунт: `users.telegramChatId` владельца (настройки в UI «аккаунт»).
   * Per-property Telegram не используется.
   */
  async resolveAlertChatId(
    _propertyId: string,
    ownerId: string,
  ): Promise<string | null> {
    return this.resolveOwnerTelegramChatId(ownerId);
  }

  /** Один чат на аккаунт: `users.telegramChatId`. */
  private async resolveOwnerTelegramChatId(ownerId: string): Promise<string | null> {
    const owner = await this.userService.findById(ownerId);
    return owner?.telegramChatId?.trim() || null;
  }

  /** Нужен хотя бы один якорь, иначе эскалацию в Telegram не создаём (нельзя надёжно связать ответ менеджера с гостем). */
  private hasEscalationAnchor(
    guestMessageId: string | null | undefined,
    conversationId: string | undefined,
    messagingThreadId?: string | null,
  ): boolean {
    const hasGuest = Boolean(guestMessageId?.trim());
    const hasConv = Boolean(conversationId?.trim());
    const hasThread = Boolean(messagingThreadId?.trim());
    return hasGuest || hasConv || hasThread;
  }

  /**
   * Единая точка для алертов эскалации (веб-сокет и email-поток): одинаковое разрешение chat_id и логирование.
   */
  async sendEscalationIfConfigured(params: {
    propertyId: string;
    ownerId: string;
    propertyName: string;
    guestQuestion: string;
    guestMessageId: string | null;
    conversationId?: string;
    /** Почтовый поток: привязка к `messaging_threads` до появления `conversationId` в инбоксе. */
    messagingThreadId?: string | null;
    /** R2 keys for Telegram delivery after the text alert (inbound email attachments). */
    escalationAttachments?: EscalationAttachmentRef[];
  }): Promise<void> {
    const {
      propertyId,
      ownerId,
      propertyName,
      guestQuestion,
      guestMessageId,
      conversationId,
      messagingThreadId,
      escalationAttachments,
    } = params;
    const convTrim = conversationId?.trim();
    const threadTrim = messagingThreadId?.trim();
    if (!this.hasEscalationAnchor(guestMessageId, convTrim, threadTrim)) {
      this.logger.warn(
        `Escalation skipped for property ${propertyId}: need guestMessageId, conversationId, or messagingThreadId (all missing)`,
      );
      return;
    }
    try {
      const chatId = await this.resolveOwnerTelegramChatId(ownerId);
      if (!chatId) {
        this.logger.warn(
          `Escalation Telegram skipped: no account telegramChatId for owner of property ${propertyId}`,
        );
        return;
      }
      await this.sendEscalationAlert(
        propertyId,
        propertyName,
        sanitizeGuestQuestionForAlert(guestQuestion),
        guestMessageId,
        chatId,
        convTrim,
        threadTrim,
        escalationAttachments,
      );
    } catch (err) {
      this.logger.error(`Escalation Telegram failed for property ${propertyId}`, err as Error);
    }
  }

  async sendEscalationAlert(
    propertyId: string,
    propertyName: string,
    guestQuestion: string,
    /** Хотя бы один якорь: guestMessageId, conversationId или messagingThreadId; см. `hasEscalationAnchor`. */
    guestMessageId: string | null,
    telegramChatId: string,
    conversationId?: string,
    messagingThreadId?: string | null,
    escalationAttachments?: EscalationAttachmentRef[],
  ): Promise<EscalationEntity | null> {
    const convTrim = conversationId?.trim();
    const threadTrim = messagingThreadId?.trim();
    if (!this.hasEscalationAnchor(guestMessageId, convTrim, threadTrim)) {
      this.logger.warn(
        `sendEscalationAlert skipped for property ${propertyId}: need guestMessageId, conversationId, or messagingThreadId`,
      );
      return null;
    }
    const alertQuestion = sanitizeGuestQuestionForAlert(guestQuestion);
    const att =
      escalationAttachments?.filter((a) => a.storageKey?.trim() && a.contentType?.trim()) ?? [];
    const escalation = this.escalationRepository.create({
      propertyId,
      propertyName,
      ...(guestMessageId?.trim() ? { guestMessageId: guestMessageId.trim() } : {}),
      guestQuestion: alertQuestion,
      ...(convTrim ? { conversationId: convTrim } : {}),
      ...(threadTrim ? { messagingThreadId: threadTrim } : {}),
      ...(att.length > 0 ? { escalationAttachments: att } : {}),
    });
    await this.escalationRepository.save(escalation);

    if (!this.isEnabled) {
      this.logger.warn(
        'Escalation saved but Telegram is disabled (TELEGRAM_BOT_TOKEN missing); alerts are not delivered.',
      );
      return escalation;
    }

    try {
      await this.telegramDelivery.enqueueOrDeliver({
        escalationId: escalation.id,
        telegramChatId,
      });
    } catch (err) {
      this.logger.error(
        `Telegram escalation delivery failed escalationId=${escalation.id}`,
        err as Error,
      );
    }

    return escalation;
  }


  /**
   * Urgent incident alert for the account owner (manager verification before any technician dispatch).
   * Optional `MANAGER_WEB_APP_URL` adds an inline link to the web dashboard incident view.
   */
  async notifyIncident(params: {
    incidentId: string;
    ownerId: string;
    reporterName: string;
    propertyName: string;
    description: string;
    photoUrls?: string[];
  }): Promise<number | null> {
    const { incidentId, ownerId, reporterName, propertyName, description, photoUrls } = params;
    const chatId = await this.resolveOwnerTelegramChatId(ownerId);
    if (!chatId || !this.isEnabled) {
      if (!chatId) {
        this.logger.warn(`Incident notify: no Telegram chat for owner ${ownerId}`);
      }
      return null;
    }

    const managerBase = this.configService.get<string>('MANAGER_WEB_APP_URL')?.trim().replace(/\/$/, '');
    const keyboard =
      managerBase && managerBase.startsWith('https://')
        ? {
            inline_keyboard: [
              [
                {
                  text: '🔍 Проверить и назначить',
                  url: `${managerBase}/incidents?incident=${encodeURIComponent(incidentId)}`,
                },
              ],
            ],
          }
        : undefined;
    if (!managerBase?.startsWith('https://')) {
      this.logger.warn(
        'MANAGER_WEB_APP_URL unset or not HTTPS — incident Telegram alert has no dashboard button.',
      );
    }

    const usable = (photoUrls ?? []).filter((u) => this.isTelegramReachablePhotoUrl(u));
    const skipped = (photoUrls?.length ?? 0) - usable.length;
    const extra =
      skipped > 0
        ? `\n\n📷 ${skipped} фото не отправлено в Telegram (нужен публичный HTTPS URL API, не localhost). Фото в RentAI.`
        : '';

    const bodyLines = [
      `🚨 Новый инцидент от ${escapeTelegramHtml(reporterName)}`,
      `📍 Объект: ${escapeTelegramHtml(propertyName)}`,
      `📝 Описание: ${escapeTelegramHtml(description)}`,
    ];
    const fullText = bodyLines.join('\n') + extra;

    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.notifyIncidentSendOnce(chatId, fullText, usable, keyboard);
      if (r !== null) {
        this.telegramMetrics.incidentNotify.inc({ status: 'success' });
        return r;
      }
      if (attempt < 2) {
        await sleep(Math.min(2000 * 2 ** attempt, 20_000));
      }
    }
    this.telegramMetrics.incidentNotify.inc({ status: 'failure' });
    return null;
  }

  /**
   * Короткий ops-алерт для владельца (тот же `users.telegramChatId`, что и эскалации).
   * Используется при неожиданных ошибках inbound email pipeline.
   */
  async notifyOwnerOpsMessage(ownerId: string, text: string): Promise<void> {
    const chatId = await this.resolveOwnerTelegramChatId(ownerId);
    if (!chatId || !this.isEnabled) return;
    const body = text.length > 4000 ? `${text.slice(0, 3997)}…` : text;
    try {
      await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        { chat_id: chatId, text: body },
        { timeout: 15000 },
      );
    } catch (err) {
      this.logger.error(`Telegram ops notify failed: ${(err as Error).message}`);
    }
  }

  private async notifyIncidentSendOnce(
    chatId: string,
    fullText: string,
    usable: string[],
    replyMarkup?: { inline_keyboard: { text: string; url: string }[][] },
  ): Promise<number | null> {
    try {
      if (usable.length === 0) {
        const response = await axios.post<TelegramSendMessageResponse>(
          `${this.apiBase}/sendMessage`,
          {
            chat_id: chatId,
            text: fullText,
            parse_mode: 'HTML',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          },
          { timeout: 30000 },
        );
        return response.data.result.message_id;
      }

      if (usable.length === 1) {
        const cap = fullText.length > 1024 ? `${fullText.slice(0, 1021)}…` : fullText;
        const response = await axios.post<TelegramSendMessageResponse>(
          `${this.apiBase}/sendPhoto`,
          {
            chat_id: chatId,
            photo: usable[0],
            caption: cap,
            parse_mode: 'HTML',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          },
          { timeout: 30000 },
        );
        return response.data.result.message_id;
      }

      const cap = fullText.length > 1024 ? `${fullText.slice(0, 1021)}…` : fullText;
      const media = usable.slice(0, 10).map((url, i) =>
        i === 0
          ? {
              type: 'photo' as const,
              media: url,
              caption: cap,
              parse_mode: 'HTML' as const,
            }
          : {
              type: 'photo' as const,
              media: url,
            },
      );
      const response = await axios.post<TelegramSendMediaGroupResponse>(
        `${this.apiBase}/sendMediaGroup`,
        { chat_id: chatId, media },
        { timeout: 30000 },
      );
      const first = response.data.result?.[0];
      const mid = first?.message_id ?? null;
      if (replyMarkup) {
        await axios.post<TelegramSendMessageResponse>(
          `${this.apiBase}/sendMessage`,
          {
            chat_id: chatId,
            text: 'Назначьте исполнителя после проверки:',
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          },
          { timeout: 15000 },
        );
      }
      return mid;
    } catch (err) {
      this.logger.error(`Telegram incident notify failed: ${(err as Error).message}`);
      try {
        const response = await axios.post<TelegramSendMessageResponse>(
          `${this.apiBase}/sendMessage`,
          {
            chat_id: chatId,
            text: fullText,
            parse_mode: 'HTML',
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          },
          { timeout: 10000 },
        );
        return response.data.result.message_id;
      } catch {
        return null;
      }
    }
  }

  /** Telegram Bot API cannot fetch localhost; prefer HTTPS in production (API_PUBLIC_URL). */
  private isTelegramReachablePhotoUrl(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const h = u.hostname.toLowerCase();
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false;
      return true;
    } catch {
      return false;
    }
  }

  async handleWebhookUpdate(update: TelegramUpdate): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const firstTime = await this.staffTelegramBot.tryMarkProcessed(update.update_id, 'main');
    if (!firstTime) {
      return;
    }

    const message = update.message;
    if (!message) return;

    const chatId = String(message.chat.id);

    if (!message.reply_to_message) {
      await this.sendInstructionMessage(chatId, TELEGRAM_INSTRUCTION_REPLY_REQUIRED);
      return;
    }

    const replyText = (message.text ?? message.caption ?? '').trim();
    if (!replyText) {
      await this.sendInstructionMessage(chatId, TELEGRAM_INSTRUCTION_REPLY_NEEDS_TEXT);
      return;
    }

    const replyToId = message.reply_to_message.message_id;

    this.logger.log(
      `Telegram manager reply: chatId=${chatId} reply_to_message_id=${replyToId} len=${replyText.length}`,
    );

    /** `tgBotMessageId` — bigint; сравнение только через текст — стабильно в PG + TypeORM. */
    const escalation = await this.escalationRepository
      .createQueryBuilder('e')
      .where('CAST(e.tgBotMessageId AS TEXT) = :midStr', { midStr: String(replyToId) })
      .andWhere('e.resolvedAt IS NULL')
      .getOne();

    if (escalation) {
      let convId = escalation.conversationId ?? undefined;
      if (!convId && escalation.guestMessageId) {
        const guestMsg = await this.chatService.findMessageById(escalation.guestMessageId);
        if (guestMsg?.propertyId === escalation.propertyId) {
          convId = guestMsg.conversationId ?? undefined;
        }
      }
      if (!convId && escalation.messagingThreadId) {
        convId =
          (await this.messagingService.resolveConversationIdFromMessagingThread(
            escalation.messagingThreadId,
            escalation.propertyId,
          )) ?? undefined;
      }
      /**
       * Без `messagingThreadId` — старый fallback «последний диалог с привязанным тредом».
       * Если `messagingThreadId` есть, fallback отключён: иначе подставлялся чужой диалог, relay не находил тред и Resend не вызывался.
       */
      if (!convId && !escalation.messagingThreadId?.trim()) {
        convId =
          (await this.messagingService.resolveConversationIdForEscalationFallback(escalation.propertyId)) ??
          undefined;
      }
      if (!convId) {
        this.logger.warn(
          `Telegram escalation ${escalation.id}: cannot resolve conversationId (guestMessageId=${escalation.guestMessageId ?? 'null'}, storedConversationId=${escalation.conversationId ?? 'null'}, messagingThreadId=${escalation.messagingThreadId ?? 'null'})`,
        );
        await this.sendInstructionMessage(chatId, TELEGRAM_INSTRUCTION_ESCALATION_NO_CONVERSATION);
        return;
      }

      convId = convId.trim();
      escalation.conversationId = convId;

      /** Same path as POST /conversations/reply: persist + sockets + relayStaffReplyToEmailGuest. */
      let savedMessage;
      try {
        savedMessage = await this.staffReplyService.applyStaffReply({
          propertyId: escalation.propertyId,
          conversationId: convId,
          content: replyText,
          relayMessagingThreadId: escalation.messagingThreadId ?? null,
          awaitOutboundDelivery: true,
        });
      } catch (err) {
        this.logger.error(
          `Telegram staff reply failed for escalation ${escalation.id} conv=${convId}`,
          err as Error,
        );
        await this.sendInstructionMessage(chatId, TELEGRAM_INSTRUCTION_NO_THREAD);
        return;
      }

      escalation.staffReply = replyText;
      escalation.resolvedAt = new Date();
      escalation.kbProcessingStatus = 'pending';
      await this.escalationRepository.save(escalation);

      this.logger.log(
        `Telegram staff reply OK: escalation=${escalation.id} conv=${convId} chatMessageId=${savedMessage.id} delivery=${savedMessage.deliveryStatus}`,
      );

      if (savedMessage.deliveryStatus === MessageDeliveryStatus.SENT) {
        await this.sendStaffReplyConfirmation(chatId, message.message_id);
      } else if (savedMessage.deliveryStatus === MessageDeliveryStatus.ERROR) {
        await this.sendInstructionMessage(chatId, TELEGRAM_STAFF_REPLY_EMAIL_FAILED);
      } else {
        this.logger.warn(
          `Telegram staff reply: unexpected deliveryStatus=${savedMessage.deliveryStatus} messageId=${savedMessage.id}`,
        );
      }
      return;
    }

    const incident = await this.incidentRepository
      .createQueryBuilder('i')
      .where(
        '(i.telegramNotifyMessageId = :mid OR CAST(i.telegramNotifyMessageId AS TEXT) = :midStr)',
        { mid: replyToId, midStr: String(replyToId) },
      )
      .getOne();

    if (incident) {
      const prev = incident.managerNote?.trim() ?? '';
      incident.managerNote = prev
        ? `${prev}\n\n[Менеджер, Telegram] ${replyText}`
        : `[Менеджер, Telegram] ${replyText}`;
      await this.incidentRepository.save(incident);

      this.eventEmitter.emit(
        'incident.manager_note',
        new IncidentManagerNoteEvent(incident.id, replyText, incident.reportedBy),
      );

      await this.sendIncidentReplyConfirmation(chatId, message.message_id);
      return;
    }

    this.logger.warn(`No open escalation or incident for tg_message_id=${replyToId}`);
    await this.sendInstructionMessage(chatId, TELEGRAM_INSTRUCTION_NO_THREAD);
  }

  private async sendIncidentReplyConfirmation(chatId: string, replyToMessageId: number): Promise<void> {
    try {
      await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        {
          chat_id: chatId,
          text: TELEGRAM_INCIDENT_REPLY_CONFIRMED,
          reply_to_message_id: replyToMessageId,
        },
        { timeout: 10000 },
      );
    } catch (err) {
      this.logger.warn(`Telegram incident reply confirmation failed: ${(err as Error).message}`);
    }
  }

  /** Reply на сообщение менеджера — видно, что именно этот ответ ушёл гостю. */
  private async sendStaffReplyConfirmation(chatId: string, replyToMessageId: number): Promise<void> {
    try {
      await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        {
          chat_id: chatId,
          text: TELEGRAM_STAFF_REPLY_CONFIRMED,
          reply_to_message_id: replyToMessageId,
        },
        { timeout: 10000 },
      );
    } catch (err) {
      this.logger.warn(`Telegram staff reply confirmation failed: ${(err as Error).message}`);
    }
  }

  private async sendInstructionMessage(chatId: string, text: string): Promise<void> {
    try {
      await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        { chat_id: chatId, text },
        { timeout: 10000 },
      );
    } catch (err) {
      this.logger.warn(`Telegram instruction message failed: ${(err as Error).message}`);
    }
  }

  async getResolvedEscalations(propertyId: string, days: number): Promise<EscalationEntity[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.escalationRepository
      .createQueryBuilder('e')
      .where('e.propertyId = :propertyId', { propertyId })
      .andWhere('e.staffReply IS NOT NULL')
      .andWhere('e.createdAt > :since', { since })
      .andWhere('(e.kbProcessingStatus IS NULL OR e.kbProcessingStatus = :pending)', {
        pending: 'pending',
      })
      .orderBy('e.createdAt', 'DESC')
      .getMany();
  }

  async countResolvedEscalations(propertyId: string, days: number): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.escalationRepository
      .createQueryBuilder('e')
      .where('e.propertyId = :propertyId', { propertyId })
      .andWhere('e.staffReply IS NOT NULL')
      .andWhere('e.createdAt > :since', { since })
      .andWhere('(e.kbProcessingStatus IS NULL OR e.kbProcessingStatus = :pending)', {
        pending: 'pending',
      })
      .getCount();
  }
}
