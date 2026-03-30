import { createZodDto } from 'nestjs-zod';
import { createBookingSchema, updateBookingSchema, transitionBookingSchema } from '@rentai/shared';

export class CreateBookingDto extends createZodDto(createBookingSchema) {}
export class UpdateBookingDto extends createZodDto(updateBookingSchema) {}
export class TransitionBookingDto extends createZodDto(transitionBookingSchema) {}
