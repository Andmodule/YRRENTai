'use client';

import { useSWRConfig } from 'swr';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { mutate } = useSWRConfig();

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } finally {
      await mutate('auth/me', undefined, { revalidate: false });
      router.replace('/login');
    }
  };

  return (
    <Button type="button" variant="outline" onClick={handleLogout}>
      {t('logout')}
    </Button>
  );
}
