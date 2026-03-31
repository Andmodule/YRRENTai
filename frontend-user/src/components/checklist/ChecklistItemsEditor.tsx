'use client';

import { useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ChecklistTemplateFormData } from './checklist-template.schema';

function SortableItemRow({
  fieldId,
  fieldIndex,
  disabled,
  onRemoveOrDelete,
}: {
  fieldId: string;
  fieldIndex: number;
  disabled?: boolean;
  onRemoveOrDelete: (index: number, hasUuid: boolean) => void;
}) {
  const t = useTranslations('checklist.templates');
  const { register, setValue, control } = useFormContext<ChecklistTemplateFormData>();
  const uuid = useWatch({ control, name: `items.${fieldIndex}.uuid` });
  const required = useWatch({ control, name: `items.${fieldIndex}.required` });
  const hasUuid = Boolean(uuid);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldId, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? 'transform 150ms ease',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded-md border border-transparent bg-background p-2',
        isDragging && 'z-10 opacity-90 shadow-md',
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        disabled={disabled}
        aria-label={t('dragHandle')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4 shrink-0" />
      </button>
      <Input
        className="flex-1"
        placeholder={t('itemPlaceholder')}
        disabled={disabled}
        {...register(`items.${fieldIndex}.text` as const)}
      />
      <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="hidden sm:inline">{t('required')}</span>
        <Switch
          disabled={disabled}
          checked={!!required}
          onCheckedChange={(v) => setValue(`items.${fieldIndex}.required`, v, { shouldDirty: true })}
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-red-500"
        disabled={disabled}
        aria-label={t('removeItem')}
        onClick={() => onRemoveOrDelete(fieldIndex, hasUuid)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ChecklistItemsEditor({
  control,
  disabled,
}: {
  control: Control<ChecklistTemplateFormData>;
  disabled?: boolean;
}) {
  const t = useTranslations('checklist.templates');
  const { setValue } = useFormContext<ChecklistTemplateFormData>();
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'items' });
  const items = useWatch({ control, name: 'items' }) ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const visibleEntries = useMemo(
    () =>
      fields
        .map((field, index) => ({ field, index }))
        .filter((_, index) => !items[index]?._deleted),
    [fields, items],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = visibleEntries.findIndex((e) => e.field.id === active.id);
      const newIndex = visibleEntries.findIndex((e) => e.field.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const visIndices = visibleEntries.map((e) => e.index);
      const visibleItems = visIndices.map((i) => items[i]);
      const reorderedVisible = arrayMove(visibleItems, oldIndex, newIndex);

      let order = 0;
      const next: ChecklistTemplateFormData['items'] = items.map((row) => {
        if (row._deleted) return row;
        const nextRow = reorderedVisible[order++];
        if (!nextRow) return row;
        return {
          uuid: nextRow.uuid,
          text: nextRow.text ?? '',
          required: nextRow.required ?? false,
          sortOrder: (order - 1) * 10,
          _deleted: nextRow._deleted,
        };
      });
      replace(next);
    },
    [items, visibleEntries, replace],
  );

  const onRemoveOrDelete = useCallback(
    (index: number, hasUuid: boolean) => {
      if (hasUuid) {
        setValue(`items.${index}._deleted`, true, { shouldDirty: true });
      } else {
        remove(index);
      }
    },
    [remove, setValue],
  );

  const addItem = useCallback(() => {
    const visible = items.filter((i) => !i._deleted);
    const maxOrder = visible.length ? Math.max(...visible.map((i) => i.sortOrder ?? 0)) : -10;
    append({
      text: '',
      required: false,
      sortOrder: maxOrder + 10,
    });
  }, [append, items]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('itemsHeading')}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={visibleEntries.map((e) => e.field.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {visibleEntries.map(({ field, index }) => (
              <SortableItemRow
                key={field.id}
                fieldId={field.id}
                fieldIndex={index}
                disabled={disabled}
                onRemoveOrDelete={onRemoveOrDelete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={addItem} disabled={disabled}>
        <Plus className="h-4 w-4" />
        {t('addItem')}
      </Button>
    </div>
  );
}
