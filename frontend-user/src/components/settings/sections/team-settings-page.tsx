'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SettingsSectionCard } from '@/components/settings/settings-section-card';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { ConfirmDestructiveDialog } from '@/components/settings/confirm-destructive-dialog';

export function TeamSettingsPage() {
  const t = useTranslations('settings.team');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('manager');

  return (
    <div className="space-y-4">
      <SettingsPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} dev />

      <p className="text-sm text-muted-foreground">{t('stubHint')}</p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setInviteOpen(true)}>
          {t('invite')}
        </Button>
      </div>

      <SettingsSectionCard title={t('membersCard')}>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-4 py-2 font-medium">{t('tableName')}</th>
                <th className="px-4 py-2 font-medium">{t('tableEmail')}</th>
                <th className="px-4 py-2 font-medium">{t('tableRole')}</th>
                <th className="px-4 py-2 font-medium">{t('tableStatus')}</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="px-4 py-3">{t('mockName')}</td>
                <td className="px-4 py-3">{t('mockEmail')}</td>
                <td className="px-4 py-3">manager</td>
                <td className="px-4 py-3">{t('statusActive')}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => toast.info(t('stubHint'))}>
                      {t('changeRole')}
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => setRemoveOpen(true)}>
                      {t('removeMember')}
                    </Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SettingsSectionCard>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent title={t('inviteTitle')} description={t('inviteHint')}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">{t('inviteEmail')}</Label>
              <Input
                id="inv-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('inviteEmailPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-role">{t('inviteRole')}</Label>
              <Select id="inv-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="manager">{t('roleManager')}</option>
                <option value="staff">{t('roleStaff')}</option>
              </Select>
            </div>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => {
                toast.info(t('inviteNotReady'));
                setInviteOpen(false);
              }}
            >
              {t('sendInvite')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('removeTitle')}
        description={t('removeDescription')}
        confirmLabel={t('removeMember')}
        onConfirm={() => toast.info(t('inviteNotReady'))}
      />
    </div>
  );
}
