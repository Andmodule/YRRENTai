'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';

import type { StaffVoiceMode } from './staff-voice-types';

const ACCENT = 'border-teal-600 bg-white text-teal-700 shadow-sm';

type Step = { n: number; title: string; subtitle?: string; hint: string };

const TASK_STEPS: Step[] = [
  {
    n: 1,
    title: 'Тип',
    hint: 'Режим «Задача»: прогресс и снабжение. Если параллельно поломка или ущерб — скажите и это (инцидент добавится к отчёту).',
  },
  {
    n: 2,
    title: 'Статус задачи',
    hint: 'Явно: готово, в процессе, ещё не начинал(а) или есть проблема (issue).',
  },
  {
    n: 3,
    title: 'Что сделали',
    hint: 'Коротко факт работ по объекту.',
  },
  {
    n: 4,
    title: 'Довоз или замена',
    subtitle: 'если актуально',
    hint: 'Используйте формулировки «Нужно довезти …» или «Нужно заменить …» с нужными падежами (например: нужно довезти полотенца; нужно заменить лампочку в коридоре).',
  },
  {
    n: 5,
    title: 'Поломка и инцидент',
    hint: 'Если что-то сломано, залито, украдено — опишите; блок инцидента заполнится вместе с задачей.',
  },
];

const INCIDENT_STEPS: Step[] = [
  {
    n: 1,
    title: 'Тип',
    hint: 'Режим «Инцидент»: что произошло. Если это только отчёт по работе — скажите, система выберет смешанный режим.',
  },
  {
    n: 2,
    title: 'Что случилось',
    hint: 'Суть проблемы одной-двумя фразами.',
  },
  {
    n: 3,
    title: 'Где именно',
    hint: 'Комната, зона, объект — чтобы менеджер понял локацию.',
  },
  {
    n: 4,
    title: 'Срочность',
    hint: 'Насколько срочно: вода, безопасность гостей, мелкий дефект.',
  },
  {
    n: 5,
    title: 'Довоз / замена',
    subtitle: 'если нужно',
    hint: 'Те же формулировки: «Нужно довезти …», «Нужно заменить …» — с падежами.',
  },
];

export const StaffVoiceInfographic = memo(function StaffVoiceInfographic({
  mode,
  className,
  voiceEmphasis = 'task',
}: {
  mode: StaffVoiceMode;
  className?: string;
  /** Режим «Инцидент»: подсказки внизу про повреждение, без акцента на статусе уборки. */
  voiceEmphasis?: 'task' | 'incident';
}) {
  const steps = useMemo(() => (mode === 'TASK' ? TASK_STEPS : INCIDENT_STEPS), [mode]);

  return (
    <div className={cn('w-full', className)}>
      <ol className="space-y-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const subtitle = step.subtitle?.trim();
          return (
            <li key={step.n} className="flex gap-2">
              <div className="flex w-7 shrink-0 flex-col items-center self-stretch">
                <div
                  className={cn(
                    'z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold leading-none',
                    ACCENT,
                  )}
                  aria-hidden
                >
                  {step.n}
                </div>
                {!isLast ? (
                  <div className="flex min-h-[4px] flex-1 justify-center pt-0.5" aria-hidden>
                    <div className="w-px flex-1 bg-gradient-to-b from-teal-600/45 to-teal-600/15" />
                  </div>
                ) : null}
              </div>
              <div className={cn('min-w-0 flex-1 space-y-0', !isLast ? 'pb-1.5' : '')}>
                <p className="text-[12px] font-semibold leading-tight text-slate-900">{step.title}</p>
                {subtitle ? (
                  <p className="text-[10px] leading-snug text-slate-600/90">{subtitle}</p>
                ) : null}
                <p className="text-[10px] leading-snug text-slate-600/85">{step.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 border-t border-slate-200/80 pt-2">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Подсказки</p>
        <p className="mt-1 text-[10px] leading-snug text-slate-600/90">
          {voiceEmphasis === 'incident'
            ? 'Это сообщение для менеджера о проблеме. Отдельную задачу на довоз вы не создаёте — при необходимости менеджер решит по инциденту. Если нужен довоз или замена, скажите отдельно фразами «Нужно довезти …» / «Нужно заменить …».'
            : 'Сначала статус и факт работ, затем — отдельно довоз/замена фиксированными словами «Нужно довезти» / «Нужно заменить».'}
        </p>
      </div>
    </div>
  );
});
