'use client';

import { File, FileText, Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { EmailInboundAttachment } from '@rentai/shared';
import { formatBytes } from '@/lib/utils/format-bytes';
import { cn } from '@/lib/utils';

interface EmailAttachmentChipProps {
  attachment: EmailInboundAttachment;
  className?: string;
}

export function EmailAttachmentChip({ attachment, className }: EmailAttachmentChipProps) {
  const t = useTranslations('inbox');

  const ct = attachment.contentType.toLowerCase();
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
      href={`/api/v1/messages/attachments/${encodeURIComponent(attachment.id)}/download`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-left transition-colors hover:bg-muted hover:border-muted-foreground/30',
        className,
      )}
      title={attachment.fileName}
      aria-label={t('attachmentOpenAria', { name: attachment.fileName })}
    >
      {icon}
      <span className="truncate text-sm font-medium text-foreground">{attachment.fileName}</span>
      <span className="shrink-0 text-xs text-muted-foreground">({formatBytes(attachment.sizeBytes)})</span>
    </a>
  );
}
