import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sanitizeGuestQuestionForAlert } from '@rentai/shared';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { EscalationEntity } from './entities/escalation.entity';
import { TelegramMetricsService } from './telegram-metrics.service';
import { StorageService } from '../modules/storage/storage.service';
import type { EscalationAttachmentRef } from './types/escalation-attachments.types';

interface TelegramSendMessageResponse {
  ok: boolean;
  result: { message_id: number };
}

export interface TelegramEscalationDeliveryPayload {
  escalationId: string;
  telegramChatId: string;
}

const TELEGRAM_ESCALATION_MAX_ATTACHMENTS = 10;
const PRESIGN_TTL_SECONDS = 3600;

/**
 * HTTP delivery of escalation alerts to Telegram (used by BullMQ worker and inline retry path).
 */
@Injectable()
export class TelegramEscalationSenderService {
  private readonly logger = new Logger(TelegramEscalationSenderService.name);
  private readonly apiBase: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(EscalationEntity)
    private readonly escalationRepository: Repository<EscalationEntity>,
    private readonly metrics: TelegramMetricsService,
    private readonly storageService: StorageService,
  ) {
    const token = configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  get isEnabled(): boolean {
    return !!this.configService.get<string>('TELEGRAM_BOT_TOKEN');
  }

  /**
   * Single delivery attempt. Idempotent if tgBotMessageId already set.
   * @throws Error when Telegram rejects both MarkdownV2 and plain text.
   */
  async deliverEscalationOnce(payload: TelegramEscalationDeliveryPayload): Promise<void> {
    if (!this.isEnabled) {
      throw new Error('TELEGRAM_BOT_TOKEN not set');
    }

    const escalation = await this.escalationRepository.findOne({
      where: { id: payload.escalationId },
    });
    if (!escalation) {
      throw new Error(`Escalation ${payload.escalationId} not found`);
    }
    if (escalation.tgBotMessageId != null) {
      this.logger.debug(`Escalation ${payload.escalationId} already delivered, skipping`);
      return;
    }

    const propertyId = escalation.propertyId;
    const propertyName = escalation.propertyName;
    const guestQuestion = sanitizeGuestQuestionForAlert(escalation.guestQuestion);

    const mdText =
      `🔔 *Вопрос гостя*\n` +
      `Объект: *${this.escape(propertyName)}*\n` +
      `ID объекта: ${this.escape(propertyId)}\n\n` +
      `«${this.escape(guestQuestion)}»\n\n` +
      `↩️ Ответьте _reply_ на это сообщение — ответ автоматически уйдёт гостю\\.`;

    const plainText = this.buildEscalationPlainText(propertyName, propertyId, guestQuestion);

    const ok = await this.tryPostToChat(payload.telegramChatId, escalation, mdText, plainText);
    if (!ok) {
      this.metrics.escalationDelivery.inc({ status: 'failure' });
      throw new Error(
        `Telegram escalation failed for escalation=${payload.escalationId} chat=${payload.telegramChatId}`,
      );
    }
    this.metrics.escalationDelivery.inc({ status: 'success' });
    await this.deliverEscalationAttachments(payload.telegramChatId, escalation);
  }

  /**
   * After the text alert, send R2 files as Telegram photo/document (reply thread).
   * Uses presigned GET URLs so Telegram can pull bytes from R2.
   */
  private async deliverEscalationAttachments(
    telegramChatId: string,
    escalation: EscalationEntity,
  ): Promise<void> {
    const list = escalation.escalationAttachments;
    if (!list?.length) {
      return;
    }
    if (!this.storageService.isConfigured()) {
      this.logger.warn(
        `Escalation ${escalation.id}: ${list.length} attachment(s) on record but R2 not configured — skip Telegram media`,
      );
      return;
    }
    const replyTo = escalation.tgBotMessageId;
    if (replyTo == null) {
      return;
    }
    const slice = list.slice(0, TELEGRAM_ESCALATION_MAX_ATTACHMENTS);
    if (list.length > TELEGRAM_ESCALATION_MAX_ATTACHMENTS) {
      this.logger.warn(
        `Escalation ${escalation.id}: sending first ${TELEGRAM_ESCALATION_MAX_ATTACHMENTS} of ${list.length} attachments`,
      );
    }
    for (const ref of slice) {
      await this.sendOneEscalationAttachment(telegramChatId, replyTo, ref);
    }
  }

  private useTelegramPhotoApi(ref: EscalationAttachmentRef): boolean {
    const ct = ref.contentType.toLowerCase();
    if (!ct.startsWith('image/')) {
      return false;
    }
    return !ct.includes('svg');
  }

  private async sendOneEscalationAttachment(
    telegramChatId: string,
    replyToMessageId: number,
    ref: EscalationAttachmentRef,
  ): Promise<void> {
    try {
      const url = await this.storageService.getPresignedDownloadUrl(ref.storageKey, PRESIGN_TTL_SECONDS);
      const asPhoto = this.useTelegramPhotoApi(ref);
      const endpoint = asPhoto ? `${this.apiBase}/sendPhoto` : `${this.apiBase}/sendDocument`;
      const caption = ref.fileName.trim().slice(0, 1024) || undefined;
      const body = asPhoto
        ? {
            chat_id: telegramChatId,
            photo: url,
            reply_to_message_id: replyToMessageId,
          }
        : {
            chat_id: telegramChatId,
            document: url,
            reply_to_message_id: replyToMessageId,
            ...(caption ? { caption } : {}),
          };
      await axios.post(endpoint, body, { timeout: 120_000 });
    } catch (err) {
      const detail =
        axios.isAxiosError(err) && err.response?.data != null
          ? JSON.stringify(err.response.data)
          : (err as Error).message;
      this.logger.error(
        `Telegram escalation attachment failed file=${ref.fileName} key=${ref.storageKey}: ${detail}`,
      );
    }
  }

  private async tryPostToChat(
    telegramChatId: string,
    escalation: EscalationEntity,
    mdText: string,
    plainText: string,
  ): Promise<boolean> {
    const sendAndStore = async (payload: { text: string; parse_mode?: 'MarkdownV2' }) => {
      const response = await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        { chat_id: telegramChatId, ...payload },
        { timeout: 10000 },
      );
      escalation.tgBotMessageId = response.data.result.message_id;
      await this.escalationRepository.save(escalation);
    };
    try {
      await sendAndStore({ text: mdText, parse_mode: 'MarkdownV2' });
      return true;
    } catch (err) {
      const detail =
        axios.isAxiosError(err) && err.response?.data != null
          ? JSON.stringify(err.response.data)
          : (err as Error).message;
      this.logger.warn(`Telegram escalation MarkdownV2 failed, retrying plain text: ${detail}`);
      try {
        await sendAndStore({ text: plainText });
        return true;
      } catch (err2) {
        const detail2 =
          axios.isAxiosError(err2) && err2.response?.data != null
            ? JSON.stringify(err2.response.data)
            : (err2 as Error).message;
        this.logger.error(
          `Telegram escalation failed (plain text) for chat_id=${telegramChatId}: ${detail2}`,
        );
        return false;
      }
    }
  }

  private buildEscalationPlainText(
    propertyName: string,
    propertyId: string,
    guestQuestion: string,
  ): string {
    const q = guestQuestion.length > 3500 ? `${guestQuestion.slice(0, 3497)}…` : guestQuestion;
    return (
      `🔔 Вопрос гостя\n` +
      `Объект: ${propertyName}\n` +
      `ID объекта: ${propertyId}\n\n` +
      `«${q}»\n\n` +
      `↩️ Ответьте reply на это сообщение — ответ автоматически уйдёт гостю.`
    );
  }

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}
