import { ConfigService } from '@nestjs/config';

/**
 * Token for the staff bot (tasks, invites, TMA). Falls back to legacy `TELEGRAM_BOT_TOKEN` if unset.
 */
export function resolveStaffTelegramBotToken(config: ConfigService): string {
  const staff = config.get<string>('TELEGRAM_STAFF_BOT_TOKEN')?.trim();
  if (staff) return staff;
  return config.get<string>('TELEGRAM_BOT_TOKEN')?.trim() ?? '';
}

/**
 * @username for staff invite links `t.me/<user>?start=`. Falls back to `TELEGRAM_BOT_USERNAME`.
 */
export function resolveStaffInviteBotUsername(config: ConfigService): string {
  const staff = config.get<string>('TELEGRAM_STAFF_BOT_USERNAME')?.trim().replace(/^@/, '');
  if (staff) return staff;
  return config.get<string>('TELEGRAM_BOT_USERNAME')?.trim().replace(/^@/, '') ?? '';
}

/**
 * Mini App URL for staff (кнопки «Открыть задачу» / маршрут / расписание).
 * Только `TELEGRAM_STAFF_MINI_APP_URL` — без fallback на `TELEGRAM_MINI_APP_URL`,
 * иначе в Telegram открывается гостевое приложение (legacy `/tma` в frontend-user).
 */
export function resolveStaffMiniAppUrl(config: ConfigService): string {
  return config.get<string>('TELEGRAM_STAFF_MINI_APP_URL')?.trim().replace(/\/$/, '') ?? '';
}
