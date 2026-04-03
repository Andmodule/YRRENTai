import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** RentAI `propertyId` (UUID); server maps to `zodomusPropertyId` for upstream POST /property-activation. */
export const zodomusPropertyActivationSchema = z.object({
  propertyId: z.string().uuid(),
  channelId: z.coerce.number().int().positive(),
  /** Zodomus price model: 1=max/single (Booking), 2=derived (Booking), 3=occupancy (Expedia), 4=per day/LOS, … */
  priceModelId: z.coerce.number().int().positive(),
});

export class ZodomusPropertyActivationDto extends createZodDto(zodomusPropertyActivationSchema) {}
