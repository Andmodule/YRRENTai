import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { RegisterForm } from '@/components/auth/register-form';

export default async function RegisterPage() {
  const t = await getTranslations('auth');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="mb-8 text-center text-2xl font-semibold">{t('registerTitle')}</h1>
        <RegisterForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary underline underline-offset-4">
            {t('goLogin')}
          </Link>
        </p>
      </div>
    </main>
  );
}
