import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const sendReplySchema = z.object({
  text: z.string().min(1).max(4000),
});

export class SendReplyDto extends createZodDto(sendReplySchema) {}
