export type InventoryCategory = 'minibar' | 'supplies' | 'linen' | 'other';

export type InventoryMovementReason = 'restock' | 'consumption' | 'adjustment' | 'task';

export interface InventoryItem {
  id: string;
  propertyId: string;
  name: string;
  sku: string | null;
  category: InventoryCategory;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListingTranslationRow {
  id: string;
  propertyId: string;
  locale: string;
  title: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  updatedAt: string;
}

export interface ManagerReportSummary {
  period: { from: string; to: string };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    completed: number;
  };
  incidents: { total: number; open: number };
  bookings: {
    count: number;
    totalRevenueMinor: number;
    currency: string;
  };
  inventory: {
    lowStockCount: number;
    totalSku: number;
  };
}
