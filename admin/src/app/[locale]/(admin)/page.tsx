import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function AdminHomePage() {
  const t = useTranslations('home');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-lg text-muted-foreground">{t('subtitle')}</p>
      </div>
      <Link
        href="/integrations/zodomus"
        className="rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
      >
        Zodomus debug (SUPERADMIN)
      </Link>
    </main>
  );
}
