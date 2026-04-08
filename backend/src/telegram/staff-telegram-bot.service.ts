import {
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { IncidentsService } from '../incidents/incidents.service';
import { TasksService } from '../tasks/tasks.service';
import { UserService } from '../user/user.service';
import { PropertyService } from '../property/property.service';
import { TelegramProcessedUpdateEntity } from './entities/telegram-processed-update.entity';
import { UnmappedReportEntity } from './entities/unmapped-report.entity';
import { resolveStaffMiniAppUrl, resolveStaffTelegramBotToken } from './telegram-staff-env';
import { StaffTelegramPendingAttachmentEntity } from './entities/staff-telegram-pending-attachment.entity';
import { StaffTelegramPendingVoiceIncidentEntity } from './entities/staff-telegram-pending-voice-incident.entity';

interface TelegramSendMessageResponse {
  ok: boolean;
}

interface TelegramGetFileResponse {
  ok: boolean;
  result?: { file_path: string };
}

/** Raw Telegram update (subset). */
export interface StaffTelegramRawUpdate {
  update_id: number;
  message?: StaffTelegramMessage;
  callback_query?: {
    id: string;
    from?: { id: number };
    message?: { chat?: { id: number } };
    data?: string;
  };
}

export interface StaffTelegramMessage {
  message_id: number;
  from?: { id: number; is_bot?: boolean };
  chat: { id: number };
  text?: string;
  caption?: string;
  voice?: { file_id: string; mime_type?: string };
  photo?: { file_id: string }[];
  reply_to_message?: { message_id: number };
}

@Injectable()
export class StaffTelegramBotService {
  private readonly logger = new Logger(StaffTelegramBotService.name);
  private readonly apiBase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly propertyService: PropertyService,
    @InjectRepository(TelegramProcessedUpdateEntity)
    private readonly processedRepo: Repository<TelegramProcessedUpdateEntity>,
    @InjectRepository(UnmappedReportEntity)
    private readonly unmappedReportRepo: Repository<UnmappedReportEntity>,
    @InjectRepository(StaffTelegramPendingAttachmentEntity)
    private readonly pendingAttachRepo: Repository<StaffTelegramPendingAttachmentEntity>,
    @InjectRepository(StaffTelegramPendingVoiceIncidentEntity)
    private readonly pendingVoiceRepo: Repository<StaffTelegramPendingVoiceIncidentEntity>,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    @Inject(forwardRef(() => IncidentsService))
    private readonly incidentsService: IncidentsService,
  ) {
    const token = resolveStaffTelegramBotToken(configService);
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  private get enabled(): boolean {
    return !!resolveStaffTelegramBotToken(this.configService);
  }

  /**
   * @returns true if this update should be processed (first time); false if duplicate.
   */
  async tryMarkProcessed(updateId: number, scope: 'main' | 'staff' = 'main'): Promise<boolean> {
    try {
      await this.processedRepo.insert({ updateId: String(updateId), botScope: scope });
      void this.pruneProcessedUpdatesOlderThan48h().catch((err: unknown) => {
        this.logger.warn(`telegram_processed_updates prune: ${(err as Error).message}`);
      });
      return true;
    } catch (e) {
      if (e instanceof QueryFailedError) {
        const code = (e as unknown as { code?: string; driverError?: { code?: string } }).driverError
          ?.code;
        if (code === '23505') {
          return false;
        }
      }
      throw e;
    }
  }

  /** Keeps `telegram_processed_updates` small (fire-and-forget after each successful insert). */
  private async pruneProcessedUpdatesOlderThan48h(): Promise<void> {
    await this.processedRepo.query(
      `DELETE FROM telegram_processed_updates WHERE "createdAt" < NOW() - INTERVAL '48 hours'`,
    );
  }

  /**
   * Staff-bot webhook only: idempotency (scoped) + staff branch. Main client bot must not call this.
   */
  async handleStaffBotWebhook(update: StaffTelegramRawUpdate): Promise<void> {
    if (!resolveStaffTelegramBotToken(this.configService)) {
      return;
    }
    const first = await this.tryMarkProcessed(update.update_id, 'staff');
    if (!first) {
      return;
    }
    await this.tryHandleStaffBranch(update);
  }

  /**
   * Staff-specific handling. Returns true if the update was fully handled (skip manager escalation flow).
   */
  async tryHandleStaffBranch(update: StaffTelegramRawUpdate): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    if (update.callback_query) {
      return this.handleCallbackQuery(update.callback_query);
    }

    const message = update.message;
    if (!message) {
      return false;
    }

    const chatId = String(message.chat.id);

    if (message.text?.startsWith('/start')) {
      const parts = message.text.trim().split(/\s+/);
      const payload = parts[1]?.trim();
      if (payload) {
        const result = await this.userService.bindStaffTelegramFromInvite(chatId, payload);
        const text = result.ok
          ? `Привет, ${result.firstName}! Я твой ИИ-помощник от RentAI. Сюда будут приходить твои задачи на уборку. Тебе не нужно ничего настраивать — просто жди уведомлений.`
          : result.message;
        await this.sendMessage(chatId, text);
        return true;
      }
      await this.sendMessage(
        chatId,
        'Чтобы привязать профиль, откройте ссылку-приглашение из кабинета управляющего (кнопка «Ссылка в бот» у вашего имени) и нажмите Start в этом окне. Если открыли бота из поиска — ссылка без кода не сработает. Нужна новая ссылка — попросите «Новая ссылка» у управляющего.',
      );
      return true;
    }

    const linked = await this.userService.findByTelegramChatId(chatId);
    if (!linked || linked.role !== 'STAFF') {
      return false;
    }

    if (message.reply_to_message) {
      return false;
    }

    if (message.voice) {
      await this.handleVoice(linked.id, chatId, message.voice);
      return true;
    }

    if (message.photo?.length) {
      const best = message.photo[message.photo.length - 1]!;
      await this.handlePhoto(linked.id, chatId, best.file_id);
      return true;
    }

    await this.sendMessage(
      chatId,
      'Отправьте голосовое сообщение или фото по задаче. Или откройте мини-приложение из кнопки в уведомлении.',
    );
    return true;
  }

  private async handleCallbackQuery(cb: StaffTelegramRawUpdate['callback_query']): Promise<boolean> {
    if (!cb?.data || !cb.from) {
      return false;
    }
    const chatId = cb.message?.chat?.id;
    if (chatId === undefined) {
      return false;
    }
    const chatIdStr = String(chatId);
    const user = await this.userService.findByTelegramChatId(chatIdStr);
    if (!user || user.role !== 'STAFF') {
      return false;
    }

    const data = cb.data;
    if (data.startsWith('sp:vprop:')) {
      const propertyId = data.slice('sp:vprop:'.length).trim();
      const pending = await this.pendingVoiceRepo.findOne({ where: { userId: user.id } });
      if (!pending || pending.expiresAt.getTime() < Date.now()) {
        await this.answerCallback(cb.id, 'Сессия истекла');
        return true;
      }
      if (!pending.candidatePropertyIds.includes(propertyId)) {
        await this.answerCallback(cb.id, 'Неверный объект');
        return true;
      }
      await this.pendingVoiceRepo.delete({ userId: user.id });
      await this.incidentsService.createForStaff(user.id, {
        type: 'damage',
        propertyId,
        taskId: null,
        description: pending.title,
        photoUrls: [],
        suggestedTaskDraft: pending.suggestedTaskDraft ?? undefined,
      });
      await this.answerCallback(cb.id, 'Готово');
      await this.sendMessage(
        chatIdStr,
        '✅ Инцидент зафиксирован. Управляющий получит уведомление.',
      );
      return true;
    }

    if (data.startsWith('sp:task:')) {
      const taskId = data.slice('sp:task:'.length).trim();
      const pending = await this.pendingAttachRepo.findOne({ where: { userId: user.id } });
      if (!pending || pending.expiresAt.getTime() < Date.now()) {
        await this.answerCallback(cb.id, 'Нет активного фото');
        return true;
      }
      const url = await this.downloadTelegramFileToUploads(pending.fileId, `staff-${user.id}`);
      await this.pendingAttachRepo.delete({ userId: user.id });
      await this.tasksService.appendPhotoUrls(taskId, user.id, 'STAFF', [url]);
      await this.answerCallback(cb.id, 'Фото прикреплено');
      await this.sendMessage(chatIdStr, '✅ Фото добавлено к задаче.');
      return true;
    }

    if (data === 'sp:cancel') {
      await this.pendingAttachRepo.delete({ userId: user.id });
      await this.pendingVoiceRepo.delete({ userId: user.id });
      await this.answerCallback(cb.id, 'Отменено');
      return true;
    }

    return false;
  }

  private async handleVoice(staffUserId: string, chatId: string, voice: { file_id: string; mime_type?: string }): Promise<void> {
    const buf = await this.downloadTelegramFileBuffer(voice.file_id);
    const mime = voice.mime_type || 'audio/ogg';
    const parsed = await this.tasksService.voiceParseForStaff(chatId, buf, mime);

    if (parsed.action === 'unmapped_voice' && parsed.transcript) {
      await this.unmappedReportRepo.save(
        this.unmappedReportRepo.create({
          userId: staffUserId,
          transcript: parsed.transcript,
          photoUrl: null,
        }),
      );
      await this.sendMessage(
        chatId,
        '📝 У вас нет активных задач. Сохранил как заметку для менеджера.',
      );
      return;
    }

    if (parsed.action === 'ambiguous_incident' && parsed.title && parsed.candidatePropertyIds?.length) {
      const exp = new Date(Date.now() + 15 * 60 * 1000);
      await this.pendingVoiceRepo.save(
        this.pendingVoiceRepo.create({
          userId: staffUserId,
          title: parsed.title,
          transcript: parsed.transcript,
          candidatePropertyIds: parsed.candidatePropertyIds,
          suggestedTaskDraft: parsed.suggestedTaskDraft
            ? ({ ...parsed.suggestedTaskDraft } as Record<string, unknown>)
            : null,
          expiresAt: exp,
        }),
      );
      const staffUser = await this.userService.findById(staffUserId);
      const ownerId = staffUser?.employerOwnerId;
      if (!ownerId) {
        await this.sendMessage(chatId, 'Не удалось определить аккаунт.');
        return;
      }
      const props = await this.propertyService.findAllByOwner(ownerId);
      const nameById = new Map(props.map((p) => [p.id, p.name]));
      const rows = parsed.candidatePropertyIds.slice(0, 8).map((pid) => [
        {
          text: (nameById.get(pid) ?? 'Объект').slice(0, 40),
          callback_data: `sp:vprop:${pid}`,
        },
      ]);
      await axios.post(`${this.apiBase}/sendMessage`, {
        chat_id: chatId,
        text: 'К какому объекту это относится?',
        reply_markup: {
          inline_keyboard: [...rows, [{ text: 'Отмена', callback_data: 'sp:cancel' }]],
        },
      });
      return;
    }

    if (parsed.action === 'complete' && parsed.taskId) {
      try {
        await this.tasksService.update(
          parsed.taskId,
          staffUserId,
          'STAFF',
          { status: 'done' },
          false,
        );
        await this.sendMessage(chatId, '✅ Задача отмечена выполненной.');
      } catch (e) {
        if (e instanceof UnprocessableEntityException) {
          await this.sendMessage(
            chatId,
            'Не все обязательные пункты чеклиста выполнены. Завершите в приложении.',
          );
        } else {
          this.logger.warn(`Voice complete task failed: ${(e as Error).message}`);
          await this.sendMessage(chatId, 'Не удалось закрыть задачу.');
        }
      }
      return;
    }

    if (parsed.action === 'incident' && parsed.title && parsed.propertyId) {
      await this.incidentsService.createForStaff(staffUserId, {
        type: 'damage',
        propertyId: parsed.propertyId,
        taskId: null,
        description: parsed.title,
        photoUrls: [],
        suggestedTaskDraft: parsed.suggestedTaskDraft,
      });
      await this.sendMessage(
        chatId,
        '✅ Инцидент зафиксирован. Управляющий получит уведомление.',
      );
      return;
    }

    const tma = resolveStaffMiniAppUrl(this.configService);
    const hint = tma
      ? `Не совсем понял. Откройте приложение: ${tma}`
      : 'Не совсем понял. Попробуйте ещё раз или сообщите менеджеру.';
    await this.sendMessage(chatId, hint);
  }

  private async handlePhoto(staffUserId: string, chatId: string, fileId: string): Promise<void> {
    const active = await this.tasksService.findActiveTasksForStaff(staffUserId);
    if (active.length === 0) {
      const url = await this.downloadTelegramFileToUploads(fileId, `unsorted-${staffUserId}`);
      await this.unmappedReportRepo.save(
        this.unmappedReportRepo.create({
          userId: staffUserId,
          photoUrl: url,
          transcript: null,
        }),
      );
      await this.sendMessage(chatId, 'Фото сохранено в галерею менеджера.');
      return;
    }
    if (active.length === 1) {
      const t = active[0]!;
      const url = await this.downloadTelegramFileToUploads(fileId, `task-${t.id}`);
      await this.tasksService.appendPhotoUrls(t.id, staffUserId, 'STAFF', [url]);
      await this.sendMessage(chatId, `✅ Фото прикреплено к задаче «${t.title}».`);
      return;
    }

    const exp = new Date(Date.now() + 10 * 60 * 1000);
    await this.pendingAttachRepo.save(
      this.pendingAttachRepo.create({
        userId: staffUserId,
        fileId,
        expiresAt: exp,
      }),
    );

    const rows = active.slice(0, 8).map((t) => [
      {
        text: (t.title || 'Задача').slice(0, 40),
        callback_data: `sp:task:${t.id}`,
      },
    ]);
    await axios.post(`${this.apiBase}/sendMessage`, {
      chat_id: chatId,
      text: 'К какой задаче прикрепить фото?',
      reply_markup: { inline_keyboard: [...rows, [{ text: 'Отмена', callback_data: 'sp:cancel' }]] },
    });
  }

  private async downloadTelegramFileBuffer(fileId: string): Promise<Buffer> {
    const fr = await axios.get<TelegramGetFileResponse>(`${this.apiBase}/getFile`, {
      params: { file_id: fileId },
      timeout: 30000,
    });
    const path = fr.data.result?.file_path;
    if (!path) {
      throw new Error('getFile: no path');
    }
    const token = resolveStaffTelegramBotToken(this.configService);
    if (!token) {
      throw new Error('Staff Telegram bot token is not configured');
    }
    const fileUrl = `https://api.telegram.org/file/bot${token}/${path}`;
    const res = await axios.get<ArrayBuffer>(fileUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(res.data);
  }

  /** Public URL for uploads (same pattern as tasks photo upload). */
  private async downloadTelegramFileToUploads(fileId: string, folder: string): Promise<string> {
    const buf = await this.downloadTelegramFileBuffer(fileId);
    const dir = join(process.cwd(), 'uploads', 'telegram', folder);
    await fs.mkdir(dir, { recursive: true });
    const name = `${randomUUID()}.jpg`;
    const full = join(dir, name);
    await fs.writeFile(full, buf);
    const apiBase =
      this.configService.get<string>('API_PUBLIC_URL')?.replace(/\/$/, '') ||
      `http://localhost:${this.configService.get<number>('PORT', 3010)}`;
    return `${apiBase}/uploads/telegram/${folder}/${name}`;
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        { chat_id: chatId, text: text.slice(0, 4000) },
        { timeout: 15000 },
      );
    } catch (e) {
      this.logger.warn(`sendMessage failed: ${(e as Error).message}`);
    }
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    try {
      await axios.post(`${this.apiBase}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
        text: text.slice(0, 200),
      });
    } catch {
      /* ignore */
    }
  }
}
