import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import axios from 'axios';
import { EscalationEntity } from './entities/escalation.entity';
import { IncidentManagerNoteEvent } from '../common/events/incident.events';
import { StaffReplyService } from '../chat/staff-reply.service';
import { ChatService } from '../chat/chat.service';
import { ConversationService } from '../chat/conversation.service';
import { MessagingService } from '../messaging/messaging.service';
import { UserService } from '../user/user.service';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import {
  TELEGRAM_INCIDENT_REPLY_CONFIRMED,
  TELEGRAM_INSTRUCTION_NO_THREAD,
  TELEGRAM_INSTRUCTION_REPLY_NEEDS_TEXT,
  TELEGRAM_INSTRUCTION_REPLY_REQUIRED,
  TELEGRAM_STAFF_REPLY_CONFIRMED,
} from './constants/telegram-instruction.constants';
import { TelegramDeliveryService } from './telegram-delivery.service';
import { TelegramMetricsService } from './telegram-metrics.service';
import { sleep } from './telegram-retries.util';

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
  }): Promise<void> {
    const {
      propertyId,
      ownerId,
      propertyName,
      guestQuestion,
      guestMessageId,
      conversationId,
    } = params;
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
        guestQuestion,
        guestMessageId,
        chatId,
        conversationId,
      );
    } catch (err) {
      this.logger.error(`Escalation Telegram failed for property ${propertyId}`, err as Error);
    }
  }

  async sendEscalationAlert(
    propertyId: string,
    propertyName: string,
    guestQuestion: string,
    /** Chat inbox message id; optional if `conversationId` is set (email bridge edge cases). */
    guestMessageId: string | null,
    telegramChatId: string,
    conversationId?: string,
  ): Promise<EscalationEntity> {
    const escalation = this.escalationRepository.create({
      propertyId,
      propertyName,
      ...(guestMessageId ? { guestMessageId } : {}),
      guestQuestion,
      ...(conversationId ? { conversationId } : {}),
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
   * Incident alert for managers. Optional photo URLs — Telegram servers must fetch them (HTTPS;
   * localhost URLs are skipped and noted in text).
   * Returns message_id of the first Telegram message (for reply threading).
   */
  async notifyIncident(
    propertyId: string,
    ownerId: string,
    text: string,
    photoUrls?: string[],
  ): Promise<number | null> {
    const chatId = await this.resolveOwnerTelegramChatId(ownerId);
    if (!chatId || !this.isEnabled) {
      if (!chatId) {
        this.logger.warn(`Incident notify: no Telegram chat for property ${propertyId}`);
      }
      return null;
    }

    const usable = (photoUrls ?? []).filter((u) => this.isTelegramReachablePhotoUrl(u));
    const skipped = (photoUrls?.length ?? 0) - usable.length;
    const extra =
      skipped > 0
        ? `\n\n📷 ${skipped} фото не отправлено в Telegram (нужен публичный HTTPS URL API, не localhost). Фото в RentAI.`
        : '';

    const fullText = text + extra;

    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this.notifyIncidentSendOnce(chatId, fullText, usable);
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

  private async notifyIncidentSendOnce(
    chatId: string,
    fullText: string,
    usable: string[],
  ): Promise<number | null> {
    try {
      if (usable.length === 0) {
        const response = await axios.post<TelegramSendMessageResponse>(
          `${this.apiBase}/sendMessage`,
          { chat_id: chatId, text: fullText },
          { timeout: 30000 },
        );
        return response.data.result.message_id;
      }

      if (usable.length === 1) {
        const cap = fullText.length > 1024 ? `${fullText.slice(0, 1021)}…` : fullText;
        const response = await axios.post<TelegramSendMessageResponse>(
          `${this.apiBase}/sendPhoto`,
          { chat_id: chatId, photo: usable[0], caption: cap },
          { timeout: 30000 },
        );
        return response.data.result.message_id;
      }

      const cap = fullText.length > 1024 ? `${fullText.slice(0, 1021)}…` : fullText;
      const media = usable.slice(0, 10).map((url, i) => ({
        type: 'photo' as const,
        media: url,
        ...(i === 0 ? { caption: cap } : {}),
      }));
      const response = await axios.post<TelegramSendMediaGroupResponse>(
        `${this.apiBase}/sendMediaGroup`,
        { chat_id: chatId, media },
        { timeout: 30000 },
      );
      const first = response.data.result?.[0];
      return first?.message_id ?? null;
    } catch (err) {
      this.logger.error(`Telegram incident notify failed: ${(err as Error).message}`);
      try {
        const response = await axios.post<TelegramSendMessageResponse>(
          `${this.apiBase}/sendMessage`,
          { chat_id: chatId, text: fullText },
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
    const message = update.message;
    if (!message) return;

    const chatId = String(message.chat.id);

    if (!this.isEnabled) {
      return;
    }

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

    const escalation = await this.escalationRepository
      .createQueryBuilder('e')
      .where(
        '(e.tgBotMessageId = :mid OR CAST(e.tgBotMessageId AS TEXT) = :midStr)',
        { mid: replyToId, midStr: String(replyToId) },
      )
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
      if (!convId) {
        /** Prefer email inbox conversation so staff reply + email relay match the guest thread (not a random web thread). */
        convId =
          (await this.conversationService.findLatestEmailConversationIdForProperty(escalation.propertyId)) ??
          undefined;
      }
      if (!convId) {
        convId =
          (await this.messagingService.resolveConversationIdForEscalationFallback(escalation.propertyId)) ??
          undefined;
      }
      if (!convId) {
        this.logger.warn(
          `Telegram escalation ${escalation.id}: cannot resolve conversationId (guestMessageId=${escalation.guestMessageId ?? 'null'})`,
        );
        await this.sendInstructionMessage(chatId, TELEGRAM_INSTRUCTION_NO_THREAD);
        return;
      }

      convId = convId.trim();
      escalation.conversationId = convId;

      let savedMessage;
      try {
        savedMessage = await this.staffReplyService.applyStaffReply({
          propertyId: escalation.propertyId,
          conversationId: convId,
          content: replyText,
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
        `Telegram staff reply OK: escalation=${escalation.id} conv=${convId} chatMessageId=${savedMessage.id}`,
      );

      await this.sendStaffReplyConfirmation(chatId, message.message_id);
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
