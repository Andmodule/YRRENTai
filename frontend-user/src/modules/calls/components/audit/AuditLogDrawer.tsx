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
        <Sheet.Content className="fixed right-0 top-0 h-full w-full sm:w-[420px] bg-slate-900 border-l border-slate-700 z-50 overflow-y-auto p-5 shadow-2xl">
          <div className="flex items-center justify-between mb-5">
            <Sheet.Title className="flex items-center gap-2 text-sm font-semibold text-white">
              <Info className="h-4 w-4 text-cyan-400" />
              Детали записи
            </Sheet.Title>
            <Sheet.Close onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white">
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
                <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Метаданные</p>
                <pre className="bg-slate-800 rounded-lg p-3 text-xs text-slate-300 overflow-auto max-h-64 font-mono whitespace-pre-wrap">
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
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={cn(
        'text-sm break-all',
        mono ? 'font-mono text-slate-300' : 'text-slate-200',
        highlight && 'text-cyan-300 font-medium',
      )}>
        {value}
      </p>
    </div>
  );
}
