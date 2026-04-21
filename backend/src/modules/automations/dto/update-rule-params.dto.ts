import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateRuleParamsSchema = z.object({
  params: z.record(z.string(), z.unknown()),
});

export class UpdateRuleParamsDto extends createZodDto(updateRuleParamsSchema) {}
