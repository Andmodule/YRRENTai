'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Controller, useForm, useFormState } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { useMediaQuery } from '@/hooks/use-media-query';
import { patchAutomationRuleParamsApi } from '@/lib/api/automations';
import { cn } from '@/lib/utils';
import type { AutomationRule } from '@/types/automations';

const ruleSettingsFormSchema = z.object({
  notifyManager: z.boolean(),
  delayThreshold: z.coerce.number().int().min(1).max(1440),
});

export type RuleSettingsFormValues = z.infer<typeof ruleSettingsFormSchema>;

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

export type RuleSettingsSheetProps = {
  rule: AutomationRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => Promise<void> | void;
};

export function RuleSettingsSheet({ rule, open, onOpenChange, onSaved }: RuleSettingsSheetProps) {
  const t = useTranslations('automations');
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const form = useForm<RuleSettingsFormValues>({
    resolver: zodResolver(ruleSettingsFormSchema),
    defaultValues: {
      notifyManager: true,
      delayThreshold: 30,
    },
  });

  const { control, handleSubmit, reset, register } = form;
  const { isDirty, isSubmitting, errors } = useFormState({ control });

  useEffect(() => {
    if (!open || !rule) return;
    reset({
      notifyManager: pickBool(rule.params.notifyManager, true),
      delayThreshold: pickNumber(rule.params.delayThreshold, 30),
    });
  }, [open, rule, reset]);

  const title = rule
    ? rule.titleKey === 'rules.generic.title'
      ? t('rules.generic.title', { key: rule.key })
      : t(rule.titleKey)
    : t('sheet.title');

  const onSubmit = handleSubmit(async (values) => {
    if (!rule) return;
    try {
      await patchAutomationRuleParamsApi(rule.id, {
        notifyManager: values.notifyManager,
        delayThreshold: values.delayThreshold,
      });
      await onSaved?.();
      toast.success(t('sheet.saveSuccess'));
      onOpenChange(false);
    } catch {
      toast.error(t('sheet.saveError'));
    }
  });

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
        {t('sheet.cancel')}
      </Button>
      <Button type="submit" form="rule-settings-form" disabled={!isDirty || isSubmitting} className="inline-flex gap-2">
        {isSubmitting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
        {t('sheet.save')}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={title}
        description={t('sheet.description')}
        footer={footer}
        className={
          isDesktop
            ? undefined
            : cn(
                '!inset-x-0 !bottom-0 !left-0 !right-0 !top-auto !h-[min(92dvh,92vh)] !max-h-[92dvh] !w-full !max-w-none rounded-t-2xl border-l-0 border-t',
                'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
              )
        }
        bodyClassName="pb-4"
      >
        {rule ? (
          <form id="rule-settings-form" className="space-y-6" onSubmit={onSubmit} noValidate>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                <Label htmlFor="notify-manager" className="text-sm font-medium">
                  {t('sheet.fields.notifyManager')}
                </Label>
                <Controller
                  name="notifyManager"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      id="notify-manager"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isSubmitting}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                  )}
                />
              </div>
              {errors.notifyManager ? (
                <p className="text-xs text-destructive">{errors.notifyManager.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="delay-threshold">{t('sheet.fields.delayThreshold')}</Label>
              <Input
                id="delay-threshold"
                type="number"
                min={1}
                max={1440}
                disabled={isSubmitting}
                className="max-w-xs"
                {...register('delayThreshold', { valueAsNumber: true })}
              />
              {errors.delayThreshold ? (
                <p className="text-xs text-destructive">{errors.delayThreshold.message}</p>
              ) : null}
            </div>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
