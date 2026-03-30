import useSWR from 'swr';
import { fetcher } from '@/lib/api/fetcher';
import { apiClient } from '@/lib/api/client';
import type { Property, CreatePropertyDto, UpdatePropertyDto } from '@/types';

export function useProperties() {
  const { data, error, isLoading, mutate } = useSWR<Property[]>(
    '/properties',
    fetcher,
  );

  async function createProperty(dto: CreatePropertyDto): Promise<Property> {
    const res = await apiClient.post<{ data: Property }>('/properties', dto);
    await mutate();
    return res.data.data;
  }

  async function updateProperty(id: string, dto: UpdatePropertyDto): Promise<Property> {
    const res = await apiClient.patch<{ data: Property }>(`/properties/${id}`, dto);
    await mutate();
    return res.data.data;
  }

  async function deleteProperty(id: string): Promise<void> {
    await apiClient.delete(`/properties/${id}`);
    await mutate();
  }

  return {
    properties: data ?? [],
    isLoading,
    isError: !!error,
    mutate,
    createProperty,
    updateProperty,
    deleteProperty,
  };
}

export function useProperty(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<Property>(
    id ? `/properties/${id}` : null,
    fetcher,
  );

  return { property: data, isLoading, isError: !!error, mutate };
}
