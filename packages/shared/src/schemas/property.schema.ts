import { z } from 'zod';

export const createPropertySchema = z.object({
  name: z.string().min(1).max(255),
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  address: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  timezone: z.string().min(1).max(100),
  currency: z.string().length(3).default('USD'),
  maxGuests: z.number().int().positive().max(100).optional(),
  /** External property id in Zodomus (channel manager); required for queue sync */
  zodomusPropertyId: z.string().max(255).optional().nullable(),
});

export const updatePropertySchema = createPropertySchema.partial();
