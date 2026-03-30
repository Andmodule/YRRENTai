import { z } from 'zod';
import { CONVERSATION_STATUS, CONVERSATION_CHANNEL } from '../constants/conversation';

export const conversationStatusSchema = z.enum([
  CONVERSATION_STATUS.AI_HANDLING,
  CONVERSATION_STATUS.NEEDS_HUMAN,
  CONVERSATION_STATUS.RESOLVED,
]);

export const conversationChannelSchema = z.enum([
  CONVERSATION_CHANNEL.WEB_APP,
  CONVERSATION_CHANNEL.TELEGRAM,
  CONVERSATION_CHANNEL.BOOKING_COM,
  CONVERSATION_CHANNEL.WHATSAPP,
]);

export const conversationPublicSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  propertyName: z.string(),
  channel: conversationChannelSchema,
  status: conversationStatusSchema,
  externalGuestKey: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastActivityAt: z.string(),
  createdAt: z.string(),
});

export const listConversationsQuerySchema = z.object({
  status: conversationStatusSchema.optional(),
  propertyId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const managerReplySchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().min(1).max(10000),
});
