'use client';

import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { RecentAlert } from '@/lib/api/calls-stats';
import { AlertTriangle, ArrowRightLeft } from 'lucide-react';
import Link from 'next/link';

interface AlertsFeedProps {
  title: string;
  items: RecentAlert[];
  icon: 'escalation' | 'transfer';
  emptyText: string;
  className?: string;
}

export function AlertsFeed({ title, items, icon, emptyText, className }: AlertsFeedProps) {
  return (
    <div className={cn('rounded-2xl ring-1 ring-slate-200 bg-white overflow-hidden', className)}>
      <div className="px-4 py-3 border-b border-slate-100">
        <span className="text-sm font-semibold text-slate-700">{title}</span>
      </div>
      {items.length === 0 ? (
        <div className="py-6 text-center text-sm text-slate-400">{emptyText}</div>
      ) : (
        <ul className="divide-y divide-slate-50">
          {items.map((alert) => (
            <li key={alert.sessionId} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              {icon === 'escalation' ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 shrink-0 text-red-400" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-700 font-medium truncate">
                  {alert.guestPhone ?? 'Неизвестный'}
                </div>
                {alert.reason && (
                  <div className="text-xs text-slate-400 truncate">{alert.reason}</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="text-[11px] text-slate-400">
                  {formatDistanceToNow(new Date(alert.occurredAt), { addSuffix: true, locale: ru })}
                </span>
                <Link
                  href={`/calls/history?session=${alert.sessionId}`}
                  className="text-[11px] text-teal-600 hover:underline"
                >
                  Открыть →
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
