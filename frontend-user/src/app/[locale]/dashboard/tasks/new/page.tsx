'use client';

import { useState, useMemo, useEffect, useCallback, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { format, parseISO, differenceInCalendarDays, addDays } from 'date-fns';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  RefreshCw,
  User,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api/client';
import { useProperties } from '@/hooks/use-properties';
import { useStaffUsers } from '@/hooks/use-staff-users';
import type { Task, TaskType, TaskPriority } from '@/modules/tasks/types';
import type { StaffMember } from '@/modules/tasks/types';
import { formatNameAndLastInitial } from '@/modules/tasks/utils/staff-name-short';

// ─── Task type config ────────────────────────────────────────────────────────

interface TaskTypeConfig {
  type: TaskType;
  labelKey: string;
  defaultTitle: { en: string; ru: string };
  dueDateOffset: 'checkout' | 'checkin' | 'tomorrow';
  defaultTime: string;
}

const TASK_TYPES: TaskTypeConfig[] = [
  {
    type: 'checkout_cleaning',
    labelKey: 'checkout_cleaning',
    defaultTitle: { en: 'Checkout cleaning', ru: 'Уборка после выезда' },
    dueDateOffset: 'checkout',
    defaultTime: '14:00',
  },
  {
    type: 'mid_stay_cleaning',
    labelKey: 'mid_stay_cleaning',
    defaultTitle: { en: 'Mid-stay cleaning', ru: 'Плановая уборка' },
    dueDateOffset: 'tomorrow',
    defaultTime: '11:00',
  },
  {
    type: 'checkin_prep',
    labelKey: 'checkin_prep',
    defaultTitle: { en: 'Check-in preparation', ru: 'Подготовка к заезду' },
    dueDateOffset: 'checkin',
    defaultTime: '12:00',
  },
  {
    type: 'maintenance',
    labelKey: 'maintenance',
    defaultTitle: { en: 'Maintenance', ru: 'Техобслуживание' },
    dueDateOffset: 'tomorrow',
    defaultTime: '10:00',
  },
  {
    type: 'other',
    labelKey: 'other',
    defaultTitle: { en: 'Task', ru: 'Задача' },
    dueDateOffset: 'tomorrow',
    defaultTime: '',
  },
];

const PRIORITY_OPTIONS: { value: TaskPriority; labelKey: string }[] = [
  { value: 'normal', labelKey: 'normal' },
  { value: 'urgent', labelKey: 'urgent' },
  { value: 'critical', labelKey: 'critical' },
];

/** Lucide icons instead of Unicode arrows (avoid emoji-style blue squares on mobile). */
const TASK_TYPE_SHORT_ICONS: Partial<Record<TaskType, LucideIcon>> = {
  checkout_cleaning: ArrowDownLeft,
  mid_stay_cleaning: RefreshCw,
  checkin_prep: ArrowUpRight,
};

type DueChip = 'today' | 'tomorrow' | 'threeDays' | 'none' | 'custom';

// ─── Booking info (fetched for card display) ─────────────────────────────────

interface BookingInfo {
  guestName: string;
  checkIn: string;
  checkOut: string;
  propertyId: string;
}

function useBookingInfo(bookingId: string) {
  return useQuery<BookingInfo>({
    queryKey: ['booking', bookingId],
    queryFn: async () => {
      const res = await apiClient.get<{ data: BookingInfo }>(`/bookings/${bookingId}`);
      return res.data.data;
    },
    enabled: !!bookingId,
    staleTime: 60_000,
  });
}

// ─── Booking card ─────────────────────────────────────────────────────────────

function BookingCard({ booking, onClear }: { booking: BookingInfo; onClear: () => void }) {
  const nights = differenceInCalendarDays(parseISO(booking.checkOut), parseISO(booking.checkIn));
  const fmt = (iso: string) => format(parseISO(iso), 'dd MMM');

  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{booking.guestName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fmt(booking.checkIn)} → {fmt(booking.checkOut)} · {nights} н.
        </p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Убрать привязку к брони"
      >
        ×
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const pillClass = (active: boolean) =>
  cn(
    'inline-flex shrink-0 items-center justify-center rounded-full border px-2 py-1 text-[10px] font-medium transition-colors md:px-3 md:py-1.5 md:text-[11px]',
    active
      ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
      : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
  );

const dateTimeFieldClass =
  'h-10 w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-sm outline-none transition-colors [color-scheme:dark] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20';

/** Framed block + colored left accent (tighter on small screens). */
function KeySection({
  icon: Icon,
  label,
  accentClass,
  children,
}: {
  icon: LucideIcon;
  label: string;
  accentClass: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-muted/35 p-2.5 pl-2.5 shadow-sm dark:border-border/70 dark:bg-muted/20 sm:p-3.5 sm:pl-3.5',
        accentClass,
      )}
    >
      <div className="mb-2 flex items-center gap-1.5 border-b border-border/60 pb-2 dark:border-border/50 sm:mb-2.5 sm:gap-2 sm:pb-2.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground sm:text-xs">{label}</span>
      </div>
      {children}
    </div>
  );
}

export default function NewTaskFromBookingPage() {
  const t = useTranslations('tasks.newFromBooking');
  const tType = useTranslations('tasks.type');
  const tTypeShort = useTranslations('tasks.newFromBooking.typeShort');
  const tPriority = useTranslations('tasks.priority');
  const tTasks = useTranslations('tasks');
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { properties, isLoading: propsLoading } = useProperties();
  const { staff, isLoading: staffLoading } = useStaffUsers();

  const initialBookingId = searchParams.get('bookingId')?.trim() ?? '';
  const propertyId = searchParams.get('propertyId')?.trim() ?? '';

  const [bookingId, setBookingId] = useState(initialBookingId);

  const { data: booking, isLoading: bookingLoading } = useBookingInfo(bookingId);

  const propertyName = useMemo(() => {
    const p = properties.find((x) => x.id === propertyId);
    return p?.name ?? propertyId;
  }, [properties, propertyId]);

  const [selectedType, setSelectedType] = useState<TaskType>('checkout_cleaning');
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [dueDate, setDueDate] = useState(() => format(addDays(new Date(), 3), 'yyyy-MM-dd'));
  const [dueTime, setDueTime] = useState('14:00');
  const [omitDueDate, setOmitDueDate] = useState(false);
  const [dueChip, setDueChip] = useState<DueChip>('threeDays');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [description, setDescription] = useState('');

  useEffect(() => {
    const cfg = TASK_TYPES.find((c) => c.type === selectedType)!;
    if (!omitDueDate && cfg.defaultTime) setDueTime(cfg.defaultTime);

    if (booking) {
      setOmitDueDate(false);
      if (cfg.dueDateOffset === 'checkout') {
        setDueDate(format(parseISO(booking.checkOut), 'yyyy-MM-dd'));
      } else if (cfg.dueDateOffset === 'checkin') {
        setDueDate(format(parseISO(booking.checkIn), 'yyyy-MM-dd'));
      } else {
        setDueDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
      }
      setDueChip('custom');
    }
  }, [selectedType, booking, omitDueDate]);

  const handleTypeSelect = useCallback(
    (type: TaskType) => {
      setSelectedType(type);
      const cfg = TASK_TYPES.find((c) => c.type === type)!;
      setTitle((prev) => (prev.trim() === '' ? cfg.defaultTitle.ru : prev));
      if (!booking) {
        if (cfg.defaultTime) setDueTime(cfg.defaultTime);
        setDueDate(format(addDays(new Date(), 3), 'yyyy-MM-dd'));
        setDueChip('threeDays');
        setOmitDueDate(false);
      }
    },
    [booking],
  );

  const setDueToday = useCallback(() => {
    setOmitDueDate(false);
    setDueChip('today');
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
    const cfg = TASK_TYPES.find((c) => c.type === selectedType)!;
    if (cfg.defaultTime) setDueTime(cfg.defaultTime);
  }, [selectedType]);

  const setDueTomorrow = useCallback(() => {
    setOmitDueDate(false);
    setDueChip('tomorrow');
    setDueDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    const cfg = TASK_TYPES.find((c) => c.type === selectedType)!;
    if (cfg.defaultTime) setDueTime(cfg.defaultTime);
  }, [selectedType]);

  const setDueThreeDays = useCallback(() => {
    setOmitDueDate(false);
    setDueChip('threeDays');
    setDueDate(format(addDays(new Date(), 3), 'yyyy-MM-dd'));
    const cfg = TASK_TYPES.find((c) => c.type === selectedType)!;
    if (cfg.defaultTime) setDueTime(cfg.defaultTime);
  }, [selectedType]);

  const setDueNone = useCallback(() => {
    setOmitDueDate(true);
    setDueChip('none');
    setDueTime('');
  }, []);

  const onDueDateFieldChange = useCallback((value: string) => {
    setDueDate(value);
    setOmitDueDate(false);
    setDueChip('custom');
  }, []);

  const onDueTimeFieldChange = useCallback(
    (value: string) => {
      setDueTime(value);
      setOmitDueDate(false);
      if (dueChip === 'none') setDueChip('custom');
    },
    [dueChip],
  );

  const staffForAvatars = useMemo(() => {
    const q = assigneeQuery.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => s.displayName.toLowerCase().includes(q));
  }, [staff, assigneeQuery]);

  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      if (!propertyId) throw new Error('NO_PROPERTY');
      if (!title.trim()) throw new Error('NO_TITLE');
      const res = await apiClient.post<{ data: { tasks: Task[] } }>('/tasks', {
        propertyIds: [propertyId],
        title: title.trim(),
        type: selectedType,
        priority,
        assigneeId: assigneeId || null,
        ...(omitDueDate ? {} : { dueDate }),
        dueTime: omitDueDate ? null : dueTime || null,
        reservationId: bookingId || null,
        notes: description.trim() || undefined,
      });
      return res.data.data.tasks;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['calendar'] });
      toast.success(t('success'));
      router.push('/dashboard/tasks');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'NO_PROPERTY') toast.error(t('validationProperty'));
      else if (msg === 'NO_TITLE') toast.error(t('validationTitle'));
      else toast.error(t('error'));
    },
  });

  const handleCmdEnter = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (propertyId && title.trim() && !propsLoading && !isPending) {
          mutate();
        }
      }
    },
    [propertyId, title, propsLoading, isPending, mutate],
  );

  const canSubmit = Boolean(propertyId) && Boolean(title.trim()) && !propsLoading;

  const AssigneeAvatarButton = ({
    member,
    selected,
    onPick,
  }: {
    member: StaffMember | null;
    selected: boolean;
    onPick: () => void;
  }) => (
    <button
      type="button"
      onClick={onPick}
      title={member ? member.displayName : tTasks('unassigned')}
      className={cn(
        'flex h-10 min-w-10 max-w-[10rem] shrink-0 items-center justify-center rounded-full border-2 px-1.5 text-[10px] font-semibold leading-tight transition-colors',
        selected
          ? 'border-primary bg-primary/15 text-foreground shadow-sm ring-2 ring-primary/25'
          : 'border-border/70 bg-background text-muted-foreground hover:border-primary/40 hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <span className="truncate text-center">{member ? formatNameAndLastInitial(member.displayName) : '—'}</span>
    </button>
  );

  if (!propertyId) {
    return (
      <div className="mx-auto max-w-lg space-y-4 pt-8">
        <p className="text-sm text-destructive">{t('missingParams')}</p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col max-md:min-h-[min(100dvh,100svh)]">
      <form
        className="flex min-h-0 flex-1 flex-col md:overflow-hidden md:rounded-xl md:border md:border-border/60 md:bg-card md:shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !isPending) mutate();
        }}
      >
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-[calc(6rem+env(safe-area-inset-bottom))] pt-0 max-md:space-y-2 md:space-y-3 md:pb-6 md:p-5">
          <p className="text-xs text-muted-foreground/90">
            <span className="text-muted-foreground/70">{t('propertyLabel')}</span>
            <span className="mx-1.5 text-muted-foreground/40">·</span>
            <span className="font-medium text-foreground/80">{propertyName || '…'}</span>
          </p>

          <div className="rounded-lg border border-input bg-background px-3 py-2.5 shadow-sm dark:bg-card">
            <input
              id="task-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleCmdEnter}
              placeholder={t('titlePlaceholder')}
              aria-label={t('titlePlaceholder')}
              className="w-full border-none bg-transparent p-0 text-base font-semibold leading-snug outline-none placeholder:text-muted-foreground focus-visible:ring-0 sm:text-lg"
            />
          </div>

          {bookingId ? (
            <div className="space-y-1">
              <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('bookingLabel')}</Label>
              {bookingLoading ? (
                <p className="text-xs text-muted-foreground">{t('bookingLoading')}</p>
              ) : booking ? (
                <BookingCard booking={booking} onClear={() => setBookingId('')} />
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t('typeLabel')}</Label>
            <div className="flex flex-wrap gap-1">
              {TASK_TYPES.map(({ type, labelKey }) => {
                const ShortIcon = TASK_TYPE_SHORT_ICONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleTypeSelect(type)}
                    className={pillClass(selectedType === type)}
                  >
                    <span className="inline-flex items-center gap-1 md:hidden">
                      {ShortIcon ? (
                        <ShortIcon className="h-3 w-3 shrink-0 stroke-[2.25] text-muted-foreground" aria-hidden />
                      ) : null}
                      {tTypeShort(labelKey)}
                    </span>
                    <span className="hidden md:inline">{tType(labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <KeySection icon={User} label={t('assigneeLabel')} accentClass="border-l-[3px] border-l-primary">
              {staffLoading ? (
                <p className="text-xs text-muted-foreground">…</p>
              ) : staff.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('assigneeNoStaff')}</p>
              ) : (
                <>
                  {staff.length > 5 ? (
                    <input
                      value={assigneeQuery}
                      onChange={(e) => setAssigneeQuery(e.target.value)}
                      placeholder={t('assigneeSearchPlaceholder')}
                      className={cn(dateTimeFieldClass, 'mb-2 text-xs')}
                      aria-label={t('assigneeSearchPlaceholder')}
                    />
                  ) : null}
                  <div className="flex max-w-full flex-wrap gap-2">
                    <AssigneeAvatarButton member={null} selected={assigneeId === ''} onPick={() => setAssigneeId('')} />
                    {staffForAvatars.map((s) => (
                      <AssigneeAvatarButton
                        key={s.id}
                        member={s}
                        selected={assigneeId === s.id}
                        onPick={() => {
                          setAssigneeId(s.id);
                          setAssigneeQuery('');
                        }}
                      />
                    ))}
                  </div>
                  {assigneeQuery.trim() && staffForAvatars.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">—</p>
                  ) : null}
                </>
              )}
            </KeySection>

            <KeySection
              icon={Calendar}
              label={t('dueSectionLabel')}
              accentClass="border-l-[3px] border-l-amber-500 dark:border-l-amber-400"
            >
              <div className="flex flex-wrap gap-1 md:gap-1.5">
                <button type="button" className={pillClass(dueChip === 'today')} onClick={setDueToday}>
                  {t('quickDateToday')}
                </button>
                <button type="button" className={pillClass(dueChip === 'tomorrow')} onClick={setDueTomorrow}>
                  {t('quickDateTomorrow')}
                </button>
                <button type="button" className={pillClass(dueChip === 'threeDays')} onClick={setDueThreeDays}>
                  {t('quickDateThreeDays')}
                </button>
                <button type="button" className={pillClass(dueChip === 'none')} onClick={setDueNone}>
                  {t('quickDateNone')}
                </button>
              </div>
              {omitDueDate ? (
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t('quickDateNoneHint')}</p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="min-w-0">
                    <label htmlFor="task-due-date" className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                      {t('dueDateLabel')}
                    </label>
                    <input
                      id="task-due-date"
                      type="date"
                      value={dueDate}
                      onChange={(e) => onDueDateFieldChange(e.target.value)}
                      className={dateTimeFieldClass}
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="task-due-time" className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                      {t('dueTimeLabel')}
                    </label>
                    <input
                      id="task-due-time"
                      type="time"
                      value={dueTime}
                      onChange={(e) => onDueTimeFieldChange(e.target.value)}
                      className={dateTimeFieldClass}
                    />
                  </div>
                </div>
              )}
            </KeySection>
          </div>

          <KeySection icon={AlertTriangle} label={t('priorityLabel')} accentClass="border-l-[3px] border-l-rose-500 dark:border-l-rose-400">
            <div className="flex w-full flex-wrap gap-2">
              {PRIORITY_OPTIONS.map(({ value, labelKey }) => {
                const active = priority === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPriority(value)}
                    className={cn(
                      'inline-flex shrink-0 items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors',
                      active && value === 'normal' && 'border-slate-400/60 bg-slate-500/20 text-foreground shadow-sm dark:bg-slate-500/25',
                      active && value === 'urgent' &&
                        'border-amber-500/70 bg-amber-500/20 text-amber-950 shadow-sm dark:text-amber-50',
                      active && value === 'critical' &&
                        'border-red-500/70 bg-red-500/15 text-red-950 shadow-sm dark:text-red-100',
                      !active && 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    {tPriority(labelKey)}
                  </button>
                );
              })}
            </div>
          </KeySection>

          <div className="space-y-1.5">
            <Label htmlFor="task-description" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('descriptionLabel')}
            </Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={handleCmdEnter}
              rows={3}
              placeholder={t('descriptionPlaceholder')}
              className="resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm shadow-sm focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 dark:bg-card"
            />
          </div>
        </div>

        <div
          className={cn(
            'fixed bottom-0 left-0 right-0 z-40 border-t border-border/80 bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85',
            'shadow-[0_-8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_-8px_36px_rgba(0,0,0,0.45)]',
            'md:static md:z-auto md:rounded-b-xl md:border-t md:bg-card md:shadow-none',
          )}
        >
          <div className="mx-auto flex w-full max-w-lg gap-2 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:max-w-none md:px-5 md:py-3.5 md:pb-4">
            <Button type="button" variant="ghost" size="sm" className="shrink-0 md:h-9" onClick={() => router.back()}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              size="default"
              disabled={!canSubmit || isPending}
              className="min-h-11 min-w-0 flex-1 font-semibold text-primary-foreground shadow-sm md:min-h-9 md:flex-none md:px-6"
            >
              {isPending ? t('submitting') : t('submit')}
            </Button>
          </div>
        </div>
      </form>
      <p className="mt-2 hidden text-center text-[11px] text-muted-foreground md:block">{t('submitKeyboardHint')}</p>
    </div>
  );
}
