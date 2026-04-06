'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, Menu, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CHAT_FRAME } from '@/components/inbox/inbox-ui-tokens';
import { useUiStore } from '@/stores/ui.store';
import { useInboxSearchStore } from '@/stores/inbox-search.store';
import {
  tasksToolbarIconButtonBase,
  tasksToolbarIconButtonActive,
  tasksToolbarIconButtonIdle,
} from '@/modules/tasks/task-toolbar-icon-button-classes';

interface ChatMobileNavProps {
  title: string;
  /** Список диалогов: как «Задачи» — меню сайдбара. Открытый чат — стрелка «назад» к списку. */
  variant: 'list' | 'conversation';
  onBack: () => void;
  right?: ReactNode;
  className?: string;
}

/** Мобильная шапка /chat: в списке — бургер + заголовок (как Tasks); в диалоге — назад + гость. */
export function ChatMobileNav({ title, variant, onBack, right, className }: ChatMobileNavProps) {
  const { toggleSidebar } = useUiStore();
  const tTasks = useTranslations('tasks');
  const tInbox = useTranslations('inbox');
  const isList = variant === 'list';

  const query = useInboxSearchStore((s) => s.query);
  const searchOpen = useInboxSearchStore((s) => s.searchOpen);
  const setQuery = useInboxSearchStore((s) => s.setQuery);
  const setSearchOpen = useInboxSearchStore((s) => s.setSearchOpen);

  const searchActive = searchOpen || query.trim().length > 0;

  if (isList && searchOpen) {
    return (
      <header
        className={cn(
          'relative z-30 flex h-14 shrink-0 items-center gap-1 bg-background px-2 pt-[max(0.25rem,env(safe-area-inset-top))]',
          'max-lg:fixed max-lg:inset-x-0 max-lg:top-0',
          'lg:relative lg:hidden',
          CHAT_FRAME.b,
          'transition-all duration-200 animate-in fade-in slide-in-from-top-1',
          className,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 shrink-0 text-muted-foreground"
          onClick={() => setSearchOpen(false)}
          aria-label={tInbox('searchBackAria')}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Button>
        <input
          autoFocus
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          placeholder={tInbox('searchPlaceholder')}
          className="min-w-0 flex-1 bg-transparent py-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 text-muted-foreground"
            onClick={() => setQuery('')}
            aria-label={tInbox('clearSearchAria')}
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        ) : null}
      </header>
    );
  }

  return (
    <header
      className={cn(
        'relative z-30 flex h-14 shrink-0 items-center gap-2 bg-background px-2 pt-[max(0.25rem,env(safe-area-inset-top))]',
        'max-lg:fixed max-lg:inset-x-0 max-lg:top-0',
        'lg:relative lg:hidden',
        CHAT_FRAME.b,
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative z-10 h-10 w-10 shrink-0 text-muted-foreground"
        onClick={isList ? toggleSidebar : onBack}
        aria-label={isList ? tTasks('mobileHeader.menuAria') : 'Back'}
      >
        {isList ? <Menu className="h-6 w-6" aria-hidden /> : <ArrowLeft className="h-5 w-5" aria-hidden />}
      </Button>
      <h1
        className="absolute left-1/2 top-1/2 z-0 max-w-[min(18rem,calc(100%-7rem))] -translate-x-1/2 -translate-y-1/2 truncate text-center text-lg font-semibold tracking-tight text-foreground"
        title={title}
      >
        {title}
      </h1>
      {isList ? (
        <div className="relative z-10 ml-auto shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              tasksToolbarIconButtonBase,
              searchActive ? tasksToolbarIconButtonActive : tasksToolbarIconButtonIdle,
            )}
            aria-label={tInbox('searchToggleAria')}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      ) : right != null ? (
        <div className="relative z-10 ml-auto shrink-0">{right}</div>
      ) : (
        <div className="relative z-10 ml-auto h-10 w-10 shrink-0" aria-hidden />
      )}
    </header>
  );
}
