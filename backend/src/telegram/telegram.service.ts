import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository, IsNull, Not, MoreThan } from 'typeorm';
import axios from 'axios';
import { EscalationEntity } from './entities/escalation.entity';
import { PropertyNotificationSettingsEntity } from './entities/property-notification-settings.entity';
import { StaffRepliedEvent } from '../common/events/staff.events';
import { ChatService } from '../chat/chat.service';
import { UserService } from '../user/user.service';
import {
  TELEGRAM_INSTRUCTION_NO_OPEN_ESCALATION,
  TELEGRAM_INSTRUCTION_REPLY_NEEDS_TEXT,
  TELEGRAM_INSTRUCTION_REPLY_REQUIRED,
  TELEGRAM_STAFF_REPLY_CONFIRMED,
} from './constants/telegram-instruction.constants';

interface TelegramSendMessageResponse {
  ok: boolean;
  result: { message_id: number };
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
    private readonly userService: UserService,
    @InjectRepository(EscalationEntity)
    private readonly escalationRepository: Repository<EscalationEntity>,
    @InjectRepository(PropertyNotificationSettingsEntity)
    private readonly settingsRepository: Repository<PropertyNotificationSettingsEntity>,
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
  ): Promise<EscalationEntity> {
    const escalation = this.escalationRepository.create({
      propertyId,
      propertyName,
      guestMessageId,
      guestQuestion,
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

    if (!escalation) {
      this.logger.warn(`No open escalation for tg_message_id=${replyToId}`);
      await this.sendInstructionMessage(chatId, TELEGRAM_INSTRUCTION_NO_OPEN_ESCALATION);
      return;
    }

    const savedMessage = await this.chatService.saveMessage({
      propertyId: escalation.propertyId,
      content: replyText,
      role: 'assistant',
      source: 'staff',
    });

    escalation.staffReply = replyText;
    escalation.resolvedAt = new Date();
    await this.escalationRepository.save(escalation);

    this.eventEmitter.emit(
      'staff.replied',
      new StaffRepliedEvent(
        escalation.propertyId,
        savedMessage.id,
        replyText,
        savedMessage.createdAt.toISOString(),
      ),
    );

    this.logger.log(
      `Staff reply saved for escalation ${escalation.id}, property ${escalation.propertyId}`,
    );

    await this.sendStaffReplyConfirmation(chatId, message.message_id);
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
    return this.escalationRepository.find({
      where: { propertyId, staffReply: Not(IsNull()), createdAt: MoreThan(since) },
      order: { createdAt: 'DESC' },
    });
  }

  async countResolvedEscalations(propertyId: string, days: number): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.escalationRepository.count({
      where: { propertyId, staffReply: Not(IsNull()), createdAt: MoreThan(since) },
    });
  }

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}
