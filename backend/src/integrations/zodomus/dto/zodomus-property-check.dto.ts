import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** RentAI `propertyId` (UUID); server maps to `zodomusPropertyId` for upstream POST /property-check. */
export const zodomusPropertyCheckSchema = z.object({
  propertyId: z.string().uuid(),
  channelId: z.coerce.number().int().positive(),
});

export class ZodomusPropertyCheckDto extends createZodDto(zodomusPropertyCheckSchema) {}
