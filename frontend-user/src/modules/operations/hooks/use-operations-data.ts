import useSWR from 'swr';
import { apiClient } from '@/lib/api/client';
import type { InventoryItem, ListingTranslationRow, ManagerReportSummary } from '../types';
import type { InventoryCategory, InventoryMovementReason } from '../types';

async function getInventory(propertyId?: string): Promise<{ items: InventoryItem[] }> {
  const q = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
  const res = await apiClient.get<{ data: { items: InventoryItem[] } }>(`/operations/inventory${q}`);
  return res.data.data;
}

async function getReport(from: string, to: string): Promise<ManagerReportSummary> {
  const res = await apiClient.get<{ data: ManagerReportSummary }>(
    `/operations/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return res.data.data;
}

async function getTranslations(propertyId: string): Promise<{ translations: ListingTranslationRow[] }> {
  const res = await apiClient.get<{ data: { translations: ListingTranslationRow[] } }>(
    `/operations/listings/${propertyId}/translations`,
  );
  return res.data.data;
}

export function useInventoryItems(propertyId: string | undefined) {
  const key = propertyId ? `/operations/inventory?propertyId=${propertyId}` : '/operations/inventory';
  return useSWR(key, () => getInventory(propertyId), { revalidateOnFocus: true });
}

export function useReportSummary(from: string, to: string) {
  const key = `/operations/reports/summary?from=${from}&to=${to}`;
  return useSWR(key, () => getReport(from, to), { revalidateOnFocus: true });
}

export function useListingTranslations(propertyId: string | null) {
  const key = propertyId ? `/operations/listings/${propertyId}/translations` : null;
  return useSWR(key, () => getTranslations(propertyId!), { revalidateOnFocus: true });
}

export async function createInventoryItem(body: {
  propertyId: string;
  name: string;
  sku?: string | null;
  category?: InventoryCategory;
  unit?: string;
  currentStock?: number;
  lowStockThreshold?: number;
  notes?: string | null;
}): Promise<InventoryItem> {
  const res = await apiClient.post<{ data: { item: InventoryItem } }>('/operations/inventory', body);
  return res.data.data.item;
}

export async function patchInventoryItem(
  id: string,
  body: Partial<{
    name: string;
    sku: string | null;
    category: InventoryCategory;
    unit: string;
    lowStockThreshold: number;
    notes: string | null;
  }>,
): Promise<InventoryItem> {
  const res = await apiClient.patch<{ data: { item: InventoryItem } }>(`/operations/inventory/${id}`, body);
  return res.data.data.item;
}

export async function deleteInventoryItem(id: string): Promise<void> {
  await apiClient.delete(`/operations/inventory/${id}`);
}

export async function addInventoryMovement(
  itemId: string,
  body: { delta: number; reason: InventoryMovementReason; note?: string | null },
): Promise<{ item: InventoryItem }> {
  const res = await apiClient.post<{ data: { item: InventoryItem } }>(
    `/operations/inventory/${itemId}/movements`,
    body,
  );
  return { item: res.data.data.item };
}

export async function upsertListingTranslation(
  propertyId: string,
  locale: string,
  body: {
    title?: string | null;
    shortDescription?: string | null;
    longDescription?: string | null;
  },
): Promise<ListingTranslationRow> {
  const res = await apiClient.put<{ data: { translation: ListingTranslationRow } }>(
    `/operations/listings/${propertyId}/translations/${locale}`,
    body,
  );
  return res.data.data.translation;
}
