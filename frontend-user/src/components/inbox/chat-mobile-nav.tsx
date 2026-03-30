'use client';

import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CHAT_FRAME } from '@/components/inbox/inbox-ui-tokens';

interface ChatMobileNavProps {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  className?: string;
}

/** Full-width top bar for /chat on small screens (Telegram-style: back left). */
export function ChatMobileNav({ title, onBack, right, className }: ChatMobileNavProps) {
  return (
    <header
      className={cn(
        'z-30 flex h-14 shrink-0 items-center gap-2 bg-background px-2',
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
        className="shrink-0"
        onClick={onBack}
        aria-label="Back"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1 pr-2">
        <p className="truncate text-sm font-medium leading-tight">{title}</p>
      </div>
      {right != null ? <div className="shrink-0">{right}</div> : null}
    </header>
  );
}
