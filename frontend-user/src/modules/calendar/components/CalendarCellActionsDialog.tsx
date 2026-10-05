'use client';

import { useTranslations } from 'next-intl';
import { CalendarPlus, Coins, Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveModal,
  ResponsiveModalContent,
} from '@/components/ui/responsive-modal';

interface CalendarCellActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyTitle?: string;
  dayLabel?: string;
  onNewBooking: () => void;
  onSetOtaPrice: () => void;
  /** «Цены → Скидки» enabled: discount for this property and day. */
  onSetDiscount?: () => void;
}

export function CalendarCellActionsDialog({
  open,
  onOpenChange,
  propertyTitle,
  dayLabel,
  onNewBooking,
  onSetOtaPrice,
  onSetDiscount,
}: CalendarCellActionsDialogProps) {
  const t = useTranslations('calendar.cellActions');

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent
        title={t('title')}
        description={
          propertyTitle || dayLabel
            ? [propertyTitle, dayLabel].filter(Boolean).join(' · ')
            : t('description')
        }
      >
        <div className="grid gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-11 justify-start gap-2"
            onClick={() => {
              onOpenChange(false);
              onNewBooking();
            }}
          >
            <CalendarPlus className="h-4 w-4" />
            {t('newBooking')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-11 justify-start gap-2"
            onClick={() => {
              onOpenChange(false);
              onSetOtaPrice();
            }}
          >
            <Coins className="h-4 w-4" />
            {t('setOtaPrice')}
          </Button>
          {onSetDiscount ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 justify-start gap-2 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
              onClick={() => {
                onOpenChange(false);
                onSetDiscount();
              }}
            >
              <Percent className="h-4 w-4" />
              <span className="flex-1 text-left">{t('setDiscount')}</span>
              <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                {t('newBadge')}
              </span>
            </Button>
          ) : null}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
