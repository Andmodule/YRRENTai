'use client';

import { Building2, Home, Mail, MessageCircle, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Backend `conversations.channel` (ConversationChannel). */
export function ConversationChannelBadge({
  channel,
  className,
}: {
  channel: string;
  className?: string;
}) {
  const t = useTranslations('inbox');

  const cfg = (() => {
    switch (channel) {
      case 'whatsapp':
        return {
          label: t('channelWhatsapp'),
          icon: <MessageCircle className="h-3.5 w-3.5" aria-hidden />,
          className: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30',
        };
      case 'telegram':
        return {
          label: t('channelTelegram'),
          icon: <Send className="h-3.5 w-3.5" aria-hidden />,
          className: 'bg-sky-500/15 text-sky-900 dark:text-sky-100 border-sky-500/30',
        };
      case 'email':
        return {
          label: t('channelEmail'),
          icon: <Mail className="h-3.5 w-3.5" aria-hidden />,
          className: 'bg-violet-500/12 text-violet-900 dark:text-violet-100 border-violet-500/25',
        };
      case 'booking_com':
        return {
          label: t('channelBooking'),
          icon: <Building2 className="h-3.5 w-3.5" aria-hidden />,
          className: 'bg-amber-500/12 text-amber-950 dark:text-amber-100 border-amber-500/25',
        };
      case 'web_app':
        return {
          label: t('channelWebApp'),
          icon: <Home className="h-3.5 w-3.5" aria-hidden />,
          className: 'bg-slate-500/10 text-slate-800 dark:text-slate-200 border-slate-500/20',
        };
      default:
        return {
          label: channel,
          icon: null,
          className: 'bg-muted text-muted-foreground border-border',
        };
    }
  })();

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        cfg.className,
        className,
      )}
      title={cfg.label}
    >
      {cfg.icon}
      <span className="max-w-[5.5rem] truncate">{cfg.label}</span>
    </span>
  );
}
