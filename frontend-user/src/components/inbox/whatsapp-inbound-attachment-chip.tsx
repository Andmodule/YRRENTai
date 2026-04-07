'use client';

import { File, FileText, Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WhatsappInboundMessageMetadata } from '@rentai/shared';
import { cn } from '@/lib/utils';

interface WhatsappInboundAttachmentChipProps {
  messageId: string;
  meta: WhatsappInboundMessageMetadata;
  className?: string;
}

export function WhatsappInboundAttachmentChip({
  messageId,
  meta,
  className,
}: WhatsappInboundAttachmentChipProps) {
  const t = useTranslations('inbox');
  if (!meta.storageKey) {
    return (
      <p className="text-xs text-primary-foreground/70 dark:text-zinc-400">
        {t('whatsappMediaUnavailable')}
      </p>
    );
  }

  const label = meta.fileName || meta.waType || 'file';
  const ct = (meta.mimeType ?? '').toLowerCase();
  const icon =
    ct.includes('pdf') ? (
      <FileText className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
    ) : ct.startsWith('image/') ? (
      <ImageIcon className="h-4 w-4 shrink-0 text-sky-500" aria-hidden />
    ) : (
      <File className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    );

  return (
    <a
      href={`/api/v1/chats/messages/${encodeURIComponent(messageId)}/whatsapp-file`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-left transition-colors hover:bg-primary-foreground/15 dark:border-zinc-600 dark:bg-zinc-800/80 dark:hover:bg-zinc-800',
        className,
      )}
      title={label}
      aria-label={t('whatsappAttachmentOpenAria', { name: label })}
    >
      {icon}
      <span className="truncate text-sm font-medium">{label}</span>
    </a>
  );
}
