'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useSWRConfig } from 'swr';
import { useProperties } from '@/hooks/use-properties';
import {
  useInventoryItems,
  createInventoryItem,
  deleteInventoryItem,
  addInventoryMovement,
} from '@/modules/operations/hooks/use-operations-data';
import type { InventoryCategory, InventoryMovementReason } from '@/modules/operations/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const CATEGORIES: InventoryCategory[] = ['minibar', 'supplies', 'linen', 'other'];

export default function OperationsInventoryPage() {
  const t = useTranslations('operations.inventory');
  const { properties, isLoading: propsLoading } = useProperties();
  const [propertyId, setPropertyId] = useState<string>('');

  useEffect(() => {
    const first = properties[0];
    if (!propertyId && first) {
      setPropertyId(first.id);
    }
  }, [properties, propertyId]);

  const { data, isLoading, mutate } = useInventoryItems(propertyId || undefined);
  const { mutate: globalMutate } = useSWRConfig();

  const items = data?.items ?? [];

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    sku: '',
    category: 'minibar' as InventoryCategory,
    unit: 'pcs',
    currentStock: 0,
    lowStockThreshold: 2,
    notes: '',
  });

  const [moveOpen, setMoveOpen] = useState<string | null>(null);
  const [moveDelta, setMoveDelta] = useState('');
  const [moveReason, setMoveReason] = useState<InventoryMovementReason>('restock');
  const [moveNote, setMoveNote] = useState('');

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId || !form.name.trim()) return;
    setCreating(true);
    try {
      await createInventoryItem({
        propertyId,
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        category: form.category,
        unit: form.unit,
        currentStock: Number(form.currentStock) || 0,
        lowStockThreshold: Number(form.lowStockThreshold) || 0,
        notes: form.notes.trim() || null,
      });
      setForm({
        name: '',
        sku: '',
        category: 'minibar',
        unit: 'pcs',
        currentStock: 0,
        lowStockThreshold: 2,
        notes: '',
      });
      await mutate();
      await globalMutate((k) => typeof k === 'string' && k.includes('/operations/reports'));
    } finally {
      setCreating(false);
    }
  }

  async function onMovement(itemId: string) {
    const d = parseInt(moveDelta, 10);
    if (!Number.isFinite(d) || d === 0) return;
    await addInventoryMovement(itemId, { delta: d, reason: moveReason, note: moveNote || null });
    setMoveOpen(null);
    setMoveDelta('');
    setMoveNote('');
    await mutate();
    await globalMutate((k) => typeof k === 'string' && k.includes('/operations/reports'));
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <Label htmlFor="inv-property">{t('property')}</Label>
          <Select
            id="inv-property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            disabled={propsLoading || properties.length === 0}
          >
            <option value="">{t('propertyPlaceholder')}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {propertyId && (
        <form onSubmit={onCreate} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-white">{t('addItem')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">{t('name')}</Label>
              <Input
                id="inv-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-sku">{t('sku')}</Label>
              <Input
                id="inv-sku"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-cat">{t('category')}</Label>
              <Select
                id="inv-cat"
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value as InventoryCategory }))
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`categories.${c}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-unit">{t('unit')}</Label>
              <Input
                id="inv-unit"
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-stock">{t('currentStock')}</Label>
              <Input
                id="inv-stock"
                type="number"
                value={form.currentStock}
                onChange={(e) => setForm((f) => ({ ...f, currentStock: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-low">{t('lowThreshold')}</Label>
              <Input
                id="inv-low"
                type="number"
                value={form.lowStockThreshold}
                onChange={(e) => setForm((f) => ({ ...f, lowStockThreshold: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-notes">{t('notes')}</Label>
            <Textarea
              id="inv-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? '…' : t('save')}
          </Button>
        </form>
      )}

      {propertyId && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white">{t('listTitle')}</h2>
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 bg-slate-800" />
              <Skeleton className="h-12 bg-slate-800" />
            </div>
          )}
          {!isLoading && items.length === 0 && <p className="text-sm text-slate-500">{t('empty')}</p>}
          <ul className="space-y-2">
            {items.map((it) => {
              const low =
                it.lowStockThreshold > 0 && it.currentStock <= it.lowStockThreshold;
              return (
                <li
                  key={it.id}
                  className={cn(
                    'rounded-lg border p-4',
                    low ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-950/50',
                  )}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-white">{it.name}</p>
                      <p className="text-xs text-slate-400">
                        {t(`categories.${it.category}`)} · {t('stock')}: {it.currentStock} {it.unit}
                        {it.sku ? ` · SKU: ${it.sku}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMoveOpen(moveOpen === it.id ? null : it.id)}
                      >
                        {t('adjustStock')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:text-red-300"
                        onClick={async () => {
                          if (!confirm(t('confirmDelete'))) return;
                          await deleteInventoryItem(it.id);
                          await mutate();
                        }}
                      >
                        {t('delete')}
                      </Button>
                    </div>
                  </div>
                  {moveOpen === it.id && (
                    <div className="mt-3 border-t border-slate-800 pt-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs" htmlFor={`delta-${it.id}`}>
                            {t('delta')}
                          </Label>
                          <Input
                            id={`delta-${it.id}`}
                            className="w-24"
                            value={moveDelta}
                            onChange={(e) => setMoveDelta(e.target.value)}
                            placeholder="+/-"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs" htmlFor={`reason-${it.id}`}>
                            {t('reason')}
                          </Label>
                          <Select
                            id={`reason-${it.id}`}
                            className="w-44"
                            value={moveReason}
                            onChange={(e) =>
                              setMoveReason(e.target.value as InventoryMovementReason)
                            }
                          >
                            <option value="restock">{t('reasons.restock')}</option>
                            <option value="consumption">{t('reasons.consumption')}</option>
                            <option value="adjustment">{t('reasons.adjustment')}</option>
                            <option value="task">{t('reasons.task')}</option>
                          </Select>
                        </div>
                        <Input
                          className="max-w-xs flex-1"
                          placeholder={t('moveNote')}
                          value={moveNote}
                          onChange={(e) => setMoveNote(e.target.value)}
                        />
                        <Button type="button" size="sm" onClick={() => onMovement(it.id)}>
                          {t('apply')}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!propertyId && !propsLoading && (
        <p className="text-sm text-slate-500">{t('selectPropertyFirst')}</p>
      )}
    </div>
  );
}
