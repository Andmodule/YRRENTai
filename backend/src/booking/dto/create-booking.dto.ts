import { createZodDto } from 'nestjs-zod';
import {
  createBookingSchema,
  updateBookingSchema,
  transitionBookingSchema,
  patchBookingSchema,
} from '@rentai/shared';

export class CreateBookingDto extends createZodDto(createBookingSchema) {}
export class UpdateBookingDto extends createZodDto(updateBookingSchema) {}
export class PatchBookingDto extends createZodDto(patchBookingSchema) {}
export class TransitionBookingDto extends createZodDto(transitionBookingSchema) {}
