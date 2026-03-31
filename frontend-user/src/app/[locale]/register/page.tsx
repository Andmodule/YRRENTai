import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AuthSplitLayout } from '@/components/auth/auth-split-layout';
import { RegisterForm } from '@/components/auth/register-form';

export default async function RegisterPage() {
  const t = await getTranslations('auth');

  return (
    <AuthSplitLayout>
      <div className="mb-8 text-center lg:text-left">
        <h2 className="text-3xl font-bold text-white">{t('registerTitle')}</h2>
      </div>

      <RegisterForm />

      <p className="mt-8 text-center text-sm text-slate-400">
        <Link
          href="/login"
          className="font-medium text-blue-400 transition-colors hover:text-blue-300"
        >
          {t('goLogin')}
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
