'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { ActiveCallsList } from '@/components/calls/ActiveCallsList';
import { CallLivePanel } from '@/components/calls/CallLivePanel';
import { useActiveCalls } from '@/hooks/use-calls';
import { useCallsSocket } from '@/hooks/use-calls-socket';
import { Phone, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CallsLivePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialId = searchParams.get('session');

  const [selectedId, setSelectedId] = useState<string | null>(initialId);

  const { data: calls = [], isLoading: callsLoading, refetch } = useActiveCalls(true);
  useCallsSocket();

  useEffect(() => {
    if (!selectedId && calls.length > 0) {
      setSelectedId(calls[0]?.id ?? null);
    }
  }, [calls, selectedId]);

  // Sync URL for deep-linking
  useEffect(() => {
    if (selectedId) {
      const url = new URL(window.location.href);
      url.searchParams.set('session', selectedId);
      window.history.replaceState({}, '', url.toString());
    }
  }, [selectedId]);

  return (
    <div className="flex flex-col h-full">
      {/* Subheader */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-semibold text-slate-700">Активные звонки</span>
          {calls.length > 0 && (
            <span className="rounded-full bg-teal-600 text-white text-xs font-bold px-2 py-0.5">
              {calls.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refetch()}
          className="h-7 gap-1 text-xs text-slate-400"
        >
          <RefreshCw className="h-3 w-3" />
          Обновить
        </Button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar: call list */}
        <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col">
          {callsLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : calls.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-slate-300">
              <Phone className="h-8 w-8 opacity-40" />
              <span className="text-sm">Нет активных</span>
            </div>
          ) : (
            <ActiveCallsList
              calls={calls}
              selectedId={selectedId}
              onSelect={setSelectedId}
              className="flex-1 p-2"
            />
          )}
        </aside>

        {/* Live panel */}
        <main className="flex-1 min-w-0 bg-white">
          {selectedId ? (
            <CallLivePanel sessionId={selectedId} className="h-full" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
              <Phone className="h-10 w-10 opacity-20" />
              <span className="text-sm">
                {calls.length > 0 ? 'Выберите звонок' : 'Нет активных звонков'}
              </span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
