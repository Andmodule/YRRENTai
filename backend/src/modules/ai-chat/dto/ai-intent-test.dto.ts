import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import {
  chatMessageSavedChannelSchema,
  chatMessageSavedSenderRoleSchema,
} from '../events/chat-message-saved.event';

export const aiIntentTestBodySchema = z.object({
  propertyId: z.string().uuid(),
  senderRole: chatMessageSavedSenderRoleSchema,
  text: z.string().min(1),
  senderId: z.string().min(1).optional(),
  channel: chatMessageSavedChannelSchema.optional(),
  /**
   * When true (default), call the LLM even if the property has zero active automation rules.
   * The Bull worker skips the LLM entirely when that count is 0.
   */
  skipActiveRulesGate: z.boolean().optional(),
});

export class AiIntentTestBodyDto extends createZodDto(aiIntentTestBodySchema) {}
