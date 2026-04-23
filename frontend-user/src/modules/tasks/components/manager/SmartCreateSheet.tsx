'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { format, addDays, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Drawer as VaulDrawer } from 'vaul';
import { cn } from '@/lib/utils';
import { DrawerOverlay } from '@/components/ui/drawer';
import { ModalNestedPortalProvider } from '@/components/ui/modal-nested-portal';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useMatchMedia } from '@/hooks/use-match-media';
import { useProperties } from '@/hooks/use-properties';
import { useStaffUsers } from '@/hooks/use-staff-users';
import { apiClient } from '@/lib/api/client';
import { useVoiceRecorder, type VoiceAutoStopPayload } from '../../hooks/useVoiceRecorder';
import { parseVoiceTaskAudio } from '../../hooks/useVoiceTaskParse';
import {
  GENERAL_TASK_PROPERTY_GROUP_KEY,
  INCIDENTS_BOARD_GROUP_KEY,
  SHORTAGE_BOARD_GROUP_KEY,
} from '../../utils/groupTasksByProperty';
import type { Task, TaskPriority, TaskType } from '../../types';
import { AssigneePickerField } from '../shared/AssigneePickerField';
import type { Incident, IncidentSuggestedTaskDraft } from '@/modules/incidents/hooks/useIncidents';
import type { Property } from '@/types';

const TASK_TYPES: { type: TaskType; labelKey: string; shortIcon?: LucideIcon }[] = [
  { type: 'checkout_cleaning', labelKey: 'checkout_cleaning', shortIcon: ArrowDownLeft },
  { type: 'mid_stay_cleaning', labelKey: 'mid_stay_cleaning', shortIcon: RefreshCw },
  { type: 'checkin_prep', labelKey: 'checkin_prep', shortIcon: ArrowUpRight },
  { type: 'maintenance', labelKey: 'maintenance' },
  { type: 'other', labelKey: 'other' },
];

const PRIORITIES: TaskPriority[] = ['normal', 'urgent'];

const taskTypeEnum = z.enum([
  'checkout_cleaning',
  'mid_stay_cleaning',
  'checkin_prep',
  'maintenance',
  'other',
]);
const priorityEnum = z.enum(['urgent', 'normal']);

const TASK_TITLE_MAX = 255;

/** Task fields optional at parse time — required only when entityTab === 'task' (see superRefine). */
const smartFormSchema = z
  .object({
    entityTab: z.enum(['task', 'incident']),
    /** One UI field: POST /tasks maps to title (max 255) + notes (full, same source for staff LLM queue). */
    description: z.string().min(1),
    type: taskTypeEnum.optional(),
    assigneeId: z.string().optional(),
    dueDate: z.string().optional(),
    /** Локальное время «выполнить до» (HH:mm); пусто = без срока по часам. */
    dueTime: z.string().optional(),
    priority: priorityEnum.optional(),
    propertyIds: z.array(z.string()),
    incidentType: z.enum(['damage', 'lost_item', 'rule_violation', 'emergency']),
    estimatedCost: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.entityTab !== 'task') return;
    if (!data.type) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['type'], message: 'Required' });
    }
    if (!data.dueDate?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Required' });
    }
    if (!data.priority) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['priority'], message: 'Required' });
    }
  });

type SmartFormValues = z.infer<typeof smartFormSchema>;

/** Idle (closed) → voice (hero) → parsing (same mic hero + localized “parsing…”) → review (form) → incidentCreated */
type FlowPhase = 'voice' | 'parsing' | 'review' | 'incidentCreated';

const pillClass = (active: boolean) =>
  cn(
    'inline-flex shrink-0 items-center justify-center rounded-full border px-2 py-1 text-[10px] font-medium transition-colors md:px-3 md:py-1.5 md:text-[11px]',
    active
      ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
      : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
  );

const dateFieldClass =
  'h-10 w-full min-w-0 rounded-md border border-input bg-input-fill px-2.5 py-1.5 text-sm shadow-sm outline-none transition-colors [color-scheme:dark] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20';

/** Hide the native date icon so a single explicit control opens the picker (we add CalendarDays). */
const dateInputHideNativePickerClass =
  '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0';

const INCIDENT_TYPE_OPTIONS = [
  { value: 'damage' as const, labelKey: 'typeDamage' as const },
  { value: 'lost_item' as const, labelKey: 'typeLostItem' as const },
  { value: 'rule_violation' as const, labelKey: 'typeRuleViolation' as const },
  { value: 'emergency' as const, labelKey: 'typeEmergency' as const },
];

const INCIDENT_TYPE_VALUES = ['damage', 'lost_item', 'rule_violation', 'emergency'] as const;

function coerceIncidentType(
  v: unknown,
): (typeof INCIDENT_TYPE_VALUES)[number] {
  return typeof v === 'string' && (INCIDENT_TYPE_VALUES as readonly string[]).includes(v)
    ? (v as (typeof INCIDENT_TYPE_VALUES)[number])
    : 'damage';
}

type SmartCreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyId: string;
  /** Skip voice capture; open review form with notes/title (e.g. from incident drawer). */
  incidentPrefill?: {
    notes: string;
    title?: string;
    incidentUuid?: string;
    suggestedTaskDraft?: IncidentSuggestedTaskDraft | null;
  } | null;
  /** Open directly to the form (no mic) — e.g. pencil FAB on mobile. */
  startWithManualForm?: boolean;
  /** When `startWithManualForm` is true: which flow to open (set from pencil menu). */
  manualEntityTab?: 'task' | 'incident';
  /** Календарь → «Задача»: объект и срок по выезду, `reservationId` в POST /tasks. */
  bookingLink?: {
    reservationUuid: string;
    propertyId: string;
    checkOut?: string;
  } | null;
};

/** Call `startRecordingFromUserGesture` synchronously from the same pointer/click handler that opens the sheet (not from `useEffect`). iOS Safari requires this for `getUserMedia`. */
export type SmartCreateSheetHandle = {
  startRecordingFromUserGesture: () => void;
};

const VOICE_INFOGRAPHIC_ACCENT =
  'border-primary/50 text-primary shadow-sm dark:border-primary/45 dark:bg-card/80 dark:text-primary';

/** Same pulsing mic rings as during recording — label is e.g. «Слушаю…» or «Распознаю…». */
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

function VoiceRecordingInfographic({ className }: { className?: string }) {
  const t = useTranslations('tasks.voiceCreate');
  const steps = useMemo(
    () =>
      [
        { n: 1, title: t('voiceInfographicStep1Title'), hint: t('voiceInfographicStep1Hint') },
        { n: 2, title: t('voiceInfographicStep2Title'), hint: t('voiceInfographicStep2Hint') },
        {
          n: 3,
          title: t('voiceInfographicStep3Title'),
          subtitle: t('voiceInfographicStep3Subtitle'),
          hint: t('voiceInfographicStep3Hint'),
        },
        { n: 4, title: t('voiceInfographicStep4Title'), hint: t('voiceInfographicStep4Hint') },
        { n: 5, title: t('voiceInfographicStep5Title'), hint: t('voiceInfographicStep5Hint') },
      ],
    [t],
  );

  return (
    <div className={cn('w-full', className)}>
      <ol className="space-y-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const hint = step.hint.trim();
          const subtitle = ('subtitle' in step && step.subtitle ? step.subtitle : '').trim();
          return (
            <li key={step.n} className="flex gap-2">
              <div className="flex w-7 shrink-0 flex-col items-center self-stretch">
                <div
                  className={cn(
                    'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 bg-background text-[10px] font-bold leading-none',
                    VOICE_INFOGRAPHIC_ACCENT,
                  )}
                  aria-hidden
                >
                  {step.n}
                </div>
                {!isLast ? (
                  <div className="flex min-h-[4px] flex-1 justify-center pt-0.5" aria-hidden>
                    <div className="w-px flex-1 bg-gradient-to-b from-primary/45 to-primary/15 dark:from-primary/35 dark:to-primary/10" />
                  </div>
                ) : null}
              </div>
              <div className={cn('min-w-0 flex-1 space-y-0', !isLast ? 'pb-1.5' : '')}>
                <p className="text-[12px] font-semibold leading-tight text-foreground">{step.title}</p>
                {subtitle ? (
                  <p className="text-[10px] leading-snug text-muted-foreground/90">{subtitle}</p>
                ) : null}
                {hint ? (
                  <p className="text-[10px] leading-snug text-muted-foreground/85">{hint}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 border-t border-border/50 pt-2">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('voiceInfographicFooterTitle')}
        </p>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground/90">{t('voiceInfographicFooterP1')}</p>
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground/90">{t('voiceInfographicFooterP2')}</p>
      </div>
    </div>
  );
}

function mergeVoiceDescription(title: string, transcript: string): string {
  const a = title.trim();
  const b = transcript.trim();
  if (a && b) return `${a}\n\n${b}`;
  return a || b;
}

const defaultForm = (): SmartFormValues => ({
  entityTab: 'task',
  description: '',
  type: 'checkout_cleaning',
  assigneeId: '',
  dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
  dueTime: '',
  priority: 'normal',
  propertyIds: [],
  incidentType: 'damage',
  estimatedCost: '',
});

export const SmartCreateSheet = forwardRef<SmartCreateSheetHandle, SmartCreateSheetProps>(function SmartCreateSheet(
  {
    open,
    onOpenChange,
    propertyId,
    incidentPrefill,
    startWithManualForm = false,
    manualEntityTab = 'task',
    bookingLink = null,
  },
  ref,
) {
  const t = useTranslations('tasks.voiceCreate');
  const tType = useTranslations('tasks.type');
  const tPriority = useTranslations('tasks.priority');
  /** Use `tTasks('smartCreate.*')` — `useTranslations('tasks.smartCreate')` can fail to resolve at runtime (MISSING_MESSAGE). */
  const tTasks = useTranslations('tasks');
  const locale = useLocale();
  const isDesktop = useMatchMedia('(min-width: 768px)');
  const queryClient = useQueryClient();
  const { staff, isLoading: staffLoading } = useStaffUsers();
  const { properties } = useProperties();

  const [dispatchPrefill, setDispatchPrefill] = useState<null | {
    uuid: string;
    propertyId: string;
    description: string;
  }>(null);
  const [incidentSuccess, setIncidentSuccess] = useState<null | {
    uuid: string;
    propertyId: string;
    description: string;
    estimatedCost: string | null;
  }>(null);

  const effectivePropertyId = dispatchPrefill?.propertyId ?? propertyId;
  const contextPropertyId = useMemo(() => {
    if (
      effectivePropertyId === GENERAL_TASK_PROPERTY_GROUP_KEY ||
      effectivePropertyId === INCIDENTS_BOARD_GROUP_KEY ||
      effectivePropertyId === SHORTAGE_BOARD_GROUP_KEY
    ) {
      return null;
    }
    return effectivePropertyId;
  }, [effectivePropertyId]);

  const form = useForm<SmartFormValues>({
    resolver: zodResolver(smartFormSchema),
    defaultValues: defaultForm(),
  });

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = form;

  const propertyIdsWatch = watch('propertyIds');
  const entityTab = watch('entityTab');
  const incidentLinkUuid = dispatchPrefill?.uuid ?? incidentPrefill?.incidentUuid;
  const isIncidentDispatch = Boolean(incidentLinkUuid);
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [propertySearchQuery, setPropertySearchQuery] = useState('');
  /** Staged ids in the add-property modal (applied on confirm). */
  const [propertyPickerSelection, setPropertyPickerSelection] = useState<string[]>([]);

  useEffect(() => {
    if (propertyPickerOpen) setPropertyPickerSelection([]);
  }, [propertyPickerOpen]);

  const togglePropertyPickerId = useCallback((id: string, checked: boolean) => {
    setPropertyPickerSelection((prev) =>
      checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id),
    );
  }, []);

  const applyPropertyPickerSelection = useCallback(() => {
    if (propertyPickerSelection.length === 0) return;
    setValue(
      'propertyIds',
      [...new Set([...propertyIdsWatch, ...propertyPickerSelection])],
      { shouldDirty: true, shouldValidate: true },
    );
    setPropertyPickerOpen(false);
    setPropertySearchQuery('');
  }, [propertyPickerSelection, propertyIdsWatch, setValue]);

  const propertiesAvailableToAdd = useMemo(() => {
    const q = propertySearchQuery.trim().toLowerCase();
    return properties.filter((p: Property) => {
      if (propertyIdsWatch.includes(p.id)) return false;
      if (!q) return true;
      const name = (p.name || '').toLowerCase();
      const addr = [p.city, p.address].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || addr.includes(q);
    });
  }, [properties, propertyIdsWatch, propertySearchQuery]);

  const canAddAnotherProperty = properties.some((p: Property) => !propertyIdsWatch.includes(p.id));

  const resolveGeneralPropertyId = useCallback((): string | null => {
    if (contextPropertyId && properties.some((p: Property) => p.id === contextPropertyId)) {
      return contextPropertyId;
    }
    return properties[0]?.id ?? null;
  }, [contextPropertyId, properties]);

  const [phase, setPhase] = useState<FlowPhase>('voice');

  const processVoiceBlob = useCallback(
    async (blob: Blob | null) => {
      if (!blob || blob.size === 0) {
        toast.error(t('parseEmptyAudio'));
        setPhase('voice');
        return;
      }
      setPhase('parsing');
      try {
        const data = await parseVoiceTaskAudio(blob, contextPropertyId, locale);
        if (data.entityType === 'incident') {
          const pid =
            data.propertyId && properties.some((p: Property) => p.id === data.propertyId)
              ? data.propertyId
              : contextPropertyId && properties.some((p: Property) => p.id === contextPropertyId)
                ? contextPropertyId
                : properties.length === 1
                  ? properties[0]!.id
                  : null;
          reset({
            ...defaultForm(),
            entityTab: 'incident',
            description: mergeVoiceDescription(data.title ?? '', data.transcript),
            incidentType: coerceIncidentType(data.incidentType),
            estimatedCost: data.estimatedCost != null ? String(data.estimatedCost) : '',
            propertyIds: pid ? [pid] : [],
          });
        } else {
          const filteredIds = (data.propertyIds ?? []).filter((id) =>
            properties.some((p: Property) => p.id === id),
          );
          reset({
            ...defaultForm(),
            entityTab: 'task',
            description: mergeVoiceDescription(data.title ?? '', data.transcript),
            type: data.type ?? 'other',
            assigneeId: data.assigneeId ?? '',
            dueDate: data.dueDate ?? format(addDays(new Date(), 1), 'yyyy-MM-dd'),
            priority: data.priority ?? 'normal',
            propertyIds: data.isGeneralTask ? [] : filteredIds.length > 0 ? filteredIds : contextPropertyId ? [contextPropertyId] : [],
          });
        }
        setPhase('review');
      } catch {
        toast.error(t('parseError'));
        setPhase('voice');
      }
    },
    [contextPropertyId, locale, properties, reset, t],
  );

  const onVoiceAutoStop = useCallback(
    (payload: VoiceAutoStopPayload) => {
      toast.info(
        t(payload.reason === 'max_duration' ? 'recordingStoppedMaxDuration' : 'recordingStoppedSilence'),
      );
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
      reset({
        ...defaultForm(),
        propertyIds: contextPropertyId ? [contextPropertyId] : [],
      });
      setPhase('voice');
      setIncidentSuccess(null);
      setDispatchPrefill(null);
      resetRecording();
    } else if (incidentPrefill?.notes?.trim() || incidentPrefill?.incidentUuid) {
      const base = (incidentPrefill.title ?? incidentPrefill.notes ?? '').trim();
      const d = incidentPrefill.suggestedTaskDraft;
      const defaultDispatchTitle = base
        ? `${base.slice(0, 160)} ${tTasks('smartCreate.taskFromIncidentTitleSuffix')}`.trim()
        : `${tTasks('smartCreate.sheetTitleDispatchFromIncident')} ${tTasks('smartCreate.taskFromIncidentTitleSuffix')}`.trim();
      const titleFromDraft = d?.title?.trim();
      const taskTitle = titleFromDraft
        ? titleFromDraft.slice(0, 200)
        : isIncidentDispatch
          ? defaultDispatchTitle
          : base.slice(0, 200);
      const notesPart = (d?.notes?.trim() || incidentPrefill.notes?.trim() || '').trim();
      const taskDescription = [taskTitle, notesPart && notesPart !== taskTitle ? notesPart : '']
        .filter(Boolean)
        .join('\n\n')
        .trim();
      const draftType = d?.type;
      const resolvedType =
        draftType && TASK_TYPES.some((x) => x.type === draftType) ? draftType : 'maintenance';
      const resolvedPriority =
        d?.priority && PRIORITIES.includes(d.priority)
          ? d.priority
          : isIncidentDispatch
            ? 'urgent'
            : 'normal';
      reset({
        ...defaultForm(),
        entityTab: 'task',
        description: taskDescription,
        propertyIds: contextPropertyId ? [contextPropertyId] : [],
        type: resolvedType,
        assigneeId: d?.assigneeId?.trim() ? d.assigneeId.trim() : '',
        dueDate: d?.dueDate?.trim() || format(addDays(new Date(), 1), 'yyyy-MM-dd'),
        priority: resolvedPriority,
      });
      setPhase('review');
      resetRecording();
    } else if (dispatchPrefill?.uuid) {
      /* Задача по инциденту: форма уже заполнена в onAssignTechnicianAfterIncident — не сбрасывать в голос. */
      return;
    } else if (bookingLink?.reservationUuid?.trim() && bookingLink.propertyId?.trim()) {
      const due =
        bookingLink.checkOut?.trim() &&
        !Number.isNaN(Date.parse(bookingLink.checkOut))
          ? format(parseISO(bookingLink.checkOut), 'yyyy-MM-dd')
          : format(addDays(new Date(), 1), 'yyyy-MM-dd');
      reset({
        ...defaultForm(),
        entityTab: 'task',
        propertyIds: [bookingLink.propertyId],
        type: 'checkout_cleaning',
        description: tType('checkout_cleaning'),
        dueDate: due,
      });
      setPhase('review');
      resetRecording();
    } else if (startWithManualForm) {
      reset({
        ...defaultForm(),
        entityTab: manualEntityTab,
        /** Ручной ввод с FAB: без предвыбранного объекта — пользователь жмёт «+» или «Общая задача». */
        propertyIds: [],
      });
      setPhase('review');
      resetRecording();
    } else {
      reset({
        ...defaultForm(),
        propertyIds: contextPropertyId ? [contextPropertyId] : [],
      });
      setPhase('voice');
      /* Mic start: parent must call ref.startRecordingFromUserGesture() in the same click/tap that opens the sheet. */
    }
  }, [
    open,
    incidentPrefill?.notes,
    incidentPrefill?.title,
    incidentPrefill?.incidentUuid,
    incidentPrefill?.suggestedTaskDraft,
    isIncidentDispatch,
    dispatchPrefill?.uuid,
    startWithManualForm,
    manualEntityTab,
    reset,
    resetRecording,
    contextPropertyId,
    tTasks,
    bookingLink?.reservationUuid,
    bookingLink?.propertyId,
    bookingLink?.checkOut,
    tType,
  ]);

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
    reset({
      ...defaultForm(),
      entityTab: manualEntityTab,
      propertyIds: contextPropertyId ? [contextPropertyId] : [],
    });
    setPhase('review');
  }, [reset, resetRecording, contextPropertyId, manualEntityTab]);

  const { mutate: createTaskMutate, isPending: isPendingTask } = useMutation({
    mutationFn: async (values: SmartFormValues) => {
      const propertyIds = [...new Set(values.propertyIds)];
      if (propertyIds.length === 0 && !resolveGeneralPropertyId()) {
        throw new Error('NO_PROPERTY');
      }
      const text = values.description.trim();
      const res = await apiClient.post<{ data: { tasks: Task[] } }>('/tasks', {
        propertyIds,
        title: text.slice(0, TASK_TITLE_MAX),
        type: values.type!,
        priority: values.priority!,
        assigneeId: values.assigneeId?.trim() ? values.assigneeId : null,
        dueDate: values.dueDate!,
        dueTime: values.dueTime?.trim() ? values.dueTime.trim().slice(0, 8) : null,
        reservationId: bookingLink?.reservationUuid?.trim() || null,
        notes: text,
        ...(incidentLinkUuid ? { incidentId: incidentLinkUuid } : {}),
      });
      return res.data.data.tasks;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      if (incidentLinkUuid) {
        await queryClient.invalidateQueries({ queryKey: ['incidents'] });
        await queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
      }
      toast.success(t('successToast'));
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message === 'NO_PROPERTY') {
        toast.error(t('noPropertiesInAccount'));
        return;
      }
      toast.error(t('errorToast'));
    },
  });

  const { mutate: createIncidentMutate, isPending: isPendingIncident } = useMutation({
    mutationFn: async (values: SmartFormValues) => {
      let ids = [...new Set(values.propertyIds)];
      if (ids.length === 0) {
        const fb = resolveGeneralPropertyId();
        if (fb) ids = [fb];
      }
      if (ids.length === 0) throw new Error('NO_PROPERTY_INCIDENT');
      const description = values.description.trim();
      const costRaw = values.estimatedCost.trim().replace(',', '.');
      const estimatedCost = costRaw && !Number.isNaN(Number(costRaw)) ? costRaw : null;
      const incidents: Incident[] = [];
      for (const pid of ids) {
        const res = await apiClient.post<{ data: { incident: Incident } }>('/incidents/manager', {
          type: values.incidentType,
          propertyId: pid,
          description,
          estimatedCost,
          photoUrls: [],
        });
        incidents.push(res.data.data.incident);
      }
      return { created: ids.length, incidents };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['incidents'] });
      await queryClient.invalidateQueries({ queryKey: ['incidents-open-count'] });
      if (data.created === 1 && data.incidents[0]) {
        const inc = data.incidents[0]!;
        setIncidentSuccess({
          uuid: inc.uuid,
          propertyId: inc.propertyId,
          description: inc.description,
          estimatedCost: inc.estimatedCost,
        });
        setPhase('incidentCreated');
        return;
      }
      toast.success(
        data.created > 1
          ? tTasks('smartCreate.incidentSuccessToastBulk', { count: data.created })
          : tTasks('smartCreate.incidentSuccessToast'),
      );
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message === 'NO_PROPERTY_INCIDENT') {
        toast.error(tTasks('smartCreate.incidentNeedsProperty'));
        return;
      }
      toast.error(tTasks('smartCreate.incidentErrorToast'));
    },
  });

  const isPending = isPendingTask || isPendingIncident;

  const submitSmart = useCallback(
    (values: SmartFormValues) => {
      if (values.entityTab === 'incident') {
        const hasProps =
          values.propertyIds.length > 0 || Boolean(resolveGeneralPropertyId());
        if (!hasProps) {
          toast.error(tTasks('smartCreate.incidentNeedsProperty'));
          return;
        }
        createIncidentMutate(values);
        return;
      }
      if (values.propertyIds.length === 0 && !resolveGeneralPropertyId()) {
        toast.error(t('noPropertiesInAccount'));
        return;
      }
      if (incidentLinkUuid && [...new Set(values.propertyIds)].length !== 1) {
        toast.error(tTasks('smartCreate.dispatchIncidentSingleProperty'));
        return;
      }
      createTaskMutate(values);
    },
    [createIncidentMutate, createTaskMutate, incidentLinkUuid, resolveGeneralPropertyId, t, tTasks],
  );

  const descRegister = register('description');
  const { ref: dueDateRhfRef, ...dueDateFieldRest } = register('dueDate');
  const { ref: dueTimeRhfRef, ...dueTimeFieldRest } = register('dueTime');
  const dueDateInputRef = useRef<HTMLInputElement | null>(null);
  const openDueDatePicker = useCallback(() => {
    const el = dueDateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      void el.showPicker();
    } else {
      el.focus();
      el.click();
    }
  }, []);

  const descriptionValue = watch('description');
  const dueDateValue = watch('dueDate');
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const showForm = phase === 'review';

  const onAssignTechnicianAfterIncident = useCallback(() => {
    if (!incidentSuccess) return;
    resetRecording();
    setDispatchPrefill({
      uuid: incidentSuccess.uuid,
      propertyId: incidentSuccess.propertyId,
      description: incidentSuccess.description,
    });
    setIncidentSuccess(null);
    setPhase('review');
    const desc = incidentSuccess.description.trim();
    reset({
      ...defaultForm(),
      entityTab: 'task',
      type: 'maintenance',
      description: desc,
      propertyIds: [incidentSuccess.propertyId],
      assigneeId: '',
      dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      priority: 'urgent',
    });
  }, [incidentSuccess, reset, resetRecording, tTasks]);

  const onDismissIncidentSuccess = useCallback(() => {
    setIncidentSuccess(null);
    onOpenChange(false);
  }, [onOpenChange]);
  const isReview = phase === 'review';
  /** Voice hero: requesting mic or recording — show listening UI immediately after FAB open. */
  const isRecordingFocus =
    phase === 'voice' &&
    (recordingStatus === 'requesting' || isRecording) &&
    recordingStatus !== 'unsupported';

  const onMicInReview = () => {
    resetRecording();
    reset({
      ...defaultForm(),
      propertyIds: contextPropertyId ? [contextPropertyId] : [],
    });
    setPhase('voice');
  };

  return (
    <>
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} direction={isDesktop ? 'right' : 'bottom'} modal>
      <VaulDrawer.Portal>
        <DrawerOverlay />
        <VaulDrawer.Content
          aria-describedby={undefined}
          className={cn(
            'tasks-theme fixed z-[100] flex flex-col border bg-background shadow-lg outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            // Solid shell: avoid translucent bg-* /50 classes so the list does not show through.
            isDesktop
              ? 'inset-y-0 right-0 top-0 bottom-0 left-auto h-dvh max-h-dvh w-[min(26rem,calc(100svw-0.5rem))] rounded-none rounded-l-xl border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
              : 'inset-x-0 bottom-0 max-h-[min(92dvh,92vh)] rounded-t-xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          )}
        >
          <ModalNestedPortalProvider>
          {phase === 'voice' || phase === 'parsing' ? (
            <>
              {!isDesktop ? (
                <VaulDrawer.Handle className="relative z-20 mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted" />
              ) : null}
              <VaulDrawer.Title className="sr-only">
                {phase === 'parsing' ? t('parsing') : t('voiceSheetTitle')}
              </VaulDrawer.Title>
              <div className="relative z-20 flex shrink-0 justify-end border-b border-border/30 bg-background px-3 pb-2 pt-2 sm:px-4">
                <VaulDrawer.Close asChild>
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t('closeAria')}>
                    <X className="h-4 w-4" />
                  </Button>
                </VaulDrawer.Close>
              </div>
            </>
          ) : (
            <>
              {!isDesktop ? (
                <VaulDrawer.Handle className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted" />
              ) : null}
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-5 pb-3 pt-3 sm:px-6">
                <div className="min-w-0 flex-1">
                  <VaulDrawer.Title className="text-lg font-semibold leading-tight text-foreground">
                    {phase === 'incidentCreated'
                      ? tTasks('smartCreate.incidentCreatedTitle')
                      : isIncidentDispatch
                        ? tTasks('smartCreate.sheetTitleDispatchFromIncident')
                        : entityTab === 'incident'
                          ? tTasks('smartCreate.sheetTitleIncident')
                          : t('sheetTitle')}
                  </VaulDrawer.Title>
                </div>
                <VaulDrawer.Close asChild>
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t('closeAria')}>
                    <X className="h-4 w-4" />
                  </Button>
                </VaulDrawer.Close>
              </div>
            </>
          )}

          {phase === 'voice' || phase === 'parsing' ? (
            <>
              {phase === 'voice' ? (
                <>
              <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                <div
                  className={cn(
                    'flex min-h-0 flex-1 flex-col items-center justify-start gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-7 sm:gap-2.5 sm:px-6 sm:pb-4 sm:pt-8',
                  )}
                >
                  {typeof window !== 'undefined' && !window.isSecureContext && window.location.hostname !== 'localhost' ? (
                    <p className="max-w-md text-center text-sm text-amber-600 dark:text-amber-400">{t('micHttps')}</p>
                  ) : null}

                  {recordingStatus === 'unsupported' ? (
                    <p className="max-w-md text-center text-sm text-muted-foreground">{t('micUnsupported')}</p>
                  ) : isRecordingFocus ? (
                    <>
                      <VoiceMicActiveHero label={t('listeningPlaceholder')} />
                      <div className="w-full max-w-md shrink-0 px-0.5">
                        <VoiceRecordingInfographic />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="relative z-[15] flex h-44 w-44 shrink-0 items-center justify-center">
                        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-muted/40 ring-2 ring-border">
                          <Mic className="h-12 w-12 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                        </div>
                      </div>

                      <div className="w-full max-w-md shrink-0 px-0.5">
                        <VoiceRecordingInfographic />
                      </div>

                      {recordingStatus === 'denied' ? (
                        <p className="max-w-md text-center text-sm text-muted-foreground">{t('micDenied')}</p>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              <div className="shrink-0 space-y-3 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
                {recordingStatus === 'unsupported' ? null : (
                  <Button
                    type="button"
                    className={cn(
                      'w-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90 disabled:opacity-60',
                      isRecordingFocus ? 'h-14 text-base font-semibold' : 'h-12',
                    )}
                    disabled={recordingStatus === 'requesting'}
                    onClick={() => {
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
                </>
              ) : (
                <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 pb-8 pt-7 sm:px-6 sm:pt-8">
                    <VoiceMicActiveHero label={t('parsing')} />
                  </div>
                  <div className="shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-hidden />
                </div>
              )}
            </>
          ) : null}

          {phase === 'incidentCreated' && incidentSuccess ? (
            <div className="flex min-h-0 flex-1 flex-col justify-center px-5 py-8 sm:px-6">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
              {incidentSuccess.estimatedCost ? (
                <p className="mt-2 text-center text-sm text-muted-foreground">
                  {tTasks('smartCreate.incidentCreatedCostLine', {
                    amount: Number(incidentSuccess.estimatedCost).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-US'),
                  })}
                </p>
              ) : null}
              <p
                className={cn(
                  'text-center text-sm leading-relaxed text-muted-foreground',
                  incidentSuccess.estimatedCost ? 'mt-5' : 'mt-6',
                )}
              >
                {tTasks('smartCreate.incidentCreatedNextPrompt')}
              </p>
              <div className="mt-8 flex w-full flex-col gap-2">
                <Button
                  type="button"
                  className="h-12 w-full bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                  onClick={onAssignTechnicianAfterIncident}
                >
                  {tTasks('smartCreate.assignTask')}
                </Button>
                <Button type="button" variant="secondary" className="h-11 w-full" onClick={onDismissIncidentSuccess}>
                  {tTasks('smartCreate.closeAfterIncident')}
                </Button>
              </div>
            </div>
          ) : null}

          {showForm ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={handleSubmit(submitSmart, (errors) => {
                const first = Object.values(errors)[0] as { message?: unknown } | undefined;
                const msg = first?.message != null ? String(first.message) : null;
                if (msg) toast.error(msg);
              })}
            >
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-4 pt-4 sm:px-6">
                <div className="relative z-[2] space-y-4">
                  {isIncidentDispatch ? (
                    <p className="text-xs text-muted-foreground">{tTasks('smartCreate.dispatchFromIncidentHint')}</p>
                  ) : null}

                  <div className="space-y-1.5">
                    <Label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('apartmentsLabel')}
                    </Label>
                    <Controller
                      name="propertyIds"
                      control={control}
                      render={({ field }) => {
                        const selectedOnly = properties.filter((p: Property) => field.value.includes(p.id));
                        return (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {entityTab === 'task' ? (
                              <button
                                type="button"
                                onClick={() => field.onChange([])}
                                className={cn(
                                  'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors md:text-xs',
                                  'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
                                )}
                              >
                                {t('generalTaskChip')}
                              </button>
                            ) : null}
                            {selectedOnly.map((p: Property) => {
                              const active = field.value.includes(p.id);
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    if (active) {
                                      field.onChange(field.value.filter((id: string) => id !== p.id));
                                    } else {
                                      field.onChange([...field.value, p.id]);
                                    }
                                  }}
                                  title={p.address ? `${p.name} — ${p.address}` : p.name}
                                  className={cn(
                                    'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors md:text-xs',
                                    active
                                      ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
                                      : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
                                  )}
                                >
                                  <span className="truncate">{p.name}</span>
                                </button>
                              );
                            })}
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              disabled={
                                !canAddAnotherProperty ||
                                properties.length === 0 ||
                                isIncidentDispatch
                              }
                              className="h-7 w-7 shrink-0 rounded-full border-dashed border-primary/35 text-primary hover:bg-primary/10"
                              aria-label={t('addPropertyAria')}
                              onClick={() => {
                                setPropertySearchQuery('');
                                setPropertyPickerOpen(true);
                              }}
                            >
                              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                            </Button>
                          </div>
                        );
                      }}
                    />
                  </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="voice-task-description"
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('descriptionLabel')}
                  </Label>
                  <div className="relative">
                    <Textarea
                      id="voice-task-description"
                      rows={4}
                      autoComplete="off"
                      placeholder={
                        entityTab === 'incident'
                          ? t('descriptionPlaceholderIncident')
                          : t('descriptionPlaceholder')
                      }
                      className="min-h-[5.5rem] resize-y pr-12 text-sm"
                      aria-invalid={!!errors.description}
                      {...descRegister}
                    />
                    {isReview ? (
                      <button
                        type="button"
                        onClick={onMicInReview}
                        className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70"
                        aria-label={t('startRecordingAria')}
                      >
                        <Mic className="h-[18px] w-[18px]" strokeWidth={2.25} />
                      </button>
                    ) : null}
                  </div>
                  {errors.description ? (
                    <p className="mt-1 text-xs text-destructive">{errors.description.message}</p>
                  ) : null}
                </div>

                {entityTab === 'task' ? (
                  <>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('typeLabel')}
                  </Label>
                  <Controller
                    name="type"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-1">
                        {TASK_TYPES.map(({ type, labelKey, shortIcon: ShortIcon }) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => field.onChange(type)}
                            className={pillClass(field.value === type)}
                          >
                            <span className="inline-flex max-w-[9rem] items-center gap-1 truncate sm:max-w-none">
                              {ShortIcon ? (
                                <ShortIcon className="h-3 w-3 shrink-0 stroke-[2.25] text-muted-foreground" aria-hidden />
                              ) : null}
                              <span className="truncate">{tType(labelKey)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('assigneeLabel')}
                  </Label>
                  <Controller
                    name="assigneeId"
                    control={control}
                    render={({ field }) => (
                      <AssigneePickerField
                        variant="full"
                        staff={staff}
                        value={field.value}
                        onChange={(id) => field.onChange(id ?? '')}
                        loading={staffLoading}
                        disabled={isPending}
                      />
                    )}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="voice-due"
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('dueLabel')}
                  </Label>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                    <div className="flex min-w-0 flex-nowrap items-center gap-2">
                      <div className="relative flex min-w-0 shrink-0">
                        <Input
                          id="voice-due"
                          type="date"
                          className={cn(
                            dateFieldClass,
                            'relative z-[1] w-[10.5rem] min-w-[10.5rem] border-0 bg-background pl-2.5 pr-10 text-sm shadow-none',
                            'focus-visible:ring-offset-0',
                            dateInputHideNativePickerClass,
                          )}
                          ref={(e) => {
                            dueDateRhfRef(e);
                            dueDateInputRef.current = e;
                          }}
                          {...dueDateFieldRest}
                        />
                        <button
                          type="button"
                          onClick={openDueDatePicker}
                          className="absolute right-0.5 top-1/2 z-[2] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                          aria-label={t('dueDatePickerAria')}
                        >
                          <CalendarDays className="h-4 w-4" strokeWidth={2} aria-hidden />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setValue('dueDate', todayStr, { shouldDirty: true, shouldValidate: true })
                        }
                        className={pillClass(dueDateValue === todayStr)}
                      >
                        {t('dueToday')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setValue('dueDate', tomorrowStr, { shouldDirty: true, shouldValidate: true })
                        }
                        className={pillClass(dueDateValue === tomorrowStr)}
                      >
                        {t('dueTomorrow')}
                      </button>
                    </div>
                    <div className="flex min-w-[8.5rem] flex-col gap-1 sm:shrink-0">
                      <Label
                        htmlFor="voice-due-time"
                        className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {t('completeByTimeLabel')}
                      </Label>
                      <Input
                        id="voice-due-time"
                        type="time"
                        className={cn(dateFieldClass, 'w-full min-w-0 sm:max-w-[9rem]')}
                        ref={dueTimeRhfRef}
                        {...dueTimeFieldRest}
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('priorityLabel')}
                  </span>
                  <Controller
                    name="priority"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-1">
                        {PRIORITIES.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => field.onChange(p)}
                            className={pillClass(field.value === p)}
                          >
                            {tPriority(p)}
                          </button>
                        ))}
                      </div>
                    )}
                  />
                </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {tTasks('smartCreate.incidentTypeLabel')}
                      </Label>
                      <Controller
                        name="incidentType"
                        control={control}
                        render={({ field }) => (
                          <div className="flex flex-wrap gap-1">
                            {INCIDENT_TYPE_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => field.onChange(opt.value)}
                                className={pillClass(field.value === opt.value)}
                              >
                                {tTasks(`smartCreate.${opt.labelKey}`)}
                              </button>
                            ))}
                          </div>
                        )}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="voice-incident-cost"
                        className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {tTasks('smartCreate.estimatedCostLabel')}
                      </Label>
                      <Input
                        id="voice-incident-cost"
                        type="text"
                        inputMode="decimal"
                        placeholder={tTasks('smartCreate.estimatedCostPlaceholder')}
                        className="h-10"
                        {...register('estimatedCost')}
                      />
                    </div>
                  </>
                )}
                </div>
              </div>

              <div className="shrink-0 border-t border-border bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
                <Button
                  type="submit"
                  className="h-12 w-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90"
                  disabled={isPending || !descriptionValue?.trim()}
                >
                  {isPending ? t('submitting') : tTasks('smartCreate.create')}
                </Button>
              </div>
            </form>
          ) : null}
          </ModalNestedPortalProvider>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>

    <ResponsiveModal
      open={propertyPickerOpen}
      onOpenChange={(o) => {
        setPropertyPickerOpen(o);
        if (!o) setPropertySearchQuery('');
      }}
    >
      <ResponsiveModalContent
        title={t('addPropertySheetTitle')}
        description={t('addPropertySheetHint')}
        className="tasks-theme max-w-md border-primary/15"
        bodyClassName="flex min-h-0 flex-col gap-3 px-5 pb-2 pt-2 sm:px-6"
        footer={
          <Button
            type="button"
            className="h-11 w-full bg-primary text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary/90"
            disabled={propertyPickerSelection.length === 0}
            onClick={() => applyPropertyPickerSelection()}
          >
            {t('addPropertyApply')}
          </Button>
        }
      >
        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={propertySearchQuery}
            onChange={(e) => setPropertySearchQuery(e.target.value)}
            placeholder={t('propertySearchPlaceholder')}
            autoComplete="off"
            autoFocus
            className={cn(
              'h-12 rounded-xl border border-primary/25 bg-muted pl-10 pr-4 text-base shadow-inner shadow-black/5',
              'transition-[box-shadow,border-color] placeholder:text-muted-foreground/80',
              'focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20',
            )}
            aria-label={t('propertySearchPlaceholder')}
          />
        </div>
        <div
          className="min-h-[min(120px,30dvh)] max-h-[min(55dvh,420px)] flex-1 overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-muted"
          role="region"
          aria-label={t('addPropertySheetTitle')}
        >
          <ul className="divide-y divide-border/50 p-1">
            {propertiesAvailableToAdd.length === 0 ? (
              <li className="rounded-lg px-3 py-8 text-center text-sm text-muted-foreground">
                {t('propertySearchNoResults')}
              </li>
            ) : (
              propertiesAvailableToAdd.map((p: Property) => {
                const checked = propertyPickerSelection.includes(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 text-left text-sm transition-colors',
                        'hover:bg-background',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => togglePropertyPickerId(p.id, v === true)}
                        className="mt-0.5"
                        aria-label={p.name}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-foreground">{p.name}</span>
                        {[p.city, p.address].filter((x) => x && x !== '-').length > 0 ? (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                            {[p.city, p.address].filter((x) => x && x !== '-').join(', ')}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
    </>
  );
});

SmartCreateSheet.displayName = 'SmartCreateSheet';
