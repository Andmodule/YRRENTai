import { z } from 'zod';

const trimToNull = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const t = v.trim();
      return t === '' ? null : t;
    });

export const companyGlobalQaEntrySchema = z.object({
  id: z.string().uuid(),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(3000),
});

export type CompanyGlobalQaEntry = z.infer<typeof companyGlobalQaEntrySchema>;

export const companyGlobalRulesSchema = z.object({
  globalDescription: trimToNull(5000),
  globalRules: trimToNull(10000),
  globalQaEntries: z.array(companyGlobalQaEntrySchema).max(50).optional(),
});

export type CompanyGlobalRulesDto = z.infer<typeof companyGlobalRulesSchema>;
