'use client';

import { usePropertyRollout } from '@/hooks/use-calls-stats';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

export function PropertyRolloutWidget() {
  const { data: items = [], isLoading } = usePropertyRollout();

  return (
    <div className="rounded-2xl ring-1 ring-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Rollout по объектам</span>
        <span className="text-xs text-slate-400">{items.length} объектов</span>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2 p-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">Политики не настроены</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {items.map((item) => (
            <div key={item.propertyId} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                {item.enabled ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-500" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-slate-300" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-700 truncate">
                    {item.propertyName ?? item.propertyId.slice(0, 8)}
                  </div>
                  <div className="text-xs text-slate-400">{item.provider}</div>
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0 text-xs text-slate-500">
                <span title="Звонков за 7 дней">
                  {item.callsLast7d}
                  <span className="text-slate-300 ml-0.5">/ 7d</span>
                </span>
                {item.fallbackRate !== null && (
                  <span
                    className={cn(
                      'font-medium',
                      item.fallbackRate > 20 ? 'text-red-500' :
                      item.fallbackRate > 10 ? 'text-amber-500' : 'text-teal-600',
                    )}
                    title="Fallback rate"
                  >
                    {item.fallbackRate}%
                  </span>
                )}
                {item.lastIssue && (
                  <span title={`Последний инцидент: ${new Date(item.lastIssue).toLocaleDateString('ru-RU')}`}>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
