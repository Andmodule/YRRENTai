import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { APP_SHELL_GRADIENT } from '@/components/layout/shell-background';

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=2000&auto=format&fit=crop';

type AuthSplitLayoutProps = {
  children: ReactNode;
};

/** Split auth screen: left hero (desktop), right form. Same gradient as AppShell. */
export async function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  const t = await getTranslations('auth');

  return (
    <div className={cn('flex min-h-screen w-full', APP_SHELL_GRADIENT)}>
      <div className="relative hidden overflow-hidden bg-gray-900 lg:flex lg:w-1/2">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-overlay"
          style={{ backgroundImage: `url('${HERO_IMAGE}')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-gray-900/20 to-transparent" />

        <div className="relative z-10 flex h-full w-full flex-col justify-between p-12">
          <div className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xl font-bold">
              R
            </div>
            <span className="text-2xl font-bold tracking-tight">{t('brandName')}</span>
          </div>

          <div className="max-w-md">
            <h1 className="mb-6 text-4xl font-bold leading-tight text-white">
              {t('loginHeroHeading')}
            </h1>
            <p className="text-lg text-gray-300">{t('loginHeroBody')}</p>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-screen flex-1 flex-col">
        {/* Mobile / tablet: brand pinned top-right (same on login, register, forgot-password) */}
        <div className="pointer-events-none fixed right-4 top-4 z-40 sm:right-6 sm:top-6 lg:hidden">
          <div className="pointer-events-auto flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xl font-bold text-white">
              R
            </div>
            <span className="text-2xl font-bold tracking-tight">{t('brandName')}</span>
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-center px-6 pb-12 pt-16 sm:px-12 sm:pt-20 lg:py-12">
          <div className="mx-auto w-full max-w-[440px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
