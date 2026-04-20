'use client';

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, UserCheck } from 'lucide-react';
import { useQaAssign, useQaBulkAssign } from '@/hooks/use-calls-admin';
import { cn } from '@/lib/utils';

type Priority = 'low' | 'normal' | 'high' | 'urgent';

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: 'low',    label: 'Низкий',     color: 'text-slate-400' },
  { value: 'normal', label: 'Обычный',    color: 'text-teal-400' },
  { value: 'high',   label: 'Высокий',    color: 'text-amber-400' },
  { value: 'urgent', label: 'Срочный',    color: 'text-red-400' },
];

interface Props {
  reviewId?: string;
  reviewIds?: string[];
  onSuccess?: () => void;
  children: React.ReactNode;
}

export function QaAssignDialog({ reviewId, reviewIds, onSuccess, children }: Props) {
  const [open, setOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');

  const singleAssign = useQaAssign();
  const bulkAssign = useQaBulkAssign();

  const isBulk = !!reviewIds && reviewIds.length > 0;
  const isPending = singleAssign.isPending || bulkAssign.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigneeId.trim()) return;

    const payload = {
      assigneeId: assigneeId.trim(),
      priority,
      dueAt: dueAt || undefined,
    };

    try {
      if (isBulk) {
        await bulkAssign.mutateAsync({ reviewIds: reviewIds!, ...payload });
      } else if (reviewId) {
        await singleAssign.mutateAsync({ reviewId, ...payload });
      }
      onSuccess?.();
      setOpen(false);
      setAssigneeId('');
      setDueAt('');
      setPriority('normal');
    } catch {
      // errors shown inline by React Query
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-white">
              <UserCheck className="h-4 w-4 text-cyan-400" />
              {isBulk ? `Назначить ${reviewIds!.length} ревью` : 'Назначить ревью'}
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">ID ревьюера *</label>
              <input
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                placeholder="UUID пользователя"
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Срок (необязательно)</label>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Приоритет</label>
              <div className="grid grid-cols-4 gap-1">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={cn(
                      'py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      priority === opt.value
                        ? 'bg-slate-700 border-cyan-500/60 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {(singleAssign.isError || bulkAssign.isError) && (
              <p className="text-xs text-red-400">Ошибка назначения. Попробуйте снова.</p>
            )}

            <div className="flex gap-2 pt-1">
              <Dialog.Close asChild>
                <button type="button" className="flex-1 py-2 rounded-lg border border-slate-700 text-sm text-slate-400 hover:text-white hover:border-slate-600 transition-colors">
                  Отмена
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={isPending || !assigneeId.trim()}
                className="flex-1 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-sm text-white font-medium transition-colors disabled:opacity-40"
              >
                {isPending ? 'Назначаем...' : 'Назначить'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
