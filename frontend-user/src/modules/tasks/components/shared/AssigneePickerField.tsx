'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Plus, Search } from 'lucide-react';
import { cn, idEquals } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useInsideModalNestedPortal, useModalNestedPortalContainer } from '@/components/ui/modal-nested-portal';
import type { StaffMember } from '../../types';
import { formatNameAndLastInitial } from '../../utils/staff-name-short';

const assigneePillClass = (disabled?: boolean) =>
  cn(
    'inline-flex h-10 max-w-[min(100%,14rem)] min-w-0 items-center justify-center rounded-full border-2 px-3 text-[10px] font-semibold leading-tight transition-colors',
    'border-border/70 bg-background text-foreground',
    disabled && 'pointer-events-none opacity-60',
  );

function getQuickStaffMembers(
  staff: StaffMember[],
  assigneeId: string | null | undefined,
  limit: number,
): StaffMember[] {
  const id = assigneeId?.trim() || null;
  const selected = id ? staff.find((s) => idEquals(s.id, id)) : null;
  const rest = id ? staff.filter((s) => !idEquals(s.id, id)) : [...staff];
  const out: StaffMember[] = [];
  if (selected) out.push(selected);
  for (const s of rest) {
    if (out.length >= limit) break;
    out.push(s);
  }
  return out;
}

export type AssigneePickerFieldProps = {
  staff: StaffMember[];
  value: string | null | '' | undefined;
  onChange: (assigneeId: string | null) => void;
  disabled?: boolean;
  loading?: boolean;
  fallbackName?: string | null;
  variant?: 'compact' | 'full';
  /** Number of round quick-pick buttons in `full` variant (default 3). */
  quickPickLimit?: number;
  /** Hide the «—» unassign control (e.g. driver picker). */
  omitUnassignedQuickButton?: boolean;
  /** Show assigneePickerHint above the search list in the «+» modal. */
  showAssigneeModalHint?: boolean;
  /** Include «Unassigned» in the search modal list. */
  allowUnassignedInModal?: boolean;
};

function AssigneeListPanel({
  search,
  onSearchChange,
  modalStaff,
  currentId,
  onPick,
  allowUnassigned,
  t,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  modalStaff: StaffMember[];
  currentId: string | null;
  onPick: (id: string | null) => void;
  allowUnassigned: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="tasks-theme space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('assigneeSearchPlaceholder')}
          autoComplete="off"
          className={cn(
            'h-11 rounded-xl border border-primary/25 bg-muted pl-10 pr-4 text-base shadow-inner shadow-black/5',
            'placeholder:text-muted-foreground/80 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20',
          )}
          aria-label={t('assigneeSearchPlaceholder')}
        />
      </div>
      <div className="max-h-[min(52dvh,420px)] space-y-0.5 overflow-y-auto overscroll-contain">
        {allowUnassigned ? (
          <>
            <button
              type="button"
              onClick={() => onPick(null)}
              className={cn(
                'flex w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                currentId == null ? 'bg-muted font-medium' : 'hover:bg-muted/80',
              )}
            >
              {t('unassigned')}
            </button>
            <div className="my-1 h-px bg-border/60" />
          </>
        ) : null}
        {modalStaff.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('assigneeSearchNoResults')}</p>
        ) : (
          modalStaff.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              className={cn(
                'flex w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                idEquals(currentId, s.id) ? 'bg-muted font-medium' : 'hover:bg-muted/80',
              )}
            >
              <span className="font-medium text-foreground">{s.displayName}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Портал: внутри Radix modal — в in-modal host (иначе Radix глушит pointer-events у узлов в `document.body`).
 * Вне модалки — в `body`.
 */
function AssigneePickerPortal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const insideModal = useInsideModalNestedPortal();
  const modalHost = useModalNestedPortalContainer();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    if (insideModal) {
      return () => window.removeEventListener('keydown', onKey);
    }
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
    };
  }, [open, onClose, insideModal]);

  if (!mounted || !open) return null;

  const portalTarget = insideModal ? modalHost : document.body;
  if (!portalTarget) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex flex-col justify-end md:items-center md:justify-center md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assignee-picker-title"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
        role="button"
        tabIndex={-1}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        className="relative z-10 flex max-h-[min(88dvh,680px)] w-full flex-col rounded-t-2xl border border-border/80 bg-background shadow-2xl md:max-h-[min(80vh,560px)] md:max-w-md md:rounded-2xl"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="assignee-picker-title"
          className="shrink-0 border-b border-border/60 px-4 py-3 text-center text-sm font-semibold text-foreground md:text-left"
        >
          {title}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

export function AssigneePickerField({
  staff,
  value,
  onChange,
  disabled,
  loading,
  fallbackName,
  variant = 'compact',
  quickPickLimit = 3,
  omitUnassignedQuickButton = false,
  showAssigneeModalHint = true,
  allowUnassignedInModal = true,
}: AssigneePickerFieldProps) {
  const t = useTranslations('tasks.detail');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const currentId = value?.trim() ? value.trim() : null;

  const quick = useMemo(
    () => getQuickStaffMembers(staff, currentId, quickPickLimit),
    [staff, currentId, quickPickLimit],
  );

  const modalStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => s.displayName.toLowerCase().includes(q));
  }, [staff, search]);

  const orphanAssignee = !!currentId && !staff.some((s) => idEquals(s.id, currentId));

  const selectedMember = currentId ? staff.find((s) => idEquals(s.id, currentId)) : null;
  const compactLabel = (() => {
    if (!currentId) return t('unassigned');
    if (selectedMember) return formatNameAndLastInitial(selectedMember.displayName);
    if (fallbackName?.trim()) return formatNameAndLastInitial(fallbackName);
    return currentId.slice(0, 8);
  })();

  const closeSheet = () => {
    setOpen(false);
    setSearch('');
  };

  const pickAndClose = (id: string | null) => {
    onChange(id);
    closeSheet();
  };

  const plusButton = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      disabled={disabled}
      className="h-10 w-10 shrink-0 rounded-full border-dashed border-primary/35 text-primary hover:bg-primary/10"
      aria-label={t('assigneeAddAria')}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => {
        if (!disabled) setOpen(true);
      }}
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
    </Button>
  );

  const portalPanel = (
    <AssigneePickerPortal open={open} onClose={closeSheet} title={t('assigneePickerTitle')}>
      {showAssigneeModalHint ? (
        <p className="mb-3 text-xs text-muted-foreground">{t('assigneePickerHint')}</p>
      ) : null}
      <AssigneeListPanel
        search={search}
        onSearchChange={setSearch}
        modalStaff={modalStaff}
        currentId={currentId}
        onPick={pickAndClose}
        allowUnassigned={allowUnassignedInModal}
        t={t}
      />
    </AssigneePickerPortal>
  );

  if (loading) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">…</p>
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">{t('assigneeNoStaff')}</p>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              assigneePillClass(disabled),
              !currentId && 'text-muted-foreground',
              orphanAssignee && 'border-primary/40 bg-primary/5',
            )}
            title={selectedMember?.displayName ?? fallbackName?.trim() ?? undefined}
          >
            <span className="truncate">{compactLabel}</span>
          </span>
          {plusButton}
        </div>
        {portalPanel}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {!omitUnassignedQuickButton ? (
          <button
            type="button"
            title={t('unassigned')}
            disabled={disabled}
            onClick={() => onChange(null)}
            className={cn(
              'flex h-10 min-w-10 max-w-[10rem] shrink-0 items-center justify-center rounded-full border-2 px-1.5 text-[10px] font-semibold leading-tight transition-colors',
              currentId == null
                ? 'border-primary bg-primary/15 text-foreground shadow-sm ring-2 ring-primary/25'
                : 'border-border/70 bg-background text-muted-foreground hover:border-primary/40',
              disabled && 'pointer-events-none opacity-60',
            )}
          >
            —
          </button>
        ) : null}
        {quick.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.displayName}
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={cn(
              'flex h-10 min-w-10 max-w-[10rem] shrink-0 items-center justify-center rounded-full border-2 px-1.5 text-[10px] font-semibold leading-tight transition-colors',
              idEquals(currentId, s.id)
                ? 'border-primary bg-primary/15 text-foreground shadow-sm ring-2 ring-primary/25'
                : 'border-border/70 bg-background text-muted-foreground hover:border-primary/40',
              disabled && 'pointer-events-none opacity-60',
            )}
          >
            <span className="truncate text-center">{formatNameAndLastInitial(s.displayName)}</span>
          </button>
        ))}
        {orphanAssignee ? (
          <span
            className={cn(
              'flex h-10 min-w-10 max-w-[10rem] cursor-default items-center justify-center rounded-full border-2 border-primary/40 bg-primary/5 px-1.5 text-[10px] font-semibold leading-tight',
              disabled && 'pointer-events-none opacity-60',
            )}
            title={fallbackName?.trim() || currentId!}
          >
            <span className="truncate text-center">
              {fallbackName?.trim()
                ? formatNameAndLastInitial(fallbackName)
                : currentId!.slice(0, 8)}
            </span>
          </span>
        ) : null}
        {plusButton}
      </div>
      {portalPanel}
    </div>
  );
}
