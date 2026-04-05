/**
 * Escape user-controlled text for Telegram `parse_mode: 'HTML'`.
 * Prevents broken markup and mitigates injection into client-side Telegram HTML.
 */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
