import { createZodDto } from 'nestjs-zod';
import { loginSchema, registerSchema } from '@rentai/shared';

export class LoginDto extends createZodDto(loginSchema) {}
export class RegisterDto extends createZodDto(registerSchema) {}
