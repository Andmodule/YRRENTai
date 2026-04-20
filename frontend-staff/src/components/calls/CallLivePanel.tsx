'use client';

import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { TakeoverButton } from './TakeoverButton';
import { TranscriptTimeline } from './TranscriptTimeline';
import { EventTimeline } from './EventTimeline';
import { CallQualityBadge } from './CallQualityBadge';
import { CallReviewPanel } from './CallReviewPanel';
import { useCallSession } from '@/hooks/use-calls';
import { useCallsSocket, type LiveTranscriptSegment } from '@/hooks/use-calls-socket';
import type { TranscriptSegment } from '@/lib/api/calls';

type ActiveTab = 'transcript' | 'events' | 'review';

interface CallLivePanelProps {
  sessionId: string;
  className?: string;
  /** Restore active tab from URL state */
  initialTab?: string;
  /** Notify parent when tab changes (for URL sync) */
  onTabChange?: (tab: ActiveTab) => void;
}

export function CallLivePanel({ sessionId, className, initialTab, onTabChange }: CallLivePanelProps) {
  const { data: session, isLoading } = useCallSession(sessionId);
  const [liveSegments, setLiveSegments] = useState<LiveTranscriptSegment[]>([]);
  const [aiState, setAiState] = useState<string>('');
  const [lastIntent, setLastIntent] = useState<string | null>(null);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [lastEscalation, setLastEscalation] = useState<{ reason: string; action: string } | null>(null);
  const validInitialTab = (initialTab === 'transcript' || initialTab === 'events' || initialTab === 'review')
    ? initialTab : undefined;
  const [activeTab, setActiveTab] = useState<ActiveTab>(validInitialTab ?? 'transcript');
  const handleTabChange = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);
  const lastSegmentAt = useRef<number>(Date.now());

  const onSegment = useCallback((seg: LiveTranscriptSegment) => {
    setLiveSegments((prev) => {
      if (prev.find((s) => s.id === seg.id)) return prev;
      return [...prev, seg];
    });
    lastSegmentAt.current = Date.now();
    if (seg.role === 'ai') {
      setAiState('ai_speaking');
      if (seg.intent) setLastIntent(seg.intent);
      if (seg.confidence !== null) setLastConfidence(seg.confidence);
      if (seg.latencyMs !== null) setLastLatency(seg.latencyMs);
    }
    if (seg.role === 'guest') setAiState('guest_speaking');
  }, []);

  const onEscalation = useCallback(
    (payload: { sessionId: string; reason: string; recommendedAction: string }) => {
      if (payload.sessionId === sessionId) {
        setLastEscalation({ reason: payload.reason, action: payload.recommendedAction });
        // Switch to events tab so operator sees context
        setActiveTab('events');
      }
    },
    [sessionId],
  );

  useCallsSocket({ activeSessionId: sessionId, onSegment, onEscalation });

  if (isLoading) {
    return (
      <div className={cn('flex flex-col gap-3 p-4', className)}>
        <Skeleton className="h-6 w-48 rounded-lg" />
        <Skeleton className="h-4 w-32 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-slate-400 text-sm', className)}>
        Сессия не найдена
      </div>
    );
  }

  const persistedSegments = session.transcriptSegments ?? [];
  const liveOnly = liveSegments.filter((l) => !persistedSegments.find((p) => p.id === l.id));
  const allSegments: TranscriptSegment[] = [...persistedSegments, ...liveOnly].sort(
    (a, b) => a.turnIndex - b.turnIndex,
  );

  const isHandedOff = session.status === 'handed_off' || session.takenOverByUserId != null;
  const canTakeover = !isHandedOff && session.status !== 'completed' && session.status !== 'failed';
  const transcriptFresh = Date.now() - lastSegmentAt.current < 30_000;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-100 shrink-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800 text-base">
              {session.guestPhone ?? 'Неизвестный'}
            </span>
            <span className="text-xs text-slate-400">
              #{session.id.slice(0, 8)}
            </span>
          </div>
          <CallQualityBadge
            aiState={aiState}
            intent={lastIntent}
            confidence={lastConfidence}
            latencyMs={lastLatency}
            transcriptFresh={transcriptFresh}
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canTakeover && <TakeoverButton sessionId={session.id} />}
          {isHandedOff && (
            <span className="text-xs font-medium text-orange-600 bg-orange-50 rounded-full px-3 py-1">
              Оператор управляет
            </span>
          )}
        </div>
      </div>

      {/* Context chips */}
      {(session.propertyId || session.reservationId) && (
        <div className="flex gap-2 px-4 py-1.5 border-b border-slate-100 shrink-0">
          {session.propertyId && (
            <span className="text-xs bg-slate-100 text-slate-600 rounded-lg px-2.5 py-1">
              🏠 Объект привязан
            </span>
          )}
          {session.reservationId && (
            <span className="text-xs bg-blue-50 text-blue-700 rounded-lg px-2.5 py-1">
              📋 Бронь найдена
            </span>
          )}
          <span className="ml-auto text-xs text-slate-400">
            {session.turnCount} реплик
            {session.avgTurnLatencyMs ? ` · ~${session.avgTurnLatencyMs}ms/turn` : ''}
          </span>
        </div>
      )}

      {/* Escalation alert */}
      {lastEscalation && (
        <div className="mx-4 mt-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-amber-700">⚡ Эскалация</div>
              <div className="text-xs text-amber-600 mt-0.5">
                {lastEscalation.reason} ·{' '}
                {lastEscalation.action === 'transfer_now' ? 'Перевод немедленно' : 'Уведомить оператора'}
              </div>
            </div>
            <button
              onClick={() => setLastEscalation(null)}
              className="text-amber-400 hover:text-amber-600 text-sm px-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-slate-100 px-4 pt-2 shrink-0">
        {([
          ['transcript', `Транскрипт (${allSegments.length})`],
          ['events', `События (${(session.events ?? []).length})`],
          ['review', 'Ревью'],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            className={cn(
              'pb-2 px-3 text-xs font-medium border-b-2 transition-colors',
              activeTab === tab
                ? 'border-teal-500 text-teal-700'
                : 'border-transparent text-slate-400 hover:text-slate-600',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'transcript' && (
          <TranscriptTimeline segments={allSegments} className="h-full" />
        )}
        {activeTab === 'events' && (
          <div className="h-full overflow-y-auto px-4 py-3">
            <EventTimeline events={session.events ?? []} />
          </div>
        )}
        {activeTab === 'review' && (
          <div className="h-full overflow-y-auto px-4 py-4">
            <CallReviewPanel sessionId={session.id} />
          </div>
        )}
      </div>

      {/* Post-call summary */}
      {session.status === 'completed' && session.summary && (
        <div className="px-4 py-3 border-t border-slate-100 shrink-0">
          <div className="text-xs font-semibold text-slate-500 mb-1">Итог звонка</div>
          <div className="text-sm text-slate-700">{session.summary}</div>
        </div>
      )}
    </div>
  );
}
