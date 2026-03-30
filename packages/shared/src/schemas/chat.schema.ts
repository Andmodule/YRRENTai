import { z } from 'zod';

export const chatMessageRoleSchema = z.enum(['user', 'assistant', 'system']);

export const sendChatMessageSchema = z.object({
  propertyId: z.string().uuid(),
  content: z.string().min(1).max(10000),
});

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  propertyId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  content: z.string(),
  role: chatMessageRoleSchema,
  createdAt: z.string(),
});
