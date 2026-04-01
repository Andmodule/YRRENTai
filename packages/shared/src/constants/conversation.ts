export const CONVERSATION_STATUS = {
  AI_HANDLING: 'ai_handling',
  NEEDS_HUMAN: 'needs_human',
  RESOLVED: 'resolved',
} as const;

export type ConversationStatus =
  (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];

export const CONVERSATION_CHANNEL = {
  WEB_APP: 'web_app',
  TELEGRAM: 'telegram',
  BOOKING_COM: 'booking_com',
  WHATSAPP: 'whatsapp',
  /** Inbound email (Resend) — one conversation per sender email per property */
  EMAIL: 'email',
} as const;

export type ConversationChannel =
  (typeof CONVERSATION_CHANNEL)[keyof typeof CONVERSATION_CHANNEL];
