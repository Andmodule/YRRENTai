'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CHAT_FRAME } from '@/components/inbox/inbox-ui-tokens';
import { useUiStore } from '@/stores/ui.store';

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
  const isList = variant === 'list';

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
      {right != null ? (
        <div className="relative z-10 ml-auto shrink-0">{right}</div>
      ) : (
        <div className="relative z-10 ml-auto h-10 w-10 shrink-0" aria-hidden />
      )}
    </header>
  );
}
