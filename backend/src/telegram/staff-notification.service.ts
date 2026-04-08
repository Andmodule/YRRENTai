import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { addDays, format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { TaskEntity } from '../tasks/entities/task.entity';
import { UserService } from '../user/user.service';
import { escapeTelegramHtml } from './utils/telegram-html.util';
import { resolveStaffMiniAppUrl, resolveStaffTelegramBotToken } from './telegram-staff-env';

interface TelegramSendMessageResponse {
  ok: boolean;
}

@Injectable()
export class StaffNotificationService {
  private readonly logger = new Logger(StaffNotificationService.name);
  private readonly apiBase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    const token = resolveStaffTelegramBotToken(configService);
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  private get isEnabled(): boolean {
    return !!resolveStaffTelegramBotToken(this.configService);
  }

  /**
   * Notify STAFF when a task is assigned to them or its deadline (date/time) changes.
   */
  async notifyTaskAssignOrDeadline(
    task: TaskEntity,
    reason: 'assign' | 'deadline',
    assigneeId: string,
  ): Promise<void> {
    if (!this.isEnabled) {
      this.logger.debug(
        `Staff TG notify skipped: TELEGRAM_STAFF_BOT_TOKEN (or legacy TELEGRAM_BOT_TOKEN) not set (task=${task.id})`,
      );
      return;
    }
    const assignee = await this.userService.findById(assigneeId);
    const chatId = assignee?.telegramChatId?.trim();
    if (!assignee) {
      this.logger.warn(`Staff TG notify skipped: assignee user not found (task=${task.id} assigneeId=${assigneeId})`);
      return;
    }
    if (assignee.role !== 'STAFF') {
      this.logger.debug(
        `Staff TG notify skipped: assignee is not STAFF (task=${task.id} role=${assignee.role})`,
      );
      return;
    }
    if (!chatId) {
      this.logger.log(
        `Staff TG notify skipped: no telegramChatId for STAFF ${assigneeId} (task=${task.id}). ` +
          `Employee must open the bot via invite link and press /start to link the chat.`,
      );
      return;
    }

    const tma = resolveStaffMiniAppUrl(this.configService);
    const propName = escapeTelegramHtml(task.property?.name?.trim() || 'Объект');
    const reasonLine =
      reason === 'assign' ? '✨ Вам назначена задача.' : '⏰ Изменён срок задачи.';
    const tz = task.property?.timezone ?? 'UTC';
    const localNow = toZonedTime(new Date(), tz);
    const todayStr = format(localNow, 'yyyy-MM-dd');
    const tomorrowStr = format(addDays(localNow, 1), 'yyyy-MM-dd');
    const dueLine = this.formatDueLineHuman(task.dueDate, task.dueTime, todayStr, tomorrowStr);
    const dueEsc = escapeTelegramHtml(dueLine);
    const emoji = StaffNotificationService.taskTypeEmoji(task.type);
    const longT = StaffNotificationService.taskTypeLongRu(task.type);
    const shortT = StaffNotificationService.taskTypeShortRu(task.type);
    const titleRaw = (task.title ?? '').trim();
    const titleHtml = titleRaw ? `\n<b>${escapeTelegramHtml(titleRaw)}</b>` : '';

    const text = `${reasonLine}\n\n${emoji} ${longT} (${shortT})${titleHtml}\n\n📍 ${propName}\n🕒 ${dueEsc}`;

    /** `startapp` allows only [A-Za-z0-9_]; UUID hyphens → underscores. */
    const startParam = `task_${task.id.replace(/-/g, '_')}`;
    const keyboard =
      tma && tma.startsWith('https://')
        ? {
            inline_keyboard: [
              [
                {
                  text: '🚀 Открыть задачу',
                  url: `${tma}${tma.includes('?') ? '&' : '?'}startapp=${encodeURIComponent(startParam)}`,
                },
              ],
            ],
          }
        : undefined;

    try {
      await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          ...(keyboard ? { reply_markup: keyboard } : {}),
        },
        { timeout: 15000 },
      );
      this.logger.log(`Staff TG notify sent task=${task.id} assignee=${assigneeId} reason=${reason}`);
    } catch (err) {
      this.logger.warn(`Staff Telegram notify failed task=${task.id}: ${(err as Error).message}`);
    }
  }

  /**
   * Morning digest (08:00 local property time). Omits inline keyboard if TMA URL is missing/invalid.
   */
  async sendMorningDigest(chatId: string, lines: string[]): Promise<void> {
    if (!this.isEnabled) return;
    const tma = resolveStaffMiniAppUrl(this.configService);
    const text = lines.join('\n');
    const keyboard =
      tma && tma.startsWith('https://')
        ? {
            inline_keyboard: [
              [
                {
                  text: '📅 Открыть расписание',
                  url: `${tma}${tma.includes('?') ? '&' : '?'}startapp=tasks`,
                },
              ],
            ],
          }
        : undefined;
    try {
      await axios.post<TelegramSendMessageResponse>(
        `${this.apiBase}/sendMessage`,
        {
          chat_id: chatId,
          text: text.slice(0, 4000),
          ...(keyboard ? { reply_markup: keyboard } : {}),
        },
        { timeout: 15000 },
      );
    } catch (err) {
      this.logger.warn(`Staff morning digest failed: ${(err as Error).message}`);
    }
  }

  private static taskTypeEmoji(type: string): string {
    if (type === 'checkout_cleaning' || type === 'mid_stay_cleaning') return '🧹';
    if (type === 'checkin_prep') return '🗝️';
    if (type === 'maintenance') return '🔧';
    return '📋';
  }

  private static taskTypeLongRu(type: string): string {
    const m: Record<string, string> = {
      checkout_cleaning: 'Уборка',
      mid_stay_cleaning: 'Уборка',
      checkin_prep: 'Подготовка',
      maintenance: 'Техника',
      other: 'Задача',
    };
    return m[type] ?? 'Задача';
  }

  private static taskTypeShortRu(type: string): string {
    const m: Record<string, string> = {
      checkout_cleaning: 'Выезд',
      mid_stay_cleaning: 'Промежуточная',
      checkin_prep: 'Заезд',
      maintenance: 'Обслуживание',
      other: 'Другое',
    };
    return m[type] ?? type;
  }

  private formatDueLineHuman(
    dueDate: string,
    dueTime: string | null,
    todayStr: string,
    tomorrowStr: string,
  ): string {
    const timePart = dueTime?.trim()
      ? `до ${dueTime.trim().slice(0, 5)}`
      : 'до вечера';
    if (dueDate === todayStr) {
      return dueTime?.trim() ? `Сегодня ${timePart}` : 'Сегодня';
    }
    if (dueDate === tomorrowStr) {
      return dueTime?.trim() ? `Завтра ${timePart}` : 'Завтра';
    }
    const [y, m, d] = dueDate.split('-').map(Number);
    const pretty = `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
    return dueTime?.trim() ? `${pretty} ${dueTime.trim().slice(0, 5)}` : pretty;
  }
}
