import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const patchInboundSenderFilterSchema = z.object({
  allowedHosts: z.array(z.string().max(253)).optional(),
  allowGmailGooglemail: z.boolean().optional(),
});

export class PatchInboundSenderFilterDto extends createZodDto(patchInboundSenderFilterSchema) {}
