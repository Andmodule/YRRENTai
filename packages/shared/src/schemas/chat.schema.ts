import { z } from 'zod';

export const chatMessageRoleSchema = z.enum(['user', 'assistant', 'system']);

export const sendChatMessageSchema = z
  .object({
    propertyId: z.string().uuid(),
    content: z.string().min(1).max(10000),
    /** Reply in an existing thread (inbox / detail). Mutually exclusive with guestSessionKey. */
    conversationId: z.string().uuid().optional(),
    /** Dev: separate guest threads on the same property (simulated identities). Ignored if conversationId is set. */
    guestSessionKey: z.string().min(1).max(64).optional(),
  })
  .refine((d) => !(d.conversationId && d.guestSessionKey), {
    message: 'Specify either conversationId or guestSessionKey',
  });

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  content: z.string(),
  role: chatMessageRoleSchema,
  createdAt: z.string(),
});

/** Query params for GET /chats/analytics/reply-stats (ISO 8601 datetimes). */
export const replyAnalyticsQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((d) => d.from.getTime() <= d.to.getTime(), {
    message: 'from must be before or equal to to',
  });
