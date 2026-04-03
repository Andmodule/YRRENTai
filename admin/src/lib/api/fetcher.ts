import { apiClient } from './client';

export async function swrFetcher<T>(url: string): Promise<T> {
  const res = await apiClient.get<{ data: T }>(url);
  return res.data.data;
}
