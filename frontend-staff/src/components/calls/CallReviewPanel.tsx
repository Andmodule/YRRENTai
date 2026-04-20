'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchCallReview, updateCallReview, type QaFlag, type ReviewStatus } from '@/lib/api/call-review';

interface CallReviewPanelProps {
  sessionId: string;
  className?: string;
}

const QA_FLAG_META: Record<QaFlag, { label: string; color: string }> = {
  low_confidence:      { label: 'Низкая уверенность', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  fallback_triggered:  { label: 'Fallback', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  unresolved_question: { label: 'Вопрос не решён', color: 'bg-red-50 text-red-700 border-red-200' },
  emergency_detected:  { label: '🚨 Экстренная', color: 'bg-red-100 text-red-800 border-red-300' },
  complaint_detected:  { label: 'Жалоба', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  transfer_failed:     { label: 'Трансфер провален', color: 'bg-red-50 text-red-700 border-red-200' },
  long_session:        { label: 'Долгий звонок', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  kb_miss:             { label: 'KB miss', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  repeat_guest:        { label: 'Повторный гость', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  high_latency:        { label: 'Высокая задержка', color: 'bg-orange-50 text-orange-600 border-orange-200' },
};

const STATUS_OPTIONS: ReviewStatus[] = ['pending', 'reviewed', 'escalated', 'closed'];
const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Ожидает',
  reviewed: 'Проверен',
  escalated: 'Эскалирован',
  closed: 'Закрыт',
};

const STAR_LABELS = ['', 'Плохо', 'Ниже среднего', 'Средне', 'Хорошо', 'Отлично'];

export function CallReviewPanel({ sessionId, className }: CallReviewPanelProps) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [rating, setRating] = useState(0);

  const { data: review, isLoading } = useQuery({
    queryKey: ['call-review', sessionId],
    queryFn: () => fetchCallReview(sessionId),
    staleTime: 30_000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: (dto: { reviewerNote?: string; qualityRating?: number; status?: ReviewStatus }) =>
      updateCallReview(sessionId, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['call-review', sessionId] });
      toast.success('Ревью сохранено');
    },
    onError: () => toast.error('Ошибка сохранения ревью'),
  });

  if (isLoading) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (!review) {
    return (
      <div className={cn('text-sm text-slate-400 py-8 text-center', className)}>
        Ревью ещё не сформировано
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* QA flags */}
      {review.qaFlags && review.qaFlags.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">QA флаги</div>
          <div className="flex flex-wrap gap-1.5">
            {review.qaFlags.map((flag) => {
              const meta = QA_FLAG_META[flag];
              return (
                <span
                  key={flag}
                  className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', meta?.color ?? 'bg-slate-100 text-slate-600')}
                >
                  {meta?.label ?? flag}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary */}
      {review.summary && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1">Резюме</div>
          <div className="text-sm text-slate-700 leading-relaxed">{review.summary}</div>
        </div>
      )}

      {/* Intents */}
      {review.detectedIntents && review.detectedIntents.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1">Обнаруженные интенты</div>
          <div className="flex flex-wrap gap-1">
            {review.detectedIntents.map((i) => (
              <span key={i} className="rounded-full bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 text-xs">
                {i}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Unresolved questions */}
      {review.unresolvedQuestions && review.unresolvedQuestions.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1">Нерешённые вопросы</div>
          <ul className="list-disc list-inside text-sm text-slate-700 space-y-0.5">
            {review.unresolvedQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Follow-up */}
      {review.followUpRequired && review.followUpSuggestion && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2">
          <div className="text-xs font-semibold text-blue-700 mb-0.5">🔔 Требуется действие</div>
          <div className="text-sm text-blue-800">{review.followUpSuggestion}</div>
        </div>
      )}

      {/* KB hints */}
      {review.kbImprovementHints && review.kbImprovementHints.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1">Улучшить в KB</div>
          <div className="flex flex-col gap-1">
            {review.kbImprovementHints.map((h, i) => (
              <div key={i} className="text-xs text-slate-600 bg-slate-50 rounded-lg px-2.5 py-1.5">
                <span className="font-medium">{h.question}</span>
                {' → '}{h.suggestedUpdate}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {[
          { label: 'Реплики', value: review.totalTurns },
          { label: 'Avg latency', value: review.avgTurnLatencyMs ? `${review.avgTurnLatencyMs}ms` : null },
          { label: 'Avg confidence', value: review.avgConfidence !== null ? `${Math.round((review.avgConfidence ?? 0) * 100)}%` : null },
          { label: 'Fallbacks', value: review.fallbackCount },
          { label: 'Длительность', value: review.durationSeconds ? `${review.durationSeconds}с` : null },
          { label: 'Transfer', value: review.transferOutcome },
        ].map(({ label, value }) =>
          value !== null && value !== undefined ? (
            <div key={label} className="bg-slate-50 rounded-lg px-2 py-1.5">
              <div className="text-slate-400">{label}</div>
              <div className="font-medium text-slate-700">{String(value)}</div>
            </div>
          ) : null,
        )}
      </div>

      {/* Operator review */}
      <div className="border-t border-slate-100 pt-4">
        <div className="text-xs font-semibold text-slate-500 mb-2">Оценка оператора</div>

        {/* Star rating */}
        <div className="flex items-center gap-1 mb-3">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star === rating ? 0 : star)}
              className={cn(
                'text-xl transition-colors',
                star <= (rating || review.qualityRating || 0) ? 'text-amber-400' : 'text-slate-200',
              )}
            >
              ★
            </button>
          ))}
          {(rating || review.qualityRating) ? (
            <span className="text-xs text-slate-400 ml-1">
              {STAR_LABELS[(rating || review.qualityRating) ?? 0]}
            </span>
          ) : null}
        </div>

        <textarea
          value={note || review.reviewerNote || ''}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Заметки оператора…"
          rows={3}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
        />

        <div className="flex items-center gap-2 mt-2">
          <select
            value={review.status}
            onChange={(e) =>
              mutation.mutate({ status: e.target.value as ReviewStatus })
            }
            className="h-8 rounded-lg border border-slate-200 px-2 text-xs text-slate-700 focus:outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>

          <Button
            size="sm"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                reviewerNote: note || undefined,
                qualityRating: rating || undefined,
              })
            }
          >
            {mutation.isPending ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </div>
      </div>
    </div>
  );
}
