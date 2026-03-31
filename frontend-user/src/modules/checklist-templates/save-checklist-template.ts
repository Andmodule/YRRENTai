import { apiClient } from '@/lib/api/client';
import type { ChecklistTemplateFormData } from '@/components/checklist/checklist-template.schema';
import { normalizeTaskType } from './form-utils';
import type { ChecklistTemplate } from './hooks/useChecklistTemplates';

export type SaveResult =
  | { ok: true; createdUuid?: string }
  | { ok: false; failedCount: number };

export async function saveChecklistTemplate(
  templateUuid: string | null,
  values: ChecklistTemplateFormData,
  original: ChecklistTemplate | null,
): Promise<SaveResult> {
  const active = values.items.filter((i) => !i._deleted);

  if (!templateUuid) {
    const res = await apiClient.post<{ data: { template: ChecklistTemplate } }>('/checklist-templates', {
      name: values.name.trim(),
      autoApplyToType: values.autoApplyToType,
      propertyId: values.propertyId,
      items: active.map((i) => ({
        text: i.text.trim(),
        required: i.required,
        sortOrder: i.sortOrder,
      })),
    });
    return { ok: true, createdUuid: res.data.data.template.uuid };
  }

  const orig = original;
  if (!orig) {
    return { ok: false, failedCount: 1 };
  }

  const requests: Promise<unknown>[] = [];

  const origType = normalizeTaskType(orig.autoApplyToType);
  const propChanged = (orig.propertyId ?? null) !== (values.propertyId ?? null);
  if (values.name.trim() !== orig.name || values.autoApplyToType !== origType || propChanged) {
    const body: Record<string, unknown> = {};
    if (values.name.trim() !== orig.name) body.name = values.name.trim();
    if (values.autoApplyToType !== origType) body.autoApplyToType = values.autoApplyToType;
    if (propChanged) body.propertyId = values.propertyId;
    requests.push(apiClient.patch(`/checklist-templates/${templateUuid}`, body));
  }

  const origMap = new Map(orig.items.map((i) => [i.uuid, i]));

  for (const item of values.items) {
    if (item._deleted && item.uuid) {
      requests.push(apiClient.delete(`/checklist-templates/${templateUuid}/items/${item.uuid}`));
    } else if (!item.uuid && !item._deleted) {
      requests.push(
        apiClient.post(`/checklist-templates/${templateUuid}/items`, {
          text: item.text.trim(),
          required: item.required,
          sortOrder: item.sortOrder,
        }),
      );
    } else if (item.uuid && !item._deleted) {
      const o = origMap.get(item.uuid);
      if (o && (o.text !== item.text || o.required !== item.required || o.sortOrder !== item.sortOrder)) {
        const patch: Record<string, unknown> = {};
        if (o.text !== item.text) patch.text = item.text.trim();
        if (o.required !== item.required) patch.required = item.required;
        if (o.sortOrder !== item.sortOrder) patch.sortOrder = item.sortOrder;
        requests.push(apiClient.patch(`/checklist-templates/${templateUuid}/items/${item.uuid}`, patch));
      }
    }
  }

  if (requests.length === 0) {
    return { ok: true };
  }

  const results = await Promise.allSettled(requests);
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    return { ok: false, failedCount: failed.length };
  }
  return { ok: true };
}
