'use client';

import { useCallback, useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { normalizePendingSupplyEvent } from '../../hooks/usePendingSupplyInterpretations';
import type { PendingSupplyInterpretationEvent } from '../../types';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Mic, X } from 'lucide-react';
import { Drawer as VaulDrawer } from 'vaul';
import { cn } from '@/lib/utils';
import { DrawerOverlay } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { useMatchMedia } from '@/hooks/use-match-media';
import { useProperties } from '@/hooks/use-properties';
import { apiClient } from '@/lib/api/client';
import { useVoiceRecorder, type VoiceAutoStopPayload } from '../../hooks/useVoiceRecorder';
import { parseVoiceTaskAudio } from '../../hooks/useVoiceTaskParse';
import type { Property } from '@/types';

type Phase = 'voice' | 'parsing' | 'review';

const VOICE_ACCENT =
  'border-primary/50 text-primary shadow-sm dark:border-primary/45 dark:bg-card/80 dark:text-primary';

function VoiceMicActiveHero({ label }: { label: string }) {
  return (
    <>
      <div className="relative z-[15] flex h-44 w-44 shrink-0 items-center justify-center">
        <span
          className="absolute inline-flex h-[120%] w-[120%] rounded-full bg-primary/15 animate-ping"
          style={{ animationDuration: '2s' }}
        />
        <span
          className="absolute inline-flex h-[95%] w-[95%] rounded-full bg-primary/10 animate-ping"
          style={{ animationDuration: '2.4s', animationDelay: '0.2s' }}
        />
        <span
          className="absolute inline-flex h-[72%] w-[72%] rounded-full border-2 border-primary/30"
          aria-hidden
        />
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-primary/10 shadow-lg shadow-primary/35 ring-4 ring-primary/35 animate-pulse">
          <Mic className="h-14 w-14 text-primary drop-shadow-md" strokeWidth={1.75} aria-hidden />
        </div>
      </div>
      <p
        className="max-w-md px-4 text-center text-sm font-medium text-muted-foreground animate-pulse sm:text-base"
        aria-live="polite"
        role="status"
      >
        {label}
      </p>
    </>
  );
}

export function ManagerSupplyCreateSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('tasks.managerSupply.supplyCreate');
  const locale = useLocale();
  const isDesktop = useMatchMedia('(min-width: 768px)');
  const queryClient = useQueryClient();
  const { properties } = useProperties();

  const [phase, setPhase] = useState<Phase>('voice');
  const [propertyId, setPropertyId] = useState<string>('');
  const [text, setText] = useState('');

  const { mutate: submitMutate, isPending: isSubmitting } = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ data: { event: PendingSupplyInterpretationEvent } }>(
        '/tasks/manager/supply-interpretations',
        {
          propertyId: propertyId.trim(),
          text: text.trim(),
        },
      );
      return res.data.data.event;
    },
    onSuccess: (event) => {
      toast.success(t('success'));
      const row = normalizePendingSupplyEvent(event);
      queryClient.setQueryData<PendingSupplyInterpretationEvent[]>(
        ['tasks', 'manager-supply-interpretations'],
        (prev) => {
          const list = prev ?? [];
          const rest = list.filter((x) => x.id !== row.id);
          return [row, ...rest];
        },
      );
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'manager-supply-matrix', 'rows'] });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      let detail = t('error');
      if (isAxiosError(err)) {
        const raw = err.response?.data?.message;
        const fromApi = Array.isArray(raw) ? raw.join(', ') : raw;
        if (typeof fromApi === 'string' && fromApi.trim()) {
          detail = fromApi.trim();
        } else if (err.response?.status === 404) {
          detail = t('errorNotFoundHint');
        }
      }
      toast.error(detail);
    },
  });

  const processVoiceBlob = useCallback(
    async (blob: Blob | null) => {
      if (!blob || blob.size === 0) {
        toast.error(t('parseEmpty'));
        setPhase('voice');
        return;
      }
      const ctx = propertyId.trim() || null;
      setPhase('parsing');
      try {
        const data = await parseVoiceTaskAudio(blob, ctx, locale);
        setText((data.transcript ?? '').trim());
        setPhase('review');
      } catch {
        toast.error(t('parseError'));
        setPhase('voice');
      }
    },
    [locale, propertyId, t],
  );

  const onVoiceAutoStop = useCallback(
    (payload: VoiceAutoStopPayload) => {
      if (payload.reason === 'max_duration') {
        toast.info(t('recordingStoppedMax'));
      } else if (payload.reason === 'silence') {
        toast.info(t('recordingStoppedSilence'));
      }
      if (!payload.blob || payload.blob.size === 0) {
        setPhase('voice');
        return;
      }
      void processVoiceBlob(payload.blob);
    },
    [processVoiceBlob, t],
  );

  const { status: recordingStatus, isRecording, startRecording, stopRecording, resetRecording } =
    useVoiceRecorder({ onAutoStop: onVoiceAutoStop });

  useEffect(() => {
    if (!open) {
      setPhase('voice');
      setPropertyId('');
      setText('');
      resetRecording();
    }
  }, [open, resetRecording]);

  const isRecordingFocus =
    phase === 'voice' &&
    (recordingStatus === 'requesting' || isRecording) &&
    recordingStatus !== 'unsupported';

  const handleStopRecording = useCallback(async () => {
    if (!isRecording) {
      toast.error(t('micNotRecording'));
      return;
    }
    const blob = await stopRecording();
    await processVoiceBlob(blob);
  }, [isRecording, processVoiceBlob, stopRecording, t]);

  const handleTypeManually = useCallback(() => {
    resetRecording();
    setText('');
    setPhase('review');
  }, [resetRecording]);

  const propertyOk = propertyId.trim().length > 0;
  const canSubmit = propertyOk && text.trim().length >= 3 && !isSubmitting;

  return (
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} direction={isDesktop ? 'right' : 'bottom'} modal>
      <VaulDrawer.Portal>
        <DrawerOverlay />
        <VaulDrawer.Content
          aria-describedby={undefined}
          className={cn(
            'tasks-theme fixed z-[100] flex flex-col border bg-background shadow-lg outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            isDesktop
              ? 'inset-y-0 right-0 top-0 bottom-0 left-auto h-dvh max-h-dvh w-[min(26rem,calc(100svw-0.5rem))] rounded-none rounded-l-xl border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
              : 'inset-x-0 bottom-0 max-h-[min(92dvh,92vh)] rounded-t-xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          )}
        >
          {!isDesktop ? (
            <VaulDrawer.Handle className="relative z-20 mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted" />
          ) : null}

          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 pb-3 pt-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <VaulDrawer.Title className="text-lg font-semibold leading-tight text-foreground">
                {phase === 'review' ? t('reviewTitle') : t('voiceTitle')}
              </VaulDrawer.Title>
              <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
            </div>
            <VaulDrawer.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t('closeAria')}>
                <X className="h-4 w-4" />
              </Button>
            </VaulDrawer.Close>
          </div>

          {phase === 'voice' || phase === 'parsing' ? (
            <>
              {phase === 'voice' ? (
                <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                  <div className="space-y-4 px-5 py-4 sm:px-6">
                    <div className="space-y-2">
                      <Label htmlFor="supply-create-property">{t('propertyLabel')}</Label>
                      <Select
                        id="supply-create-property"
                        className="w-full"
                        value={propertyId}
                        onChange={(e) => setPropertyId(e.target.value)}
                      >
                        <option value="">{t('propertyPlaceholder')}</option>
                        {properties.map((p: Property) => (
                          <option key={p.id} value={p.id}>
                            {p.name || p.address || p.id}
                          </option>
                        ))}
                      </Select>
                      {!propertyOk ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400">{t('propertyRequired')}</p>
                      ) : null}
                    </div>

                    <div
                      className={cn(
                        'flex min-h-[200px] flex-col items-center justify-start gap-3 rounded-xl border border-dashed border-border/60 bg-muted/10 px-3 py-6',
                      )}
                    >
                      {recordingStatus === 'unsupported' ? (
                        <p className="max-w-md text-center text-sm text-muted-foreground">{t('micUnsupported')}</p>
                      ) : isRecordingFocus ? (
                        <>
                          <VoiceMicActiveHero label={t('listeningPlaceholder')} />
                          <ol className="max-w-sm space-y-2 text-left text-[11px] text-muted-foreground">
                            <li className={cn('flex gap-2', VOICE_ACCENT)}>
                              <span className="font-semibold">1.</span>
                              {t('step1')}
                            </li>
                            <li className="flex gap-2">
                              <span className="font-semibold">2.</span>
                              {t('step2')}
                            </li>
                          </ol>
                        </>
                      ) : (
                        <>
                          <div className="relative z-[15] flex h-36 w-36 shrink-0 items-center justify-center">
                            <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-muted/40 ring-2 ring-border">
                              <Mic className="h-10 w-10 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                            </div>
                          </div>
                          <p className="max-w-md text-center text-xs text-muted-foreground">{t('micHint')}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative z-0 flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-10">
                  <VoiceMicActiveHero label={t('parsing')} />
                </div>
              )}

              {phase === 'voice' ? (
                <div className="shrink-0 space-y-3 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
                  {recordingStatus === 'unsupported' ? null : (
                    <Button
                      type="button"
                      className={cn(
                        'w-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:opacity-60',
                        isRecordingFocus ? 'h-14 text-base font-semibold' : 'h-12',
                      )}
                      disabled={recordingStatus === 'requesting' || !propertyOk}
                      onClick={() => {
                        if (!propertyOk) {
                          toast.error(t('propertyRequired'));
                          return;
                        }
                        if (isRecording) void handleStopRecording();
                        else void startRecording();
                      }}
                    >
                      {recordingStatus === 'requesting' ? (
                        <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin" aria-hidden />
                      ) : null}
                      {recordingStatus === 'denied'
                        ? t('micRetry')
                        : isRecording
                          ? t('stopRecording')
                          : t('startRecording')}
                    </Button>
                  )}
                  <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={handleTypeManually}>
                    {t('typeManually')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4 sm:px-6">
              <div className="space-y-2">
                <Label htmlFor="supply-review-property">{t('propertyLabel')}</Label>
                <Select
                  id="supply-review-property"
                  className="w-full"
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                >
                  <option value="">{t('propertyPlaceholder')}</option>
                  {properties.map((p: Property) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.address || p.id}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="supply-text">{t('textLabel')}</Label>
                <Textarea
                  id="supply-text"
                  rows={8}
                  className="min-h-[140px] resize-y"
                  placeholder={t('textPlaceholder')}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  disabled={isSubmitting}
                  onClick={() => {
                    resetRecording();
                    setPhase('voice');
                  }}
                >
                  {t('backToVoice')}
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  variant="default"
                  disabled={!canSubmit}
                  onClick={() => submitMutate()}
                >
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                  {t('submit')}
                </Button>
              </div>
            </div>
          )}
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
}
