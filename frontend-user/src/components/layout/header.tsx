'use client';

import { Menu, LogOut, User } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useUiStore } from '@/stores/ui.store';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api/client';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function Header() {
  const pathname = usePathname();
  const isChat = pathname?.includes('/chat');
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
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4',
        'border-b border-slate-200 bg-background/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/85',
        'px-6',
        isChat && 'hidden lg:flex',
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="lg:hidden text-slate-400 hover:text-white hover:bg-slate-800"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <div className="flex-1" />

      {user && (
        <div className="flex items-center gap-2">
          {/* User info */}
          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 border border-primary/20 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden flex-col md:flex">
              <span className="text-sm font-medium leading-none text-slate-200">
                {user.firstName} {user.lastName}
              </span>
              <span className="mt-0.5 text-xs text-slate-500">{user.email}</span>
            </div>
          </div>

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Logout */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            aria-label="Sign out"
            className="text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      )}
    </header>
  );
}
