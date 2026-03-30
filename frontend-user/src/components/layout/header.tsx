'use client';

import { Menu, LogOut, User } from 'lucide-react';
import { useUiStore } from '@/stores/ui.store';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function Header() {
  const { toggleSidebar } = useUiStore();
  const { user, mutate } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    try {
      await apiClient.post('/auth/logout');
      await mutate(undefined, false);
      router.replace('/login');
    } catch {
      toast.error('Logout failed');
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b bg-background px-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="lg:hidden"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex-1" />

      {user && (
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden flex-col md:flex">
              <span className="text-sm font-medium leading-none">
                {user.firstName} {user.lastName}
              </span>
              <span className="mt-0.5 text-xs text-muted-foreground">{user.email}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      )}
    </header>
  );
}
