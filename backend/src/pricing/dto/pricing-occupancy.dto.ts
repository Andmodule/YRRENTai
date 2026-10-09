import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  OCCUPANCY_HORIZON_MAX,
  OCCUPANCY_HORIZON_MIN,
  OCCUPANCY_MAX_TIERS,
  tiersProblem,
} from '../pricing-occupancy.util';

export const occupancySettingsSchema = z
  .object({
    /** Nights ahead that are counted, from today. */
    horizonDays: z.coerce.number().int().min(OCCUPANCY_HORIZON_MIN).max(OCCUPANCY_HORIZON_MAX),
    tiers: z
      .array(
        z
          .object({
            belowPct: z.coerce.number().int().min(1).max(100),
            /** Booking accepts 1–99 %. */
            discountPct: z.coerce.number().int().min(1).max(99),
          })
          .strict(),
      )
      .min(1)
      .max(OCCUPANCY_MAX_TIERS),
  })
  .strict()
  .superRefine((v, ctx) => {
    const problem = tiersProblem(v.tiers);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ['tiers'] });
  });

export class OccupancySettingsDto extends createZodDto(occupancySettingsSchema) {}
