import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const headerRecord = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

/**
 * Resend adds fields over time (`attachments`, `message_id`, etc.). Passthrough keeps validation from 400
 * on harmless extras. Subject/text may be empty until fetched via Received Emails API.
 */
const resendWebhookDataSchema = z
  .object({
    from: z.string(),
    to: z.union([z.string(), z.array(z.string())]),
    subject: z.string().optional().default(''),
    text: z.string().optional().default(''),
    html: z.string().nullable().optional(),
    replyTo: z.string().nullable().optional(),
    headers: headerRecord.optional(),
    /** Resend inbound email id — use for idempotency when Message-Id is absent */
    id: z.string().optional(),
    email_id: z.string().optional(),
  })
  .passthrough();

export const resendWebhookSchema = z
  .object({
    type: z.literal('email.received'),
    data: resendWebhookDataSchema,
  })
  .passthrough();

export class ResendWebhookDto extends createZodDto(resendWebhookSchema) {}
