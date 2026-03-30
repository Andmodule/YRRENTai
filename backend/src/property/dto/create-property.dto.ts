import { createZodDto } from 'nestjs-zod';
import { createPropertySchema, updatePropertySchema } from '@rentai/shared';

export class CreatePropertyDto extends createZodDto(createPropertySchema) {}
export class UpdatePropertyDto extends createZodDto(updatePropertySchema) {}
