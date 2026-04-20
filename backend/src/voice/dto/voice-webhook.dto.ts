import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const voiceWebhookSchema = z.object({
  event: z.string(),
  call_id: z.string().optional(),
  data: z.record(z.unknown()).optional(),
});

const operatorTakeoverSchema = z.object({
  sessionId: z.string().uuid(),
});

export class VoiceWebhookDto extends createZodDto(voiceWebhookSchema) {}
export class OperatorTakeoverDto extends createZodDto(operatorTakeoverSchema) {}
