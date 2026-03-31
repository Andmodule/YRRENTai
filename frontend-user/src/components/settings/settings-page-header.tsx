import { Badge } from '@/components/ui/badge';

interface SettingsPageHeaderProps {
  title: string;
  subtitle?: string;
  /** Show orange dev badge next to the title (section not fully shipped). */
  dev?: boolean;
}

export function SettingsPageHeader({ title, subtitle, dev }: SettingsPageHeaderProps) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {dev ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase text-amber-500">
            dev
          </Badge>
        ) : null}
      </div>
      {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
