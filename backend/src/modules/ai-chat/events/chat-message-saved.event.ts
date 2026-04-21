import { z } from 'zod';

export const chatMessageSavedChannelSchema = z.enum(['whatsapp', 'booking', 'telegram', 'web']);

export type ChatMessageSavedChannel = z.infer<typeof chatMessageSavedChannelSchema>;

export const chatMessageSavedSenderRoleSchema = z.enum(['GUEST', 'STAFF', 'SYSTEM', 'MANAGER']);

export type ChatMessageSavedSenderRole = z.infer<typeof chatMessageSavedSenderRoleSchema>;

/** Payload enqueued to BullMQ `ai-intent-extraction` after `ChatService` persists a message. */
export interface ChatMessageSavedEvent {
  messageId: string;
  propertyId: string;
  senderId: string;
  senderRole: ChatMessageSavedSenderRole;
  text: string;
  channel: ChatMessageSavedChannel;
}

export const ChatMessageSavedEventSchema = z.object({
  messageId: z.string().min(1),
  propertyId: z.string().uuid(),
  senderId: z.string().min(1),
  senderRole: chatMessageSavedSenderRoleSchema,
  text: z.string(),
  channel: chatMessageSavedChannelSchema,
});
