'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { toast } from 'sonner';
import {
  Sparkles,
  RefreshCw,
  KeyRound,
  Wrench,
  MoreHorizontal,
  Calendar,
  User,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import { useProperties } from '@/hooks/use-properties';
import { useStaffUsers } from '@/hooks/use-staff-users';
import type { Task, TaskType, TaskPriority } from '@/modules/tasks/types';

// ─── Task type config ────────────────────────────────────────────────────────

interface TaskTypeConfig {
  type: TaskType;
  icon: React.ElementType;
  labelKey: string;
  defaultTitle: { en: string; ru: string };
  dueDateOffset: 'checkout' | 'checkin' | 'tomorrow';
  defaultTime: string;
}

const TASK_TYPES: TaskTypeConfig[] = [
  {
    type: 'checkout_cleaning',
    icon: Sparkles,
    labelKey: 'checkout_cleaning',
    defaultTitle: { en: 'Checkout cleaning', ru: 'Уборка после выезда' },
    dueDateOffset: 'checkout',
    defaultTime: '14:00',
  },
  {
    type: 'mid_stay_cleaning',
    icon: RefreshCw,
    labelKey: 'mid_stay_cleaning',
    defaultTitle: { en: 'Mid-stay cleaning', ru: 'Плановая уборка' },
    dueDateOffset: 'tomorrow',
    defaultTime: '11:00',
  },
  {
    type: 'checkin_prep',
    icon: KeyRound,
    labelKey: 'checkin_prep',
    defaultTitle: { en: 'Check-in preparation', ru: 'Подготовка к заезду' },
    dueDateOffset: 'checkin',
    defaultTime: '12:00',
  },
  {
    type: 'maintenance',
    icon: Wrench,
    labelKey: 'maintenance',
    defaultTitle: { en: 'Maintenance', ru: 'Техобслуживание' },
    dueDateOffset: 'tomorrow',
    defaultTime: '10:00',
  },
  {
    type: 'other',
    icon: MoreHorizontal,
    labelKey: 'other',
    defaultTitle: { en: 'Task', ru: 'Задача' },
    dueDateOffset: 'tomorrow',
    defaultTime: '',
  },
];

const PRIORITY_OPTIONS: { value: TaskPriority; labelKey: string; color: string }[] = [
  { value: 'normal', labelKey: 'normal', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'urgent', labelKey: 'urgent', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' },
  { value: 'critical', labelKey: 'critical', color: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
];

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
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{booking.guestName}</p>
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

export default function NewTaskFromBookingPage() {
  const t = useTranslations('tasks.newFromBooking');
  const tType = useTranslations('tasks.type');
  const tPriority = useTranslations('tasks.priority');
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { properties, isLoading: propsLoading } = useProperties();
  const { staff, isLoading: staffLoading } = useStaffUsers();

  const initialBookingId = searchParams.get('bookingId')?.trim() ?? '';
  const propertyId = searchParams.get('propertyId')?.trim() ?? '';

  // Allow user to detach booking link
  const [bookingId, setBookingId] = useState(initialBookingId);

  const { data: booking, isLoading: bookingLoading } = useBookingInfo(bookingId);

  const propertyName = useMemo(() => {
    const p = properties.find((x) => x.id === propertyId);
    return p?.name ?? propertyId;
  }, [properties, propertyId]);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [selectedType, setSelectedType] = useState<TaskType>('checkout_cleaning');
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [dueTime, setDueTime] = useState('14:00');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);

  // Auto-fill title & due date when type or booking changes
  useEffect(() => {
    const cfg = TASK_TYPES.find((c) => c.type === selectedType)!;
    if (!titleTouched) {
      setTitle(cfg.defaultTitle.ru);
    }
    if (cfg.defaultTime) setDueTime(cfg.defaultTime);

    if (booking) {
      if (cfg.dueDateOffset === 'checkout') {
        setDueDate(format(parseISO(booking.checkOut), 'yyyy-MM-dd'));
      } else if (cfg.dueDateOffset === 'checkin') {
        setDueDate(format(parseISO(booking.checkIn), 'yyyy-MM-dd'));
      } else {
        setDueDate(format(new Date(Date.now() + 86_400_000), 'yyyy-MM-dd'));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, booking]);

  const handleTypeSelect = (type: TaskType) => {
    setSelectedType(type);
    setTitleTouched(false); // reset so auto-fill kicks in
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: async () => {
      if (!propertyId) throw new Error('NO_PROPERTY');
      if (!title.trim()) throw new Error('NO_TITLE');
      const res = await apiClient.post<{ data: Task }>('/tasks', {
        propertyId,
        title: title.trim(),
        type: selectedType,
        priority,
        assigneeId: assigneeId || null,
        dueDate,
        dueTime: dueTime || null,
        reservationId: bookingId || null,
        notes: description.trim() || undefined,
      });
      return res.data.data;
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

  const canSubmit = Boolean(propertyId) && Boolean(title.trim()) && !propsLoading;

  if (!propertyId) {
    return (
      <div className="mx-auto max-w-lg space-y-4 pt-8">
        <p className="text-sm text-destructive">{t('missingParams')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-16">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm">

        {/* Property (locked) */}
        <div className="space-y-1">
          <Label>{t('propertyLabel')}</Label>
          <p className="text-sm font-medium text-foreground">{propertyName || '…'}</p>
        </div>

        {/* Booking card */}
        {bookingId && (
          <div className="space-y-1">
            <Label>{t('bookingLabel')}</Label>
            {bookingLoading ? (
              <p className="text-xs text-muted-foreground">{t('bookingLoading')}</p>
            ) : booking ? (
              <BookingCard booking={booking} onClear={() => setBookingId('')} />
            ) : null}
          </div>
        )}

        {/* Task type toggle */}
        <div className="space-y-2">
          <Label>{t('typeLabel')}</Label>
          <div className="flex flex-wrap gap-2">
            {TASK_TYPES.map(({ type, icon: Icon, labelKey }) => (
              <button
                key={type}
                type="button"
                onClick={() => handleTypeSelect(type)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  selectedType === type
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {tType(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="task-title">{t('titleLabel')}</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
            placeholder={t('titlePlaceholder')}
          />
        </div>

        {/* Assignee */}
        <div className="space-y-2">
          <Label htmlFor="task-assignee">{t('assigneeLabel')}</Label>
          {staffLoading ? (
            <p className="text-xs text-muted-foreground">…</p>
          ) : staff.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('assigneeNoStaff')}</p>
          ) : (
            <Select
              id="task-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">{t('assigneePlaceholder')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </Select>
          )}
        </div>

        {/* Due date + time */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="task-due-date" className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" aria-hidden />
              {t('dueDateLabel')}
            </Label>
            <Input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-due-time">{t('dueTimeLabel')}</Label>
            <Input
              id="task-due-time"
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </div>
        </div>

        {/* Priority */}
        <div className="space-y-2">
          <Label>{t('priorityLabel')}</Label>
          <div className="flex gap-2">
            {PRIORITY_OPTIONS.map(({ value, labelKey, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPriority(value)}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                  priority === value
                    ? cn('border-transparent', color)
                    : 'border-border bg-background text-muted-foreground hover:bg-muted',
                )}
              >
                {tPriority(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Description (collapsible) */}
        {showDescription ? (
          <div className="space-y-2">
            <Label htmlFor="task-description">{t('descriptionLabel')}</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('descriptionPlaceholder')}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDescription(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            {t('descriptionToggle')}
          </button>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <User className="mr-1.5 h-4 w-4" aria-hidden />
            {mutation.isPending ? t('submitting') : t('submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
