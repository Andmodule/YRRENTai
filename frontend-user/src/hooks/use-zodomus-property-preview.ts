'use client';

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface ZodomusPreviewRate {
  id: string;
  name?: string;
  active?: string;
  maxPersons?: string;
  policy?: string;
  policyId?: string;
}

export interface ZodomusPropertyPreview {
  externalPropertyId: string;
  displayName: string;
  address: string | null;
  city: string | null;
  country: string | null;
  rooms: Array<{
    id: string;
    name?: string;
    rates?: ZodomusPreviewRate[];
  }>;
}

type PreviewResponse = { status: 'disabled' } | ZodomusPropertyPreview;

async function fetchPreview(channelId: number, externalPropertyId: string): Promise<ZodomusPropertyPreview> {
  const res = await apiClient.get<{ data: PreviewResponse }>('/integrations/zodomus/property-preview', {
    params: { channelId, externalPropertyId: externalPropertyId.trim() },
  });
  const d = res.data?.data;
  if (!d || typeof d !== 'object') {
    throw new Error('Invalid preview response');
  }
  if ('status' in d && d.status === 'disabled') {
    throw new Error('Zodomus integration is disabled');
  }
  if (!('rooms' in d) || !Array.isArray((d as ZodomusPropertyPreview).rooms)) {
    throw new Error('Invalid preview response');
  }
  return d as ZodomusPropertyPreview;
}

export function useZodomusPropertyPreview() {
  return useMutation({
    mutationFn: ({ channelId, externalPropertyId }: { channelId: number; externalPropertyId: string }) =>
      fetchPreview(channelId, externalPropertyId),
  });
}
