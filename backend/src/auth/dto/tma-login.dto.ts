import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const tmaLoginSchema = z.object({
  initData: z.string().min(1),
});

export class TmaLoginDto extends createZodDto(tmaLoginSchema) {}
