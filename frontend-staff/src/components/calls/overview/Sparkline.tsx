import { cn } from '@/lib/utils';

interface SparklineProps {
  values: (number | null)[];
  color?: 'teal' | 'amber' | 'red' | 'slate';
  height?: number;
  className?: string;
}

export function Sparkline({ values, color = 'teal', height = 32, className }: SparklineProps) {
  const clean = values.filter((v): v is number => v !== null);
  if (clean.length < 2) {
    return <div className={cn('flex items-end gap-px', className)} style={{ height }} />;
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;

  const W = 80;
  const H = height;
  const step = W / (values.length - 1);

  const pts = values
    .map((v, i) => {
      if (v === null) return null;
      const x = i * step;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x},${y}`;
    })
    .filter(Boolean);

  const polyline = pts.join(' ');

  const strokeColor = {
    teal:  '#0d9488',
    amber: '#d97706',
    red:   '#dc2626',
    slate: '#94a3b8',
  }[color];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <polyline
        points={polyline}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}
