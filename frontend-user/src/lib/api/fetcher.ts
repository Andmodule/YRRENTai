import { apiClient } from './client';

export const fetcher = <T>(url: string): Promise<T> =>
  apiClient.get<{ data: T }>(url).then((res) => res.data.data);
