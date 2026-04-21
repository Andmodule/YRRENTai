import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AUTOMATION_RULE_STATUSES } from '../entities/automation-rule.entity';

export const updateRuleStatusSchema = z.object({
  status: z.enum(AUTOMATION_RULE_STATUSES),
});

export class UpdateRuleStatusDto extends createZodDto(updateRuleStatusSchema) {}
