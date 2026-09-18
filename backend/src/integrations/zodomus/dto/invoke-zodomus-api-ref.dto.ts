import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const pathSchema = z
  .string()
  .min(2)
  .max(128)
  .regex(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/i, 'path must be a single Zodomus segment like /room-rates');

export const invokeZodomusApiRefSchema = z
  .object({
    method: z.enum(['GET', 'POST']),
    path: pathSchema,
    /** RentAI property UUID — required when catalog entry needs property scope. */
    propertyId: z.string().uuid().optional(),
    channelId: z.coerce.number().int().positive().optional(),
    /** Optional Zodomus room id override (otherwise taken from property channel listing). */
    roomId: z.preprocess(
      (v) => {
        if (v === undefined || v === null) return undefined;
        const t = String(v).trim();
        return t === '' ? undefined : t;
      },
      z.string().max(64).optional(),
    ),
    /** Extra query params (merged; propertyId/channelId may be injected). */
    query: z.record(z.string()).optional(),
    /** POST body (merged; propertyId/channelId may be injected as numbers/strings). */
    body: z.unknown().optional(),
  })
  .strict();

export class InvokeZodomusApiRefDto extends createZodDto(invokeZodomusApiRefSchema) {}
