'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { format, addDays } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowDownLeft,
  ArrowUpRight,
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
} from '../../utils/groupTasksByProperty';
import { formatNameAndLastInitial } from '../../utils/staff-name-short';
import type { StaffMember, Task, TaskPriority, TaskType } from '../../types';
import type { Incident } from '@/modules/incidents/hooks/useIncidents';
import type { Property } from '@/types';

const TASK_TYPES: { type: TaskType; labelKey: string; shortIcon?: LucideIcon }[] = [
  { type: 'checkout_cleaning', labelKey: 'checkout_cleaning', shortIcon: ArrowDownLeft },
  { type: 'mid_stay_cleaning', labelKey: 'mid_stay_cleaning', shortIcon: RefreshCw },
  { type: 'checkin_prep', labelKey: 'checkin_prep', shortIcon: ArrowUpRight },
  { type: 'maintenance', labelKey: 'maintenance' },
  { type: 'other', labelKey: 'other' },
];

const PRIORITIES: TaskPriority[] = ['normal', 'urgent', 'critical'];

const taskTypeEnum = z.enum([
  'checkout_cleaning',
  'mid_stay_cleaning',
  'checkin_prep',
  'maintenance',
  'other',
]);
const priorityEnum = z.enum(['urgent', 'normal', 'critical']);

/** Task fields optional at parse time — required only when entityTab === 'task' (see superRefine). */
const smartFormSchema = z
  .object({
    entityTab: z.enum(['task', 'incident']),
    title: z.string().min(1),
    type: taskTypeEnum.optional(),
    assigneeId: z.string().optional(),
    dueDate: z.string().optional(),
    priority: priorityEnum.optional(),
    propertyIds: z.array(z.string()),
    notes: z.string(),
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
  'h-10 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-sm outline-none transition-colors [color-scheme:dark] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20';

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
  incidentPrefill?: { notes: string; title?: string; incidentUuid?: string } | null;
  /** Open directly to the form (no mic) — e.g. pencil FAB on mobile. */
  startWithManualForm?: boolean;
  /** When `startWithManualForm` is true: which flow to open (set from pencil menu). */
  manualEntityTab?: 'task' | 'incident';
};

/** Call `startRecordingFromUserGesture` synchronously from the same pointer/click handler that opens the sheet (not from `useEffect`). iOS Safari requires this for `getUserMedia`. */
export type SmartCreateSheetHandle = {
  startRecordingFromUserGesture: () => void;
};

const VOICE_INFOGRAPHIC_ACCENT =
  'border-[#008CA4]/55 text-[#008CA4] shadow-sm dark:border-[#008CA4]/45 dark:bg-slate-950/60 dark:text-[#5eead4]';

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
                    <div className="w-px flex-1 bg-gradient-to-b from-[#008CA4]/45 to-[#008CA4]/15 dark:from-[#008CA4]/35 dark:to-[#008CA4]/10" />
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

const defaultForm = (): SmartFormValues => ({
  entityTab: 'task',
  title: '',
  type: 'maintenance',
  assigneeId: '',
  dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
  priority: 'normal',
  propertyIds: [],
  notes: '',
  incidentType: 'damage',
  estimatedCost: '',
});

export const SmartCreateSheet = forwardRef<SmartCreateSheetHandle, SmartCreateSheetProps>(function SmartCreateSheet(
  { open, onOpenChange, propertyId, incidentPrefill, startWithManualForm = false, manualEntityTab = 'task' },
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
      effectivePropertyId === INCIDENTS_BOARD_GROUP_KEY
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
    getValues,
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

  /** Incident: suggest a default property only when none selected (no longer forcing single id). */
  useEffect(() => {
    if (entityTab !== 'incident') return;
    const ids = getValues('propertyIds');
    if (ids.length === 0) {
      const fp = resolveGeneralPropertyId();
      if (fp) setValue('propertyIds', [fp], { shouldDirty: true });
    }
  }, [entityTab, getValues, setValue, resolveGeneralPropertyId]);

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
            title: (data.title ?? '').trim(),
            incidentType: coerceIncidentType(data.incidentType),
            estimatedCost: data.estimatedCost != null ? String(data.estimatedCost) : '',
            propertyIds: pid ? [pid] : [],
            notes: data.transcript.trim(),
          });
        } else {
          const filteredIds = (data.propertyIds ?? []).filter((id) =>
            properties.some((p: Property) => p.id === id),
          );
          reset({
            ...defaultForm(),
            entityTab: 'task',
            title: data.title ?? '',
            type: data.type ?? 'other',
            assigneeId: data.assigneeId ?? '',
            dueDate: data.dueDate ?? format(addDays(new Date(), 1), 'yyyy-MM-dd'),
            priority: data.priority ?? 'normal',
            propertyIds: data.isGeneralTask || filteredIds.length === 0 ? [] : filteredIds,
            notes: data.transcript.trim(),
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
      reset(defaultForm());
      setPhase('voice');
      setIncidentSuccess(null);
      setDispatchPrefill(null);
      resetRecording();
    } else if (incidentPrefill?.notes?.trim() || incidentPrefill?.incidentUuid) {
      const base = (incidentPrefill.title ?? incidentPrefill.notes ?? '').trim();
      reset({
        ...defaultForm(),
        entityTab: 'task',
        title: isIncidentDispatch
          ? (
              base
                ? `${base.slice(0, 160)} ${tTasks('smartCreate.taskFromIncidentTitleSuffix')}`.trim()
                : `${tTasks('smartCreate.sheetTitleDispatchFromIncident')} ${tTasks('smartCreate.taskFromIncidentTitleSuffix')}`.trim()
            )
          : base.slice(0, 200),
        notes: incidentPrefill.notes?.trim() ?? '',
        propertyIds: contextPropertyId ? [contextPropertyId] : [],
        type: 'maintenance',
        priority: isIncidentDispatch ? 'critical' : 'normal',
      });
      setPhase('review');
      resetRecording();
    } else if (dispatchPrefill?.uuid) {
      /* Задача по инциденту: форма уже заполнена в onAssignTechnicianAfterIncident — не сбрасывать в голос. */
      return;
    } else if (startWithManualForm) {
      reset({
        ...defaultForm(),
        entityTab: manualEntityTab,
        propertyIds: contextPropertyId ? [contextPropertyId] : [],
      });
      setPhase('review');
      resetRecording();
    } else {
      reset(defaultForm());
      setPhase('voice');
      /* Mic start: parent must call ref.startRecordingFromUserGesture() in the same click/tap that opens the sheet. */
    }
  }, [
    open,
    incidentPrefill?.notes,
    incidentPrefill?.title,
    incidentPrefill?.incidentUuid,
    isIncidentDispatch,
    dispatchPrefill?.uuid,
    startWithManualForm,
    manualEntityTab,
    reset,
    resetRecording,
    contextPropertyId,
    tTasks,
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
    reset(defaultForm());
    setPhase('review');
  }, [reset, resetRecording]);

  const { mutate: createTaskMutate, isPending: isPendingTask } = useMutation({
    mutationFn: async (values: SmartFormValues) => {
      const propertyIds = [...new Set(values.propertyIds)];
      if (propertyIds.length === 0 && !resolveGeneralPropertyId()) {
        throw new Error('NO_PROPERTY');
      }
      const res = await apiClient.post<{ data: { tasks: Task[] } }>('/tasks', {
        propertyIds,
        title: values.title.trim(),
        type: values.type!,
        priority: values.priority!,
        assigneeId: values.assigneeId?.trim() ? values.assigneeId : null,
        dueDate: values.dueDate!,
        dueTime: null,
        reservationId: null,
        notes: values.notes.trim() || undefined,
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
      const description = [values.title.trim(), values.notes.trim()].filter(Boolean).join('\n\n');
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

  const titleRegister = register('title');
  const titleValue = watch('title');

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
    const base = incidentSuccess.description.trim().slice(0, 160);
    reset({
      ...defaultForm(),
      entityTab: 'task',
      type: 'maintenance',
      title: `${base} ${tTasks('smartCreate.taskFromIncidentTitleSuffix')}`.trim(),
      notes: incidentSuccess.description,
      propertyIds: [incidentSuccess.propertyId],
      assigneeId: '',
      dueDate: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
      priority: 'critical',
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
    reset(defaultForm());
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
            phase === 'review' && entityTab === 'incident' && 'border-t-2 border-red-600 dark:border-red-500',
            isDesktop
              ? 'inset-y-0 right-0 top-0 bottom-0 left-auto h-dvh max-h-dvh w-[min(100vw-0.5rem,26rem)] rounded-none rounded-l-xl border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
              : 'inset-x-0 bottom-0 max-h-[min(92dvh,92vh)] rounded-t-xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          )}
        >
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
                    'flex min-h-0 flex-1 flex-col items-center justify-start gap-2 px-4 pb-3 pt-7 sm:gap-2.5 sm:px-6 sm:pb-4 sm:pt-8',
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
                {!isRecordingFocus ? (
                  <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={handleTypeManually}>
                    {t('typeManually')}
                  </Button>
                ) : null}
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
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('apartmentsLabel')}
                      </Label>
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
                    <Controller
                      name="propertyIds"
                      control={control}
                      render={({ field }) => {
                        const generalSelected = field.value.length === 0;
                        const selectedOnly = properties.filter((p: Property) => field.value.includes(p.id));
                        return (
                          <div className="flex flex-wrap gap-1.5">
                            {entityTab === 'task' ? (
                              <button
                                type="button"
                                onClick={() => field.onChange([])}
                                className={cn(
                                  'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors md:text-xs',
                                  generalSelected
                                    ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
                                    : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
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
                          </div>
                        );
                      }}
                    />
                  </div>

                <div className="relative">
                  <Label htmlFor="voice-task-title" className="sr-only">
                    {t('titleLabel')}
                  </Label>
                  <div className="relative rounded-lg border border-input bg-background shadow-sm transition-[box-shadow]">
                    <Input
                      id="voice-task-title"
                      {...titleRegister}
                      autoComplete="off"
                      placeholder={
                        entityTab === 'incident' ? t('titlePlaceholderIncident') : t('titlePlaceholder')
                      }
                      className={cn(
                        'h-11 w-full min-w-0 border-0 bg-transparent pr-12 pl-3 text-base font-semibold shadow-none',
                        'placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0',
                      )}
                      aria-invalid={!!errors.title}
                    />
                    {isReview ? (
                      <button
                        type="button"
                        onClick={onMicInReview}
                        className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70"
                        aria-label={t('startRecordingAria')}
                      >
                        <Mic className="h-[18px] w-[18px]" strokeWidth={2.25} />
                      </button>
                    ) : null}
                  </div>
                  {errors.title ? (
                    <p className="mt-1 text-xs text-destructive">{errors.title.message}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="voice-task-notes" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('notesLabel')}
                  </Label>
                  <Textarea
                    id="voice-task-notes"
                    rows={4}
                    placeholder={t('notesPlaceholder')}
                    className="min-h-[5.5rem] resize-y text-sm"
                    {...register('notes')}
                  />
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
                      <div className="min-h-[2.5rem]">
                        {staffLoading ? (
                          <p className="text-xs text-muted-foreground">…</p>
                        ) : staff.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('assigneeNoStaff')}</p>
                        ) : (
                          <div className="flex max-w-full flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => field.onChange('')}
                              title={tTasks('unassigned')}
                              className={cn(
                                'flex h-10 min-w-10 max-w-[10rem] shrink-0 items-center justify-center rounded-full border-2 px-1.5 text-[10px] font-semibold leading-tight transition-colors',
                                field.value === ''
                                  ? 'border-primary bg-primary/15 text-foreground shadow-sm ring-2 ring-primary/25'
                                  : 'border-border/70 bg-background text-muted-foreground hover:border-primary/40',
                              )}
                            >
                              —
                            </button>
                            {staff.map((s: StaffMember) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => field.onChange(s.id)}
                                title={s.displayName}
                                className={cn(
                                  'flex h-10 min-w-10 max-w-[10rem] shrink-0 items-center justify-center rounded-full border-2 px-1.5 text-[10px] font-semibold leading-tight transition-colors',
                                  field.value === s.id
                                    ? 'border-primary bg-primary/15 text-foreground shadow-sm ring-2 ring-primary/25'
                                    : 'border-border/70 bg-background text-muted-foreground hover:border-primary/40',
                                )}
                              >
                                <span className="truncate text-center">{formatNameAndLastInitial(s.displayName)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label
                      htmlFor="voice-due"
                      className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t('dueLabel')}
                    </Label>
                    <div className="w-full min-w-0">
                      <Input
                        id="voice-due"
                        type="date"
                        className={cn(dateFieldClass, 'relative z-[1] w-full border-0 bg-background shadow-none')}
                        {...register('dueDate')}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
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
                  disabled={isPending || !titleValue?.trim()}
                >
                  {isPending ? t('submitting') : tTasks('smartCreate.create')}
                </Button>
              </div>
            </form>
          ) : null}
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
