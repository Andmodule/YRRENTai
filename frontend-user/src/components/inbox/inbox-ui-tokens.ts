/**
 * Borders aligned with the chat outer frame (soft blue #dbeafe).
 * Use with border-b / border-t / border-r / border.
 */
export const CHAT_FRAME = {
  b: 'border-b border-[#dbeafe] dark:border-b-indigo-900/45',
  t: 'border-t border-[#dbeafe] dark:border-t-indigo-900/45',
  r: 'border-r border-[#dbeafe] dark:border-r-indigo-900/45',
  /** List column divider on large screens only (mobile list is full width). */
  rLg: 'lg:border-r lg:border-[#dbeafe] dark:lg:border-r-indigo-900/45',
  box: 'border border-[#dbeafe] dark:border-indigo-900/45',
  /** Master-detail outer frame: no border on small screens, soft blue on lg+. */
  lgBox:
    'border-0 lg:rounded-xl lg:border lg:border-[#dbeafe] dark:lg:border-indigo-900/45',
} as const;
