import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** RentAI `propertyId` (UUID); server maps to `zodomusPropertyId` for upstream. */
export const createZodomusTestReservationSchema = z.object({
  propertyId: z.string().uuid(),
  channelId: z.coerce.number().int().positive(),
  status: z.enum(['new', 'modified', 'cancelled', 'summary']).optional(),
  reservationId: z.string().optional(),
});

export class CreateZodomusTestReservationDto extends createZodDto(createZodomusTestReservationSchema) {}
