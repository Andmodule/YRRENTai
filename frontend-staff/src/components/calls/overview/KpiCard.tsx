import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string | number | null | undefined;
  subLabel?: string;
  icon: LucideIcon;
  color?: 'default' | 'teal' | 'amber' | 'red' | 'slate';
  isLoading?: boolean;
  pulse?: boolean;
  onClick?: () => void;
  sparkline?: React.ReactNode;
}

const COLOR_MAP = {
  default: { bg: 'bg-white', text: 'text-slate-800', icon: 'text-slate-400', ring: 'ring-slate-200' },
  teal:    { bg: 'bg-teal-50', text: 'text-teal-800', icon: 'text-teal-500', ring: 'ring-teal-100' },
  amber:   { bg: 'bg-amber-50', text: 'text-amber-800', icon: 'text-amber-500', ring: 'ring-amber-100' },
  red:     { bg: 'bg-red-50', text: 'text-red-800', icon: 'text-red-500', ring: 'ring-red-100' },
  slate:   { bg: 'bg-slate-50', text: 'text-slate-700', icon: 'text-slate-400', ring: 'ring-slate-200' },
};

export function KpiCard({ label, value, subLabel, icon: Icon, color = 'default', isLoading, pulse, onClick, sparkline }: KpiCardProps) {
  const c = COLOR_MAP[color];
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={cn(
        'relative rounded-2xl ring-1 p-4 flex flex-col gap-2 min-w-0 text-left w-full',
        c.bg,
        c.ring,
        pulse && 'ring-2',
        onClick && 'cursor-pointer hover:brightness-95 transition-all',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide truncate">{label}</span>
        <Icon className={cn('h-4 w-4 shrink-0', c.icon)} />
      </div>
      {isLoading ? (
        <Skeleton className="h-8 w-20 rounded-lg" />
      ) : (
        <span className={cn('text-2xl font-bold leading-none tabular-nums', c.text)}>
          {value ?? '—'}
        </span>
      )}
      {subLabel && !isLoading && (
        <span className="text-xs text-slate-400 truncate">{subLabel}</span>
      )}
      {sparkline && !isLoading && (
        <div className="mt-auto pt-1 opacity-70">{sparkline}</div>
      )}
    </Tag>
  );
}
