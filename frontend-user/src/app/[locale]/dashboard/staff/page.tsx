'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { useUiStore } from '@/stores/ui.store';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Copy, Loader2 } from 'lucide-react';

const JOB_TYPES = ['cleaner', 'maintenance', 'driver', 'other'] as const;
type JobType = (typeof JOB_TYPES)[number];

interface StaffDirectoryRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobType: string | null;
  telegramUsername: string | null;
  telegramLinked: boolean;
  createdAt: string;
}

interface PersonnelResponse {
  members: StaffDirectoryRow[];
  telegramBotConfigured: boolean;
}

interface InviteResponse {
  userId: string;
  inviteLink: string | null;
  expiresAt: string | null;
  telegramBotConfigured: boolean;
}

async function fetchStaffPersonnel(): Promise<PersonnelResponse> {
  const res = await apiClient.get<{ data: PersonnelResponse }>('/users/staff/personnel');
  return res.data.data;
}

export default function StaffPage() {
  const t = useTranslations('staff');
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { data: personnel, isLoading, error, mutate } = useSWR(
    user?.role === 'OWNER' || user?.role === 'MANAGER' ? 'users/staff/personnel' : null,
    fetchStaffPersonnel,
  );

  useEffect(() => {
    if (authLoading || !user) return;
    if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobType, setJobType] = useState<JobType>('cleaner');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setJobType('cleaner');
    setTelegramUsername('');
    setInviteResult(null);
    setFormError(null);
  };

  const resetFormRef = useRef(resetForm);
  resetFormRef.current = resetForm;
  const setStaffInviteHandler = useUiStore((s) => s.setStaffInviteHandler);

  useEffect(() => {
    if (authLoading || !user || (user.role !== 'OWNER' && user.role !== 'MANAGER')) {
      setStaffInviteHandler(null);
      return;
    }
    setStaffInviteHandler(() => () => {
      resetFormRef.current();
      setDialogOpen(true);
    });
    return () => setStaffInviteHandler(null);
  }, [authLoading, user, setStaffInviteHandler]);

  const onSubmit = async () => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const em = email.trim().toLowerCase();
    if (!fn || !ln) {
      setFormError(t('formRequired'));
      return;
    }
    if (!em) {
      setFormError(t('emailRequired'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await apiClient.post<{ data: InviteResponse }>('/users/staff/invite', {
        firstName: fn,
        lastName: ln,
        email: em,
        phone: phone.trim() || undefined,
        jobType,
        telegramUsername: telegramUsername.trim() || undefined,
      });
      setInviteResult(res.data.data);
      await mutate();
    } catch (e: unknown) {
      const axiosErr = e as { response?: { data?: { message?: string | string[] } } };
      const raw = axiosErr.response?.data?.message;
      const msg = Array.isArray(raw) ? raw.join(', ') : raw;
      setFormError(msg ?? t('inviteError'));
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    const link = inviteResult?.inviteLink;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      /* ignore */
    }
  };

  if (authLoading || (user && user.role !== 'OWNER' && user.role !== 'MANAGER')) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        {authLoading ? t('loading') : null}
      </div>
    );
  }

  const list = personnel?.members ?? [];
  const telegramBotConfigured = personnel?.telegramBotConfigured ?? false;

  const jobTypeLabel = (jt: string | null) => {
    if (jt === 'cleaner') return t('jobTypes.cleaner');
    if (jt === 'maintenance') return t('jobTypes.maintenance');
    if (jt === 'driver') return t('jobTypes.driver');
    if (jt === 'other') return t('jobTypes.other');
    return '—';
  };

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-4 sm:space-y-6">
      {!telegramBotConfigured && (
        <Alert>
          <AlertDescription>{t('botNotConfigured')}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('loading')}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{t('loadError')}</p>}

      {!isLoading && !error && (
        <>
        {/* Таблица только на большом экране; до lg — карточки (планшеты тоже «мобильный» UX) */}
        <div className="hidden overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-border dark:bg-card lg:block">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 font-medium">{t('colName')}</th>
                <th className="px-4 py-3 font-medium">{t('colJobType')}</th>
                <th className="px-4 py-3 font-medium">{t('colPhone')}</th>
                <th className="px-4 py-3 font-medium">{t('colEmail')}</th>
                <th className="px-4 py-3 font-medium">{t('colTelegram')}</th>
                <th className="hidden px-4 py-3 font-medium xl:table-cell">{t('colAdded')}</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                list.map((row) => (
                  <tr key={row.id} className="border-b border-border/80 last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {row.firstName} {row.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{jobTypeLabel(row.jobType)}</td>
                    <td className="max-w-[140px] truncate px-4 py-3 text-muted-foreground" title={row.phone ?? ''}>
                      {row.phone ?? '—'}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground" title={row.email}>
                      {row.email}
                    </td>
                    <td className="px-4 py-3">
                      <TelegramCell row={row} />
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground xl:table-cell">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Должно совпадать с брейкпоинтом таблицы: иначе на 768–1023px не видно ни карточек, ни таблицы */}
        <div className="flex flex-col gap-3 lg:hidden">
          {list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200/90 bg-white/90 px-4 py-12 text-center text-sm text-slate-500 shadow-sm dark:bg-white/95 dark:text-slate-600">
              {t('empty')}
            </div>
          ) : (
            list.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-slate-200/80 bg-white p-5 text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-slate-100 dark:border-slate-200/80 dark:bg-white dark:text-slate-900 dark:shadow-[0_2px_16px_rgba(0,0,0,0.12)] dark:ring-slate-200/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug tracking-tight text-slate-900">
                      {row.firstName} {row.lastName}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-500">{jobTypeLabel(row.jobType)}</p>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,7rem)_1fr] sm:gap-x-3">
                    <dt className="text-slate-500">{t('colEmail')}</dt>
                    <dd className="min-w-0 break-all font-medium text-slate-900">{row.email}</dd>
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,7rem)_1fr] sm:gap-x-3">
                    <dt className="text-slate-500">{t('colPhone')}</dt>
                    <dd className="font-medium text-slate-900">{row.phone ?? '—'}</dd>
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,7rem)_1fr] sm:gap-x-3">
                    <dt className="text-slate-500">{t('colTelegram')}</dt>
                    <dd className="min-w-0 text-slate-900">
                      <TelegramCell row={row} />
                    </dd>
                  </div>
                </dl>
              </article>
            ))
          )}
        </div>
        </>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent
          className="max-h-[min(90dvh,720px)] max-w-lg overflow-y-auto sm:max-w-xl"
          title={inviteResult ? t('inviteLinkTitle') : t('dialogTitle')}
          description={
            inviteResult
              ? inviteResult.inviteLink
                ? t('inviteReady')
                : t('savedWithoutInvite')
              : t('dialogDescription')
          }
          footer={
            inviteResult ? (
              <div className="flex flex-wrap justify-end gap-2">
                {inviteResult.inviteLink ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-[400px]:flex-none flex-1"
                    onClick={() => void copyLink()}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {t('copyLink')}
                  </Button>
                ) : null}
                <Button type="button" onClick={() => setDialogOpen(false)}>
                  {t('done')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button type="button" disabled={submitting} onClick={() => void onSubmit()}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {telegramBotConfigured ? t('createInvite') : t('saveStaff')}
                </Button>
              </div>
            )
          }
        >
          {inviteResult ? (
            inviteResult.inviteLink ? (
              <div className="break-all rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs">
                {inviteResult.inviteLink}
              </div>
            ) : null
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="staff-fn">{t('firstName')}</Label>
                  <Input
                    id="staff-fn"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-ln">{t('lastName')}</Label>
                  <Input
                    id="staff-ln"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-email">{t('email')}</Label>
                <Input
                  id="staff-email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="name@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-phone">{t('phone')}</Label>
                <Input
                  id="staff-phone"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                  placeholder={t('phonePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-job">{t('jobType')}</Label>
                <Select
                  id="staff-job"
                  value={jobType}
                  onChange={(e) => setJobType(e.target.value as JobType)}
                >
                  {JOB_TYPES.map((j) => (
                    <option key={j} value={j}>
                      {t(`jobTypes.${j}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-tg">{t('telegramUsername')}</Label>
                <Input
                  id="staff-tg"
                  value={telegramUsername}
                  onChange={(e) => setTelegramUsername(e.target.value.replace(/^@+/, ''))}
                  autoComplete="off"
                  placeholder={t('telegramPlaceholder')}
                />
                <p className="text-xs text-muted-foreground">{t('telegramHint')}</p>
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
}

function TelegramCell({ row }: { row: StaffDirectoryRow }) {
  const t = useTranslations('staff');
  if (row.telegramLinked) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
          {t('telegramInBot')}
        </span>
        {row.telegramUsername ? (
          <span className="text-xs text-muted-foreground">@{row.telegramUsername}</span>
        ) : null}
      </span>
    );
  }
  if (row.telegramUsername) {
    return (
      <span className="text-xs text-muted-foreground" title={t('telegramExpected')}>
        @{row.telegramUsername}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}
