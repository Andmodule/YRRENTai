import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AuthSplitLayout } from '@/components/auth/auth-split-layout';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage() {
  const t = await getTranslations('auth');

  return (
    <AuthSplitLayout>
      <div className="mb-8">
        <h2 className="mb-2 text-3xl font-bold text-white">{t('loginWelcome')}</h2>
        <p className="text-slate-400">{t('loginSubtitle')}</p>
      </div>

      <LoginForm />

      <p className="mt-8 text-center text-sm text-slate-400">
        <Link
          href="/register"
          className="font-medium text-blue-400 transition-colors hover:text-blue-300"
        >
          {t('goRegister')}
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
