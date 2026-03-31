import type { ChecklistTemplateFormData } from '@/components/checklist/checklist-template.schema';
import { TASK_TYPE_VALUES } from '@/components/checklist/checklist-template.schema';
import type { TaskType } from '@/modules/tasks/types';
import type { ChecklistTemplate } from './hooks/useChecklistTemplates';

export function emptyDraft(): ChecklistTemplateFormData {
  return {
    name: '',
    autoApplyToType: null,
    propertyId: null,
    items: [{ text: '', required: false, sortOrder: 0 }],
  };
}

export function normalizeTaskType(s: string | null): TaskType | null {
  if (!s) return null;
  return (TASK_TYPE_VALUES as readonly string[]).includes(s) ? (s as TaskType) : null;
}

export function templateToForm(t: ChecklistTemplate): ChecklistTemplateFormData {
  return {
    name: t.name,
    autoApplyToType: normalizeTaskType(t.autoApplyToType),
    propertyId: t.propertyId,
    items:
      t.items.length > 0
        ? t.items.map((i) => ({
            uuid: i.uuid,
            text: i.text,
            required: i.required,
            sortOrder: i.sortOrder,
            _deleted: false,
          }))
        : [{ text: '', required: false, sortOrder: 0 }],
  };
}
