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
  CONVERSATION_CHANNEL.EMAIL,
]);

export const conversationPublicSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  propertyName: z.string(),
  channel: conversationChannelSchema,
  status: conversationStatusSchema,
  externalGuestKey: z.string().nullable(),
  guestDisplayName: z.string().nullable(),
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

/** References files uploaded via POST …/conversations/:id/staff-attachments (R2 keys scoped to property + conversation). */
export const managerReplyAttachmentRefSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().min(1).max(500),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  storageKey: z.string().min(1).max(1024),
});

export const managerReplySchema = z
  .object({
    conversationId: z.string().uuid(),
    content: z.string().max(10000),
    attachments: z.array(managerReplyAttachmentRefSchema).max(10).optional(),
  })
  .refine(
    (d) => d.content.trim().length > 0 || (d.attachments && d.attachments.length > 0),
    { message: 'Either non-empty content or at least one attachment is required', path: ['content'] },
  );

/** Approve (optionally edit) an AI draft before it is delivered to the guest. */
export const aiDraftApproveSchema = z.object({
  content: z.string().max(10000).optional(),
});
