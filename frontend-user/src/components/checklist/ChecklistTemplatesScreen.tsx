'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Info, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormProvider, useForm, type Resolver } from 'react-hook-form';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useMediaQuery } from '@/hooks/use-media-query';
import { apiClient } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useChecklistTemplates, type ChecklistTemplate } from '@/modules/checklist-templates/hooks/useChecklistTemplates';
import { emptyDraft, normalizeTaskType, templateToForm } from '@/modules/checklist-templates/form-utils';
import { saveChecklistTemplate } from '@/modules/checklist-templates/save-checklist-template';
import { useProperties } from '@/hooks/use-properties';
import { TASK_TYPE_VALUES, checklistTemplateSchema, type ChecklistTemplateFormData } from './checklist-template.schema';
import { ChecklistItemsEditor } from './ChecklistItemsEditor';
import { ChecklistPresetPickerDialog } from './ChecklistPresetPickerDialog';
import {
  getProfessionalPresetForm,
  type PresetChoice,
} from '@/modules/checklist-templates/presets/professional-presets-2026';

const MD_DOWN = '(max-width: 767px)';

export function ChecklistTemplatesScreen() {
  const t = useTranslations('checklist.templates');
  const tPresets = useTranslations('checklist.presets');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useMediaQuery(MD_DOWN);

  const [desktopSelected, setDesktopSelected] = useState<string | 'new' | null>(null);
  const mobileId = searchParams.get('id');
  const selectedId = isMobile ? (mobileId === 'new' ? 'new' : mobileId) : desktopSelected;

  const { data: templates, isLoading, isError, refetch } = useChecklistTemplates();
  const { properties } = useProperties();

  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [showPresetHint, setShowPresetHint] = useState(false);
  const originalRef = useRef<ChecklistTemplate | null>(null);
  const pendingPresetRef = useRef<PresetChoice | null>(null);
  const skipNextEmptyNewResetRef = useRef(false);

  const methods = useForm<ChecklistTemplateFormData>({
    resolver: zodResolver(checklistTemplateSchema) as Resolver<ChecklistTemplateFormData>,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: emptyDraft(),
  });

  const { control, handleSubmit, reset, watch, formState } = methods;
  const { isDirty } = formState;

  const watchName = watch('name');
  const watchType = watch('autoApplyToType');
  const watchProperty = watch('propertyId');
  const watchItems = watch('items');

  const editingUuid = selectedId && selectedId !== 'new' ? selectedId : null;

  useEffect(() => {
    if (selectedId !== 'new') return;
    const pending = pendingPresetRef.current;
    if (pending) {
      pendingPresetRef.current = null;
      skipNextEmptyNewResetRef.current = true;
      reset(getProfessionalPresetForm(locale, pending));
      originalRef.current = null;
      setShowPresetHint(pending !== 'blank');
      return;
    }
    if (skipNextEmptyNewResetRef.current) {
      skipNextEmptyNewResetRef.current = false;
      return;
    }
    reset(emptyDraft());
    originalRef.current = null;
    setShowPresetHint(false);
  }, [selectedId, locale, reset]);

  useEffect(() => {
    if (!templates || selectedId === 'new' || selectedId === null) return;
    const tpl = templates.find((x) => x.uuid === selectedId);
    if (tpl) {
      reset(templateToForm(tpl));
      originalRef.current = tpl;
      setShowPresetHint(false);
    }
  }, [selectedId, templates, reset]);

  const conflictTemplate = useMemo(() => {
    if (!watchType || !templates) return null;
    const curUuid = editingUuid;
    return templates.find((tpl) => {
      if (curUuid && tpl.uuid === curUuid) return false;
      const sameType = (tpl.autoApplyToType ?? null) === (watchType ?? null);
      const sameProp = (tpl.propertyId ?? null) === (watchProperty ?? null);
      return sameType && sameProp;
    });
  }, [watchType, watchProperty, templates, editingUuid]);

  const visibleItems = useMemo(
    () => (watchItems ?? []).filter((i) => !i._deleted),
    [watchItems],
  );

  const canSaveNew = useMemo(() => {
    const nameOk = (watchName ?? '').trim().length >= 2;
    const itemsOk =
      visibleItems.length >= 1 && visibleItems.every((i) => i.text.trim().length >= 1);
    return nameOk && itemsOk && (isDirty || showPresetHint);
  }, [watchName, visibleItems, isDirty, showPresetHint]);

  const canSaveEdit = useMemo(() => {
    const itemsOk =
      visibleItems.length >= 1 && visibleItems.every((i) => i.text.trim().length >= 1);
    return itemsOk && isDirty;
  }, [visibleItems, isDirty]);

  const selectTemplate = useCallback(
    (uuid: string) => {
      pendingPresetRef.current = null;
      if (isMobile) {
        router.push(`${pathname}?id=${encodeURIComponent(uuid)}`);
      } else {
        setDesktopSelected(uuid);
      }
    },
    [isMobile, pathname, router],
  );

  const openNewDialog = useCallback(() => {
    setPresetDialogOpen(true);
  }, []);

  const applyPresetChoice = useCallback(
    (choice: PresetChoice) => {
      pendingPresetRef.current = choice;
      if (isMobile) {
        router.push(`${pathname}?id=new`);
      } else {
        setDesktopSelected('new');
      }
    },
    [isMobile, pathname, router],
  );

  const clearSelection = useCallback(() => {
    pendingPresetRef.current = null;
    setShowPresetHint(false);
    if (isMobile) {
      router.push(pathname);
    } else {
      setDesktopSelected(null);
    }
  }, [isMobile, pathname, router]);

  const invalidateList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
  }, [queryClient]);

  const onSubmit = handleSubmit(async (values: ChecklistTemplateFormData) => {
    setSaving(true);
    try {
      const result = await saveChecklistTemplate(editingUuid, values, originalRef.current);
      await queryClient.refetchQueries({ queryKey: ['checklist-templates'] });

      if (!result.ok) {
        toast.error(t('savePartialError', { count: result.failedCount }));
        return;
      }

      if (!editingUuid) {
        toast.success(t('createdSuccess'));
        const id = result.createdUuid;
        if (id) {
          if (isMobile) {
            router.replace(`${pathname}?id=${encodeURIComponent(id)}`);
          } else {
            setDesktopSelected(id);
          }
        }
      } else {
        toast.success(t('savedSuccess'));
      }
      const fresh = queryClient.getQueryData<ChecklistTemplate[]>(['checklist-templates']);
      const self = editingUuid ?? result.createdUuid;
      if (self && fresh) {
        const tpl = fresh.find((x) => x.uuid === self);
        if (tpl) {
          reset(templateToForm(tpl));
          originalRef.current = tpl;
        }
      }
    } catch (e) {
      console.error(e);
      toast.error(t('savePartialError', { count: 1 }));
    } finally {
      setSaving(false);
    }
  });

  const handleDelete = useCallback(async () => {
    if (!editingUuid) return;
    setSaving(true);
    try {
      await apiClient.delete(`/checklist-templates/${editingUuid}`);
      await invalidateList();
      toast.success(t('deletedSuccess'));
      setDeleteOpen(false);
      clearSelection();
      reset(emptyDraft());
      originalRef.current = null;
    } catch (e) {
      console.error(e);
      toast.error(t('savePartialError', { count: 1 }));
    } finally {
      setSaving(false);
    }
  }, [editingUuid, invalidateList, clearSelection, reset, t]);

  const list = templates ?? [];

  const editorTitle = editingUuid ? watchName || originalRef.current?.name || '' : selectedId === 'new' ? watchName || t('new') : '';

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-destructive">{t('loadError')}</p>
        <Button type="button" variant="outline" className="mt-2" onClick={() => void refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  const listPanel = (
    <div className="flex w-full shrink-0 flex-col border-b border-border md:w-[320px] md:border-b-0 md:border-r md:pr-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('pageTitle')}</h2>
        <Button type="button" variant="outline" size="sm" onClick={openNewDialog}>
          <Plus className="mr-1 h-4 w-4" />
          {t('new')}
        </Button>
      </div>
      <ul className="max-h-[50vh] space-y-1 overflow-y-auto md:max-h-none">
        {list.length === 0 ? (
          <li className="rounded-xl border border-dashed border-teal-500/20 bg-teal-500/[0.03] p-5 text-center">
            <p className="text-sm text-muted-foreground">{t('emptyEditor')}</p>
            <Button type="button" className="mt-4" size="sm" onClick={openNewDialog}>
              <Plus className="mr-1 h-4 w-4" />
              {t('new')}
            </Button>
          </li>
        ) : (
          list.map((tpl) => {
            const active = selectedId === tpl.uuid;
            const typeLabel =
              tpl.autoApplyToType &&
              (TASK_TYPE_VALUES as readonly string[]).includes(tpl.autoApplyToType)
                ? t(`taskTypes.${tpl.autoApplyToType as (typeof TASK_TYPE_VALUES)[number]}`)
                : t('autoApplyNone');
            return (
              <li key={tpl.uuid}>
                <button
                  type="button"
                  onClick={() => selectTemplate(tpl.uuid)}
                  className={cn(
                    'w-full rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'border-teal-200 bg-teal-50 border-l-2 border-l-teal-500'
                      : 'hover:bg-muted/60',
                  )}
                >
                  <p className="font-medium">{tpl.name}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="font-normal">
                      {typeLabel}
                    </Badge>
                    <span>·</span>
                    <span>{t('itemCount', { count: tpl.items.length })}</span>
                  </p>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  const formPanel =
    selectedId === null ? (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {t('emptyEditor')}
      </div>
    ) : (
      <FormProvider {...methods}>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          {isMobile && (
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={clearSelection}>
                <ArrowLeft className="h-4 w-4" />
                {t('backToList')}
              </Button>
            </div>
          )}

          {showPresetHint && selectedId === 'new' && (
            <div
              className="flex gap-3 rounded-xl border border-teal-500/25 bg-gradient-to-r from-teal-500/10 to-transparent px-4 py-3 text-sm text-teal-100/90"
              role="status"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-400" aria-hidden />
              <p>{tPresets('editorHint')}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="tpl-name">{t('nameLabel')}</Label>
            <Input
              id="tpl-name"
              placeholder={t('namePlaceholder')}
              {...methods.register('name')}
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-auto">{t('autoApplyLabel')}</Label>
            <Select
              id="tpl-auto"
              value={watchType ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                methods.setValue('autoApplyToType', v === '' ? null : (v as ChecklistTemplateFormData['autoApplyToType']), {
                  shouldDirty: true,
                });
              }}
              disabled={saving}
            >
              <option value="">{t('autoApplyNone')}</option>
              {TASK_TYPE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {t(`taskTypes.${v}`)}
                </option>
              ))}
            </Select>
            {conflictTemplate && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('conflictWarning', { name: conflictTemplate.name })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-prop">{t('propertyLabel')}</Label>
            <Select
              id="tpl-prop"
              value={watchProperty ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                methods.setValue('propertyId', v === '' ? null : v, { shouldDirty: true });
              }}
              disabled={saving}
            >
              <option value="">{t('propertyAll')}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t('propertyHint')}</p>
          </div>

          <ChecklistItemsEditor control={control} disabled={saving} />

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="submit"
              disabled={
                saving || (!editingUuid ? !canSaveNew : !canSaveEdit)
              }
            >
              {saving ? t('saving') : editingUuid ? t('save') : t('create')}
            </Button>
            {editingUuid && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => setDeleteOpen(true)}
              >
                {t('delete')}
              </Button>
            )}
          </div>
        </form>
      </FormProvider>
    );

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-6xl flex-col md:flex-row">
      {(!isMobile || !mobileId) && listPanel}
      {(!isMobile || mobileId) && (
        <div className="min-h-[50vh] flex-1 md:min-h-0">{formPanel}</div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent
          title={t('deleteConfirmTitle', { name: editorTitle || '—' })}
          description={t('deleteConfirmDescription')}
        >
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void handleDelete()}>
              {t('confirmDelete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ChecklistPresetPickerDialog
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        onSelect={applyPresetChoice}
      />
    </div>
  );
}
