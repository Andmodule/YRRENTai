'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Drawer as VaulDrawer } from 'vaul';
import { Loader2, Mic, X, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useVoiceRecorder } from '@/hooks/use-voice-recorder';
import { useUploadIncidentPhotos } from '@/hooks/use-tasks';
import {
  postStaffVoicePreview,
  postStaffVoiceSubmit,
  postStaffVoiceTranscribe,
  type StaffVoicePreviewData,
  type StaffMiniAppButtonPressed,
} from '@/lib/api/staff-voice-report';
import { StaffVoiceInfographic } from './staff-voice-infographic';

import type { StaffVoiceMode } from './staff-voice-types';

export type { StaffVoiceMode };

/** Вызов из того же tap/click, что открывает лист — иначе iOS Safari не даст микрофон. */
export type StaffVoiceReportSheetHandle = {
  startRecordingFromUserGesture: () => void;
};

/** Пульсирующие кольца как у менеджера (SmartCreateSheet VoiceMicActiveHero), палитра staff. */
function StaffVoiceMicActiveHero({ label }: { label: string }) {
  return (
    <>
      <div className="relative z-[15] flex h-44 w-44 shrink-0 items-center justify-center">
        <span
          className="absolute inline-flex h-[120%] w-[120%] rounded-full bg-teal-500/15 animate-ping"
          style={{ animationDuration: '2s' }}
        />
        <span
          className="absolute inline-flex h-[95%] w-[95%] rounded-full bg-teal-500/10 animate-ping"
          style={{ animationDuration: '2.4s', animationDelay: '0.2s' }}
        />
        <span className="absolute inline-flex h-[72%] w-[72%] rounded-full border-2 border-teal-500/30" aria-hidden />
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-teal-500/40 to-teal-500/10 shadow-lg shadow-teal-600/35 ring-4 ring-teal-500/35 animate-pulse">
          <Mic className="h-14 w-14 text-teal-600 drop-shadow-md" strokeWidth={1.75} aria-hidden />
        </div>
      </div>
      <p
        className="max-w-md px-4 text-center text-sm font-medium text-slate-600 animate-pulse sm:text-base"
        aria-live="polite"
        role="status"
      >
        {label}
      </p>
    </>
  );
}

function StaffVoiceMicIdleHero() {
  return (
    <div className="relative z-[15] flex h-44 w-44 shrink-0 items-center justify-center">
      <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-slate-100 ring-2 ring-slate-200">
        <Mic className="h-12 w-12 text-slate-400" strokeWidth={1.75} aria-hidden />
      </div>
    </div>
  );
}

/** Локализованный статус задачи для экрана проверки (без сырого `done` и т.п.). */
function formatSuggestedStatusRu(raw: string | null | undefined): string {
  if (raw == null || raw === '') return '—';
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    done: 'Готово',
    in_progress: 'В работе',
    pending: 'Ожидает',
    issue: 'Проблема',
  };
  return map[key] ?? raw;
}

type Phase = 'voice' | 'parsing' | 'clarify' | 'review';

export type StaffVoiceTaskOption = { uuid: string; label: string };

type StaffVoiceReportSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode: StaffVoiceMode;
  taskOptions: StaffVoiceTaskOption[];
  /** Предвыбор (например следующая по времени задача); иначе берётся первая из списка */
  defaultTaskUuid: string;
  /** Режим водителя: отчёт по объекту маршрута без задачи уборки */
  routePropertyId?: string | null;
  routePropertyLabel?: string | null;
};

export const StaffVoiceReportSheet = forwardRef<StaffVoiceReportSheetHandle, StaffVoiceReportSheetProps>(
  function StaffVoiceReportSheet(
    { open, onOpenChange, initialMode, taskOptions, defaultTaskUuid, routePropertyId, routePropertyLabel },
    ref,
  ) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<StaffVoiceMode>(initialMode);
  const [phase, setPhase] = useState<Phase>('voice');
  const [preview, setPreview] = useState<StaffVoicePreviewData | null>(null);
  const [clarifyText, setClarifyText] = useState('');
  const [editTaskComment, setEditTaskComment] = useState('');
  const [editIncTitle, setEditIncTitle] = useState('');
  const [editIncDesc, setEditIncDesc] = useState('');
  const lastBlobRef = useRef<Blob | null>(null);
  const clarifyTextRef = useRef('');
  const phaseRef = useRef<Phase>('voice');
  const clarifyPrevPhaseRef = useRef<Phase>(phase);
  const [selectedTaskUuid, setSelectedTaskUuid] = useState('');
  const [clarifyTranscribing, setClarifyTranscribing] = useState(false);
  const [incidentPhotoFiles, setIncidentPhotoFiles] = useState<File[]>([]);
  const [voiceSubmitting, setVoiceSubmitting] = useState(false);
  const incidentPhotosInputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: uploadIncidentPhotos } = useUploadIncidentPhotos();

  const initialForSession = useMemo(() => {
    return defaultTaskUuid && taskOptions.some((o) => o.uuid === defaultTaskUuid)
      ? defaultTaskUuid
      : taskOptions[0]?.uuid ?? '';
  }, [defaultTaskUuid, taskOptions]);

  /** Пока лист только открылся — до useLayoutEffect; нужно для ref.startRecording в том же жесте. */
  const effectiveTaskUuid = open ? (selectedTaskUuid || initialForSession) : selectedTaskUuid;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    clarifyTextRef.current = clarifyText;
  }, [clarifyText]);

  useLayoutEffect(() => {
    if (open) {
      setMode(initialMode);
      setPhase('voice');
      setPreview(null);
      setClarifyText('');
      setClarifyTranscribing(false);
      setEditTaskComment('');
      setEditIncTitle('');
      setEditIncDesc('');
      setIncidentPhotoFiles([]);
      setVoiceSubmitting(false);
      lastBlobRef.current = null;
      const initial =
        defaultTaskUuid && taskOptions.some((o) => o.uuid === defaultTaskUuid)
          ? defaultTaskUuid
          : taskOptions[0]?.uuid ?? '';
      setSelectedTaskUuid(initial);
    } else {
      setSelectedTaskUuid('');
    }
  }, [open, initialMode, defaultTaskUuid, taskOptions]);

  const routePid = routePropertyId?.trim() ?? '';
  const isRoutePropertyVoice = Boolean(routePid);

  useEffect(() => {
    if (!preview) return;
    setEditTaskComment(preview.task.comment);
    setEditIncTitle(preview.incident.title ?? '');
    setEditIncDesc(preview.incident.description ?? '');
  }, [preview]);

  const processBlob = useCallback(
    async (blob: Blob | null, clarification?: string) => {
      if (!blob || blob.size === 0) {
        toast.error('Пустая запись');
        setPhase('voice');
        return;
      }
      if (!isRoutePropertyVoice && !effectiveTaskUuid.trim()) {
        toast.error('Не выбрана задача');
        setPhase('voice');
        return;
      }
      lastBlobRef.current = blob;
      setPhase('parsing');
      try {
        const data = await postStaffVoicePreview(blob, mode, {
          taskUuid: isRoutePropertyVoice ? undefined : effectiveTaskUuid,
          propertyId: isRoutePropertyVoice ? routePid : undefined,
          clarificationText: clarification,
          language: 'ru',
        });
        setPreview(data);
        if (data.needsClarification && data.clarificationQuestions.length > 0) {
          setPhase('clarify');
          return;
        }
        setPhase('review');
      } catch (e: unknown) {
        const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string } } }).response?.data?.message : null;
        toast.error(typeof msg === 'string' ? msg : 'Не удалось распознать запись');
        setPhase('voice');
      }
    },
    [effectiveTaskUuid, mode, isRoutePropertyVoice, routePid],
  );

  const finishClarifyRecording = useCallback(
    async (blob: Blob | null) => {
      if (phaseRef.current !== 'clarify') return;
      const original = lastBlobRef.current;
      if (!original?.size) {
        toast.error('Нет исходной записи');
        return;
      }
      let merged = clarifyTextRef.current.trim();
      if (blob?.size) {
        setClarifyTranscribing(true);
        try {
          const spoken = await postStaffVoiceTranscribe(blob, 'ru');
          const piece = spoken.trim();
          if (piece) merged = merged ? `${merged}\n${piece}` : piece;
        } catch {
          toast.error('Не удалось распознать');
          return;
        } finally {
          setClarifyTranscribing(false);
        }
      }
      if (!merged) {
        toast.error('Нужен текст ответа или распознанная речь');
        return;
      }
      setClarifyText(merged);
      clarifyTextRef.current = merged;
      await processBlob(original, merged);
    },
    [processBlob],
  );

  const processBlobRef = useRef(processBlob);
  processBlobRef.current = processBlob;
  const finishClarifyRecordingRef = useRef(finishClarifyRecording);
  finishClarifyRecordingRef.current = finishClarifyRecording;

  const { status: recordingStatus, isRecording, startRecording, stopRecording, resetRecording } =
    useVoiceRecorder({
      onAutoStop: (payload) => {
        const p = phaseRef.current;
        if (p === 'voice') void processBlobRef.current(payload.blob);
        else if (p === 'clarify') void finishClarifyRecordingRef.current(payload.blob);
      },
    });

  useImperativeHandle(
    ref,
    () => ({
      startRecordingFromUserGesture: () => {
        void startRecording();
      },
    }),
    [startRecording],
  );

  useEffect(() => {
    if (!open) {
      resetRecording();
      clarifyPrevPhaseRef.current = 'voice';
    }
  }, [open, resetRecording]);

  /** Один раз при входе в уточнение — сброс и автозапись (как флоу 1). */
  useEffect(() => {
    const was = clarifyPrevPhaseRef.current;
    clarifyPrevPhaseRef.current = phase;
    if (phase === 'clarify' && was !== 'clarify') {
      resetRecording();
      const id = window.setTimeout(() => {
        void startRecording().catch(() => {
          /* getUserMedia может потребовать жест — см. кнопку внизу */
        });
      }, 50);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [phase, resetRecording, startRecording]);

  const isRecordingFocus =
    phase === 'voice' &&
    (recordingStatus === 'requesting' || isRecording) &&
    recordingStatus !== 'unsupported';

  const handleMainButton = async () => {
    if (recordingStatus === 'unsupported') return;
    try {
      if (isRecording) {
        const blob = await stopRecording();
        await processBlob(blob);
      } else {
        await startRecording();
      }
    } catch (e) {
      console.error('[StaffVoiceReportSheet]', e);
      toast.error('Не удалось использовать микрофон');
      setPhase('voice');
    }
  };

  const handleClarifyMicButton = async () => {
    if (recordingStatus === 'unsupported' || clarifyTranscribing) return;
    try {
      if (isRecording) {
        const blob = await stopRecording();
        await finishClarifyRecording(blob);
      } else if (clarifyText.trim()) {
        await finishClarifyRecording(null);
      } else {
        await startRecording();
      }
    } catch (e) {
      console.error('[StaffVoiceReportSheet clarify]', e);
      toast.error('Не удалось использовать микрофон');
    }
  };

  const handleSubmit = async () => {
    if (!preview || voiceSubmitting) return;
    if (!isRoutePropertyVoice && !effectiveTaskUuid.trim()) return;
    setVoiceSubmitting(true);
    try {
      const hasShortages = Boolean(preview.task.shortages?.trim());
      let suggestedStatus = preview.task.suggestedStatus;
      if (hasShortages && suggestedStatus === 'in_progress') {
        suggestedStatus = 'pending';
      }

      let incidentPhotoUrls: string[] | undefined;
      if (preview.incident.include && incidentPhotoFiles.length > 0) {
        incidentPhotoUrls = await uploadIncidentPhotos(incidentPhotoFiles);
      }

      await postStaffVoiceSubmit({
        taskUuid: isRoutePropertyVoice ? undefined : effectiveTaskUuid,
        propertyId: isRoutePropertyVoice ? routePid : undefined,
        clientRequestId: crypto.randomUUID(),
        buttonPressed: preview.buttonPressed as StaffMiniAppButtonPressed,
        transcript: preview.transcript,
        detectedMode: preview.detectedMode,
        task: {
          suggestedStatus,
          comment: editTaskComment.trim() || preview.task.comment,
          shortages: preview.task.shortages,
        },
        incident: {
          include: preview.incident.include,
          type: preview.incident.type,
          title: editIncTitle.trim() || preview.incident.title,
          description: editIncDesc.trim() || preview.incident.description,
          risk: preview.incident.risk,
          photoUrls: incidentPhotoUrls,
        },
      });
      toast.success('Отправлено');
      await queryClient.invalidateQueries({ queryKey: ['tasks', 'staff'] });
      await queryClient.invalidateQueries({ queryKey: ['incidents', 'staff-history'] });
      if (isRoutePropertyVoice) {
        await queryClient.invalidateQueries({ queryKey: ['tasks', 'staff-delivery-route'] });
      }
      onOpenChange(false);
    } catch {
      toast.error('Не удалось отправить');
    } finally {
      setVoiceSubmitting(false);
    }
  };

  const [micEnvWarning, setMicEnvWarning] = useState(false);
  useEffect(() => {
    setMicEnvWarning(
      typeof window !== 'undefined' &&
        !window.isSecureContext &&
        window.location.hostname !== 'localhost',
    );
  }, []);

  const highRisk = preview?.incident.include && preview.incident.risk === 'high';

  const reviewIncidentPrimary =
    Boolean(preview?.incident.include) && !Boolean(preview?.task.shortages?.trim());

  const clarifyRecordingFocus =
    phase === 'clarify' &&
    (recordingStatus === 'requesting' || isRecording) &&
    recordingStatus !== 'unsupported';

  return (
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} modal>
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" />
        <VaulDrawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-[60] flex h-[min(96dvh,96svh)] max-h-[min(96dvh,96svh)] min-h-[min(88dvh,88svh)] flex-col rounded-t-2xl bg-white shadow-xl outline-none',
          )}
          aria-describedby="staff-voice-sheet-desc"
        >
          <VaulDrawer.Description id="staff-voice-sheet-desc" className="sr-only">
            {isRoutePropertyVoice
              ? 'Голосовой отчёт по объекту маршрута: инцидент или замечание для менеджера.'
              : mode === 'INCIDENT'
                ? 'Голосовое сообщение об инциденте для менеджера; уборка привязана только как объект. Отправка.'
                : 'Голосовой отчёт по задаче уборки: статус, довоз или инцидент. Проверка и отправка.'}
          </VaulDrawer.Description>

          <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-slate-200" />

          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2">
            <div className="min-w-0 flex-1">
              <VaulDrawer.Title className="text-base font-semibold text-slate-900">Голосовой отчёт</VaulDrawer.Title>
              {routePropertyLabel?.trim() ? (
                <p className="mt-0.5 line-clamp-2 text-xs font-medium text-teal-800">{routePropertyLabel.trim()}</p>
              ) : null}
              {isRoutePropertyVoice ? (
                <p className="mt-0.5 text-xs text-slate-500">
                  Отчёт привязан к объекту на маршруте (без задачи уборки на этот объект).
                </p>
              ) : mode === 'INCIDENT' ? (
                <p className="mt-0.5 text-xs text-slate-500">
                  Создаётся инцидент для менеджера; отдельную задачу на довоз вы не создаёте.
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
              aria-label="Закрыть"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {phase === 'voice' || phase === 'parsing' ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {phase === 'voice' ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center gap-2 px-4 pb-3 pt-3 sm:gap-2.5 sm:px-5">
                    {micEnvWarning ? (
                      <p className="text-center text-sm text-amber-700">
                        Откройте приложение по HTTPS — иначе браузер может не дать доступ к микрофону.
                      </p>
                    ) : null}
                    {recordingStatus === 'unsupported' ? (
                      <p className="text-center text-sm text-slate-500">Запись звука не поддерживается в этом браузере</p>
                    ) : isRecordingFocus ? (
                      <StaffVoiceMicActiveHero label={isRecording ? 'Слушаю…' : 'Подключаем микрофон…'} />
                    ) : (
                      <StaffVoiceMicIdleHero />
                    )}
                    {recordingStatus === 'denied' ? (
                      <p className="text-center text-sm text-slate-500">Разрешите доступ к микрофону в настройках браузера</p>
                    ) : null}

                    <div className="w-full max-w-md shrink-0 px-0.5 pb-1 pt-1">
                      <StaffVoiceInfographic
                        mode={mode}
                        className="pt-1"
                        voiceEmphasis={mode === 'INCIDENT' ? 'incident' : 'task'}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-10">
                    <StaffVoiceMicActiveHero label="Распознаём…" />
                  </div>
                )}
              </div>

              {phase === 'voice' && recordingStatus !== 'unsupported' ? (
                <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Button
                    type="button"
                    className={cn(
                      'h-14 w-full rounded-xl text-base font-semibold shadow-lg shadow-teal-900/20',
                      isRecordingFocus ? 'bg-teal-700 hover:bg-teal-700' : 'bg-teal-600 hover:bg-teal-500',
                    )}
                    disabled={recordingStatus === 'requesting'}
                    onClick={() => void handleMainButton()}
                  >
                    {recordingStatus === 'requesting' ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin" aria-hidden />
                        Подготовка…
                      </>
                    ) : isRecording ? (
                      'Остановить запись'
                    ) : (
                      'Начать запись'
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          {phase === 'clarify' && preview ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2 pt-1">
                <h3 className="text-lg font-bold leading-snug tracking-tight text-slate-900">Нужно уточнение</h3>
                <ul className="mt-3 list-none space-y-3">
                  {preview.clarificationQuestions.map((q, i) => (
                    <li
                      key={i}
                      className="rounded-2xl border border-teal-100 bg-teal-50/90 px-4 py-3 text-base font-medium leading-relaxed text-slate-900"
                    >
                      {q}
                    </li>
                  ))}
                </ul>

                {clarifyTranscribing ? (
                  <div className="mt-6 flex flex-col items-center justify-center gap-3 py-8">
                    <Loader2 className="h-12 w-12 animate-spin text-teal-600" aria-hidden />
                    <p className="text-sm font-medium text-slate-700">Распознаём ответ…</p>
                  </div>
                ) : (
                  <div className="mt-6 flex flex-col items-center gap-2">
                    {recordingStatus === 'unsupported' ? (
                      <p className="text-center text-sm text-slate-500">Запись не поддерживается в этом браузере</p>
                    ) : clarifyRecordingFocus ? (
                      <StaffVoiceMicActiveHero label={isRecording ? 'Слушаю…' : 'Подключаем микрофон…'} />
                    ) : (
                      <StaffVoiceMicIdleHero />
                    )}
                    {recordingStatus === 'denied' ? (
                      <p className="text-center text-sm text-slate-500">Разрешите доступ к микрофону в настройках браузера</p>
                    ) : null}
                  </div>
                )}

                <label className="mt-6 text-xs font-medium text-slate-600" htmlFor="clarify-input">
                  Текст ответа (можно править после голоса)
                </label>
                <Textarea
                  id="clarify-input"
                  value={clarifyText}
                  onChange={(e) => setClarifyText(e.target.value)}
                  className="mt-1 min-h-[100px] rounded-xl border-slate-200"
                  placeholder="Например: да, только ванная…"
                />
                {clarifyText.trim() && !isRecording && !clarifyTranscribing && recordingStatus !== 'unsupported' ? (
                  <button
                    type="button"
                    className="mt-2 self-start text-sm font-medium text-teal-700 underline decoration-teal-600/40 underline-offset-2"
                    onClick={() => void startRecording().catch(() => undefined)}
                  >
                    Дозаписать голосом
                  </button>
                ) : null}
              </div>

              {!clarifyTranscribing && recordingStatus !== 'unsupported' ? (
                <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Button
                    type="button"
                    className={cn(
                      'h-14 w-full rounded-xl text-base font-semibold shadow-lg shadow-teal-900/20',
                      clarifyRecordingFocus ? 'bg-teal-700 hover:bg-teal-700' : 'bg-teal-600 hover:bg-teal-500',
                    )}
                    disabled={recordingStatus === 'requesting'}
                    onClick={() => void handleClarifyMicButton()}
                  >
                    {recordingStatus === 'requesting' ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin" aria-hidden />
                        Подготовка…
                      </>
                    ) : isRecording ? (
                      'Остановить запись'
                    ) : clarifyText.trim() ? (
                      'Сформировать сводку'
                    ) : (
                      'Начать запись'
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          {phase === 'review' && preview ? (
            <>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-2 pt-1">
                <p className="text-center text-sm font-semibold text-slate-800">
                  {reviewIncidentPrimary ? 'Проверьте инцидент перед отправкой' : 'Проверьте перед отправкой'}
                </p>
                {reviewIncidentPrimary ? (
                  <p className="mt-1 text-center text-xs text-slate-600">
                    {isRoutePropertyVoice
                      ? 'Основное — инцидент на объекте маршрута; менеджер увидит карточку и при необходимости назначит работы.'
                      : 'Основное — карточка инцидента. Уборка закрывается как контекст; довоз при необходимости назначит менеджер.'}
                  </p>
                ) : null}

                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-teal-200 bg-teal-50/80 p-4 text-left">
                    <p className="text-xs font-bold uppercase text-teal-800">
                      {isRoutePropertyVoice
                        ? 'Объект маршрута'
                        : reviewIncidentPrimary
                          ? 'Уборка (контекст)'
                          : 'Задача'}
                    </p>
                    <p className="mt-1 text-sm text-slate-800">
                      Статус:{' '}
                      <span className="font-semibold">
                        {formatSuggestedStatusRu(
                          preview.task.shortages?.trim() && preview.task.suggestedStatus === 'in_progress'
                            ? 'pending'
                            : preview.task.suggestedStatus,
                        )}
                      </span>
                    </p>
                    {preview.task.shortages?.trim() ? (
                      <p className="mt-1 text-xs text-slate-600">
                        Довоз / снабжение: менеджер назначит исполнителя отдельно.
                      </p>
                    ) : null}
                    {preview.task.shortages ? (
                      <p className="mt-1 text-sm text-slate-700">
                        Снабжение (довоз / замена): {preview.task.shortages}
                      </p>
                    ) : null}
                    <label className="mt-2 block text-xs font-medium text-slate-600" htmlFor="edit-task-comment">
                      {isRoutePropertyVoice
                        ? 'Комментарий (для менеджера)'
                        : reviewIncidentPrimary
                          ? 'Заметка к уборке (для менеджера)'
                          : 'Комментарий к задаче'}
                    </label>
                    <Textarea
                      id="edit-task-comment"
                      value={editTaskComment}
                      onChange={(e) => setEditTaskComment(e.target.value)}
                      className="mt-1 min-h-[88px] rounded-xl border-slate-200 text-sm"
                    />
                  </div>

                  {preview.incident.include ? (
                    <div
                      className={cn(
                        'rounded-2xl border p-4 text-left',
                        highRisk ? 'border-rose-400 bg-rose-50' : 'border-rose-200 bg-rose-50/90',
                      )}
                    >
                      <p className="text-xs font-bold uppercase text-rose-800">Инцидент</p>
                      <label className="mt-1 block text-xs text-rose-800" htmlFor="edit-inc-title">
                        Заголовок
                      </label>
                      <input
                        id="edit-inc-title"
                        value={editIncTitle}
                        onChange={(e) => setEditIncTitle(e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm"
                      />
                      <p className="mt-2 text-xs text-rose-700">
                        Тип: {preview.incident.type ?? 'damage'} · риск: {preview.incident.risk ?? '—'}
                      </p>
                      <label className="mt-2 block text-xs text-rose-800" htmlFor="edit-inc-desc">
                        Описание
                      </label>
                      <Textarea
                        id="edit-inc-desc"
                        value={editIncDesc}
                        onChange={(e) => setEditIncDesc(e.target.value)}
                        className="mt-0.5 min-h-[80px] rounded-xl border-rose-200 text-sm"
                      />
                      <div className="mt-3">
                        <p className="text-xs font-medium text-rose-900">Фото к инциденту</p>
                        <p className="mt-0.5 text-[11px] text-rose-800/90">
                          {preview.task.shortages?.trim()
                            ? 'При довозе и инциденте фото прикрепляются к инциденту.'
                            : 'До 5 снимков — увидит менеджер в карточке инцидента.'}
                        </p>
                        <input
                          ref={incidentPhotosInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="sr-only"
                          onChange={(e) => {
                            const list = e.target.files;
                            if (!list?.length) return;
                            setIncidentPhotoFiles((prev) => {
                              const next = [...prev, ...Array.from(list)].slice(0, 5);
                              return next;
                            });
                            e.target.value = '';
                          }}
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-rose-200 text-rose-900"
                            onClick={() => incidentPhotosInputRef.current?.click()}
                          >
                            <Camera className="h-4 w-4" aria-hidden />
                            Добавить фото
                          </Button>
                          {incidentPhotoFiles.length > 0 ? (
                            <span className="text-xs text-rose-800">
                              Выбрано: {incidentPhotoFiles.length}
                            </span>
                          ) : null}
                        </div>
                        {incidentPhotoFiles.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-xs text-rose-900">
                            {incidentPhotoFiles.map((f, i) => (
                              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                                <span className="truncate">{f.name}</span>
                                <button
                                  type="button"
                                  className="shrink-0 text-rose-700 underline"
                                  onClick={() =>
                                    setIncidentPhotoFiles((prev) => prev.filter((_, j) => j !== i))
                                  }
                                >
                                  Убрать
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      {highRisk ? (
                        <p className="mt-3 text-xs font-medium text-rose-800">
                          Высокий риск — по возможности приложите фото.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <details className="mt-3 text-xs text-slate-500">
                  <summary className="cursor-pointer">Транскрипт</summary>
                  <p className="mt-1 whitespace-pre-wrap">{preview.transcript}</p>
                </details>
              </div>

              <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Button
                  type="button"
                  className="h-14 w-full rounded-xl bg-teal-600 text-base font-semibold shadow-lg shadow-teal-900/20 hover:bg-teal-500"
                  disabled={voiceSubmitting}
                  onClick={() => void handleSubmit()}
                >
                  {voiceSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin" aria-hidden />
                      Отправка…
                    </>
                  ) : reviewIncidentPrimary ? (
                    'Отправить инцидент'
                  ) : (
                    'Отправить'
                  )}
                </Button>
              </div>
            </>
          ) : null}
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
  },
);
