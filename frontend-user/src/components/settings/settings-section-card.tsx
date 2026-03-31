import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface SettingsSectionCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsSectionCard({ title, description, children, className }: SettingsSectionCardProps) {
  return (
    <section className={cn('rounded-xl border bg-card p-6 shadow-sm', className)}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}
