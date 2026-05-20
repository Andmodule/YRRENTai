'use client';

import { useState, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Unlink } from 'lucide-react';
import {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalContent,
  ResponsiveModalClose,
} from '@/components/ui/responsive-modal';
import { Button } from '@/components/ui/button';

function apiErrorMessage(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: unknown } }).response?.data;
    if (data && typeof data === 'object' && data !== null) {
      const d = data as Record<string, unknown>;
      const m = d.message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m)) return m.filter((x) => typeof x === 'string').join(', ');
    }
  }
  if (e instanceof Error) return e.message;
  return undefined;
}

interface ClearOtaConfirmButtonProps {
  onClear: () => Promise<void>;
  trigger?: ReactElement;
}

export function ClearOtaConfirmButton({ onClear, trigger }: ClearOtaConfirmButtonProps) {
  const t = useTranslations('properties');
  const tDetail = useTranslations('properties.detail');
  const [open, setOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  async function handleConfirm() {
    setIsClearing(true);
    try {
      await onClear();
      toast.success(tDetail('clearOtaSuccess'));
      setOpen(false);
    } catch (e) {
      toast.error(apiErrorMessage(e) ?? tDetail('clearOtaError'));
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <ResponsiveModal open={open} onOpenChange={setOpen}>
      <ResponsiveModalTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10"
            aria-label={tDetail('clearOtaAria')}
          >
            <Unlink className="mr-1.5 h-3.5 w-3.5" />
            {tDetail('clearOtaButton')}
          </Button>
        )}
      </ResponsiveModalTrigger>
      <ResponsiveModalContent
        title={tDetail('clearOtaTitle')}
        description={tDetail('clearOtaDescription')}
      >
        <div className="flex justify-end gap-2">
          <ResponsiveModalClose asChild>
            <Button type="button" variant="outline" disabled={isClearing}>
              {t('form.cancel')}
            </Button>
          </ResponsiveModalClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={isClearing}
          >
            {isClearing ? tDetail('clearOtaInProgress') : tDetail('clearOtaConfirm')}
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
