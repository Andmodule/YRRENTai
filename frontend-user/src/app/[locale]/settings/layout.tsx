import { AppShell } from '@/components/layout';
import { SettingsSubLayout } from '@/components/settings/settings-sub-layout';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <SettingsSubLayout>{children}</SettingsSubLayout>
    </AppShell>
  );
}
