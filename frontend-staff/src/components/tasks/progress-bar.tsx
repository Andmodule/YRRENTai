interface ProgressBarProps {
  done: number;
  total: number;
}

export function ProgressBar({ done, total }: ProgressBarProps) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const trackClass =
    pct >= 100
      ? 'from-emerald-400 to-teal-600'
      : pct >= 50
        ? 'from-teal-400 to-teal-600'
        : 'from-sky-400 to-teal-500';

  return (
    <div className="mt-4">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Выполнено ${done} из ${total}`}
        className="h-3 w-full overflow-hidden rounded-full bg-slate-200/90 shadow-inner"
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ease-out ${trackClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-slate-600">
          {done} из {total} выполнено
        </p>
        {total > 0 && (
          <span className="text-xs font-semibold tabular-nums text-teal-700">{pct}%</span>
        )}
      </div>
    </div>
  );
}
