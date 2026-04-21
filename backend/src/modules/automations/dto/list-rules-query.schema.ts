import { z } from 'zod';
import { AUTOMATION_RULE_CATEGORIES } from '../entities/automation-rule.entity';

export const listRulesQuerySchema = z.object({
  propertyId: z.string().uuid(),
  category: z.enum(AUTOMATION_RULE_CATEGORIES),
});

export type ListRulesQuery = z.infer<typeof listRulesQuerySchema>;
