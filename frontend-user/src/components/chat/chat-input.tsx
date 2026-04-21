'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  /** Overrides default chat.inputPlaceholder */
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const t = useTranslations('chat');
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? t('inputPlaceholder')}
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-input bg-input-fill px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        style={{ minHeight: 48, maxHeight: 120 }}
        onInput={(e) => {
          const target = e.target as HTMLTextAreaElement;
          target.style.height = '48px';
          target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
        }}
      />
      <Button
        type="submit"
        variant="ghost"
        disabled={disabled || !value.trim()}
        size="icon"
        className={cn(
          'h-12 w-12 shrink-0 rounded-lg border border-transparent p-0',
          'bg-muted text-primary hover:border-primary/25 hover:bg-primary/10 hover:text-primary',
          'dark:bg-[#0d1421] dark:text-[#00d4ff] dark:hover:border-[#00d4ff]/20 dark:hover:bg-[#00d4ff]/10',
        )}
      >
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
