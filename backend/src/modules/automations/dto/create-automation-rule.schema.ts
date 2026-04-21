import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { AUTOMATION_RULE_CATEGORIES } from '../entities/automation-rule.entity';

/** Rule keys we allow creating via API (extend as executors ship). */
export const creatableAutomationRuleKeys = ['CLEANER_DELAYED'] as const;
export type CreatableAutomationRuleKey = (typeof creatableAutomationRuleKeys)[number];

export const createAutomationRuleSchema = z.object({
  propertyId: z.string().uuid(),
  key: z.enum(creatableAutomationRuleKeys),
  category: z.enum(AUTOMATION_RULE_CATEGORIES),
  status: z.enum(['active', 'inactive']).optional().default('active'),
  params: z.record(z.unknown()).optional(),
});

export class CreateAutomationRuleDto extends createZodDto(createAutomationRuleSchema) {}

export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
