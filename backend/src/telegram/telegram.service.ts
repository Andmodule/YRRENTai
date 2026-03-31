import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository, IsNull } from 'typeorm';
import axios from 'axios';
import { EscalationEntity } from './entities/escalation.entity';
import { PropertyNotificationSettingsEntity } from './entities/property-notification-settings.entity';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { ChatService } from '../chat/chat.service';
import { ConversationService } from '../chat/conversation.service';
import { UserService } from '../user/user.service';
import { IncidentEntity } from '../incidents/entities/incident.entity';
import { TasksGateway } from '../tasks/tasks.gateway';
import {
  TELEGRAM_INCIDENT_REPLY_CONFIRMED,
  TELEGRAM_INSTRUCTION_NO_THREAD,
  TELEGRAM_INSTRUCTION_REPLY_NEEDS_TEXT,
  TELEGRAM_INSTRUCTION_REPLY_REQUIRED,
  TELEGRAM_STAFF_REPLY_CONFIRMED,
} from './constants/telegram-instruction.constants';

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
    @InjectRepository(PropertyNotificationSettingsEntity)
    private readonly settingsRepository: Repository<PropertyNotificationSettingsEntity>,
    @InjectRepository(IncidentEntity)
    private readonly incidentRepository: Repository<IncidentEntity>,
    @Inject(forwardRef(() => TasksGateway))
    private readonly tasksGateway: TasksGateway,
  ) {
    const token = configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  get isEnabled(): boolean {
    return !!this.configService.get<string>('TELEGRAM_BOT_TOKEN');
  }

  /**
   * Resolves the effective Telegram chat ID for a property escalation.
   * Priority: per-property override → account-level (owner) setting.
   */
  async resolveAlertChatId(
    propertyId: string,
    ownerId: string,
  ): Promise<string | null> {
    const propSettings = await this.settingsRepository.findOne({ where: { propertyId } });
    if (propSettings?.telegramChatId) return propSettings.telegramChatId;

    const owner = await this.userService.findById(ownerId);
    return owner?.telegramChatId ?? null;
  }

  async sendEscalationAlert(
    propertyId: string,
    propertyName: string,
    guestQuestion: string,
    guestMessageId: string,
    telegramChatId: string,
    conversationId?: string,
  ): Promise<EscalationEntity> {
    const escalation = this.escalationRepository.create({
      propertyId,
      propertyName,
      guestMessageId,
      guestQuestion,
      ...(conversationId ? { conversationId } : {}),
    });
    await this.escalationRepository.save(escalation);

    if (!this.isEnabled) {
      return escalation;
    }

    const shortCode = propertyId.slice(0, 8).toUpperCase();

    const text =
      `🔔 *Вопрос гостя*\n` +
      `Объект: *${this.escape(propertyName)}* \\[${shortCode}\\]\n\n` +
      `«${this.escape(guestQuestion)}»\n\n` +
      `↩️ Ответьте _reply_ на это сообщение — ответ автоматически уйдёт гостю\\.`;

    try {
      const response = await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        { chat_id: telegramChatId, text, parse_mode: 'MarkdownV2' },
        { timeout: 10000 },
      );
      escalation.tgBotMessageId = response.data.result.message_id;
      await this.escalationRepository.save(escalation);
    } catch (err) {
      this.logger.error(`Telegram alert failed: ${(err as Error).message}`);
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
    const chatId = await this.resolveAlertChatId(propertyId, ownerId);
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

    const escalation = await this.escalationRepository.findOne({
      where: { tgBotMessageId: replyToId as unknown as number, resolvedAt: IsNull() },
    });

    if (escalation) {
      const convId = escalation.conversationId ?? undefined;

      const savedMessage = await this.chatService.saveMessage({
        propertyId: escalation.propertyId,
        conversationId: convId,
        content: replyText,
        role: 'assistant',
        source: 'staff',
      });

      if (convId) {
        await this.conversationService.setStatus(convId, 'resolved');
        await this.conversationService.touch(convId, replyText);
      }

      escalation.staffReply = replyText;
      escalation.resolvedAt = new Date();
      escalation.kbProcessingStatus = 'pending';
      await this.escalationRepository.save(escalation);

      this.eventEmitter.emit(
        'staff.replied',
        new StaffRepliedEvent(
          escalation.propertyId,
          savedMessage.id,
          replyText,
          savedMessage.createdAt.toISOString(),
          convId,
        ),
      );

      this.logger.log(
        `Staff reply saved for escalation ${escalation.id}, property ${escalation.propertyId}`,
      );

      await this.sendStaffReplyConfirmation(chatId, message.message_id);
      return;
    }

    const incident = await this.incidentRepository
      .createQueryBuilder('i')
      .where('i.telegramNotifyMessageId = :mid', { mid: replyToId })
      .getOne();

    if (incident) {
      const prev = incident.managerNote?.trim() ?? '';
      incident.managerNote = prev
        ? `${prev}\n\n[Менеджер, Telegram] ${replyText}`
        : `[Менеджер, Telegram] ${replyText}`;
      await this.incidentRepository.save(incident);

      this.tasksGateway.emitIncidentManagerNote({
        incidentId: incident.id,
        text: replyText,
        reportedByUserId: incident.reportedBy,
      });

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

  async getNotificationSettings(
    propertyId: string,
  ): Promise<PropertyNotificationSettingsEntity | null> {
    return this.settingsRepository.findOne({ where: { propertyId } });
  }

  async upsertNotificationSettings(
    propertyId: string,
    telegramChatId: string | null,
  ): Promise<PropertyNotificationSettingsEntity> {
    let settings = await this.settingsRepository.findOne({ where: { propertyId } });
    if (!settings) {
      settings = this.settingsRepository.create({ propertyId });
    }
    settings.telegramChatId = telegramChatId ?? undefined;
    return this.settingsRepository.save(settings);
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

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}
