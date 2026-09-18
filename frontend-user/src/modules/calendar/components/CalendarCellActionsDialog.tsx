'use client';

import { useTranslations } from 'next-intl';
import { CalendarPlus, Coins } from 'lucide-react';
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
}

export function CalendarCellActionsDialog({
  open,
  onOpenChange,
  propertyTitle,
  dayLabel,
  onNewBooking,
  onSetOtaPrice,
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
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
