import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage() {
  const t = await getTranslations('auth');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="mb-8 text-center text-2xl font-semibold">{t('loginTitle')}</h1>
        <LoginForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/register" className="font-medium text-primary underline underline-offset-4">
            {t('goRegister')}
          </Link>
        </p>
      </div>
    </main>
  );
}
