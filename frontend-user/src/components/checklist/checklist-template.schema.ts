import { z } from 'zod';
import type { TaskType } from '@/modules/tasks/types';

export const TASK_TYPE_VALUES = [
  'checkout_cleaning',
  'checkin_prep',
  'mid_stay_cleaning',
  'maintenance',
  'other',
] as const satisfies readonly TaskType[];

export const checklistItemSchema = z.object({
  uuid: z.string().uuid().optional(),
  text: z.string().max(500),
  required: z.boolean(),
  sortOrder: z.number().int(),
  _deleted: z.boolean().optional(),
});

export const checklistTemplateSchema = z
  .object({
    name: z.string().min(2).max(100),
    autoApplyToType: z.enum(TASK_TYPE_VALUES).nullable(),
    propertyId: z.string().uuid().nullable(),
    items: z.array(checklistItemSchema),
  })
  .superRefine((data, ctx) => {
    const active = data.items.filter((i) => !i._deleted);
    if (active.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'atLeastOneItem',
        path: ['items'],
      });
    }
    data.items.forEach((item, idx) => {
      if (item._deleted) return;
      if (item.text.trim().length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'itemTextRequired',
          path: ['items', idx, 'text'],
        });
      }
    });
  });

export type ChecklistTemplateFormData = z.infer<typeof checklistTemplateSchema>;
