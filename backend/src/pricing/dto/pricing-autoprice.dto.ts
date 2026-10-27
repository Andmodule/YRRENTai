import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TIERS_MAX, TIER_PCT_MAX, settingsProblem } from '../autoprice.util';

const pct = z.coerce.number().int().min(1).max(TIER_PCT_MAX);
const share = z.coerce.number().int().min(1).max(100);

export const autoPriceSettingsSchema = z
  .object({
    enabled: z.boolean(),
    window: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('next'), days: z.coerce.number().int() }).strict(),
      z.object({ kind: z.literal('month_end'), daysBefore: z.coerce.number().int() }).strict(),
    ]),
    down: z.array(z.object({ unsoldPct: share, pct }).strict()).max(TIERS_MAX),
    up: z.array(z.object({ soldPct: share, pct }).strict()).max(TIERS_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Window ranges, duplicate and overlapping tiers: the same check the service makes.
    const problem = settingsProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export class AutoPriceSettingsDto extends createZodDto(autoPriceSettingsSchema) {}
