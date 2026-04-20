'use client';

import { cn } from '@/lib/utils';
import * as Sheet from '@radix-ui/react-dialog';
import { X, Info } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { AuditLogEntry } from '@/lib/api/calls-admin';

interface Props {
  entry: AuditLogEntry | null;
  onClose: () => void;
}

export function AuditLogDrawer({ entry, onClose }: Props) {
  return (
    <Sheet.Root open={!!entry} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Sheet.Portal>
        <Sheet.Overlay className="fixed inset-0 bg-black/40 z-40" />
        <Sheet.Content className="fixed right-0 top-0 z-50 h-full w-full overflow-y-auto border-l border-border bg-card p-5 shadow-2xl sm:w-[420px] dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-5 flex items-center justify-between">
            <Sheet.Title className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Info className="h-4 w-4 text-primary dark:text-cyan-400" />
              Детали записи
            </Sheet.Title>
            <Sheet.Close onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground dark:hover:text-white">
              <X className="h-4 w-4" />
            </Sheet.Close>
          </div>

          {entry && (
            <div className="space-y-4">
              <Field label="ID" value={entry.id} mono />
              <Field label="Время" value={format(new Date(entry.createdAt), 'dd.MM.yyyy HH:mm:ss', { locale: ru })} />
              <Field label="Действие" value={entry.actionType} highlight />
              <Field label="Актор ID" value={entry.actorId} mono />
              <Field label="Роль" value={entry.actorRole} />
              {entry.entityType && <Field label="Тип сущности" value={entry.entityType} />}
              {entry.entityId && <Field label="ID сущности" value={entry.entityId} mono />}
              {entry.propertyId && <Field label="Property ID" value={entry.propertyId} mono />}

              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Метаданные</p>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs text-foreground dark:bg-slate-800 dark:text-slate-300">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

function Field({ label, value, mono, highlight }: {
  label: string; value: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        'break-all text-sm',
        mono ? 'font-mono text-foreground/90 dark:text-slate-300' : 'text-foreground dark:text-slate-200',
        highlight && 'font-medium text-primary dark:text-cyan-300',
      )}>
        {value}
      </p>
    </div>
  );
}
