import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalTgUser = z
  .string()
  .trim()
  .max(64)
  .optional()
  .transform((v) => {
    if (!v || v.length === 0) return undefined;
    const s = v.replace(/^@+/, '').toLowerCase();
    return s.length > 0 ? s : undefined;
  });

export const createStaffInviteSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: optionalPhone,
  jobType: z.enum(['cleaner', 'maintenance', 'driver', 'other']),
  telegramUsername: optionalTgUser,
});

export class CreateStaffInviteDto extends createZodDto(createStaffInviteSchema) {}