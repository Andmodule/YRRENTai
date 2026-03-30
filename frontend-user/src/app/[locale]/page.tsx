import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function HomePage() {
  const t = await getTranslations('home');
  const ta = await getTranslations('auth');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-4xl font-bold tracking-tight">{t('title')}</h1>
      <p className="text-lg text-muted-foreground">{t('subtitle')}</p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/login"
          className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          {ta('loginTitle')}
        </Link>
        <Link
          href="/register"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {ta('registerTitle')}
        </Link>
        <Link href="/dashboard" className="text-sm text-muted-foreground underline">
          {t('goDashboard')}
        </Link>
      </div>
    </main>
  );
}
