'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface ChecklistTemplate {
  uuid: string;
  name: string;
  autoApplyToType: string | null;
  propertyId: string | null;
  createdAt: string;
  items: { uuid: string; text: string; required: boolean; sortOrder: number }[];
}

export function useChecklistTemplates() {
  return useQuery({
    queryKey: ['checklist-templates'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: { templates: ChecklistTemplate[] } }>('/checklist-templates');
      return res.data.data.templates;
    },
  });
}
