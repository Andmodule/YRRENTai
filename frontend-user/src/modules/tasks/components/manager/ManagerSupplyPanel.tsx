'use client';

import { ManagerSupplyMatrixView } from './ManagerSupplyMatrixView';
import { ManagerSupplyCatalogModal } from './ManagerSupplyCatalogModal';
import { ManagerSupplyCreateSheet } from './ManagerSupplyCreateSheet';

export function ManagerSupplyPanel({
  catalogOpen,
  onCatalogOpenChange,
  createSupplyOpen,
  onCreateSupplyOpenChange,
  matrixToolbarHost,
}: {
  catalogOpen: boolean;
  onCatalogOpenChange: (open: boolean) => void;
  createSupplyOpen: boolean;
  onCreateSupplyOpenChange: (open: boolean) => void;
  matrixToolbarHost: HTMLDivElement | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <ManagerSupplyCreateSheet open={createSupplyOpen} onOpenChange={onCreateSupplyOpenChange} />
      <ManagerSupplyCatalogModal open={catalogOpen} onOpenChange={onCatalogOpenChange} />
      <ManagerSupplyMatrixView toolbarPortalHost={matrixToolbarHost} />
    </div>
  );
}
