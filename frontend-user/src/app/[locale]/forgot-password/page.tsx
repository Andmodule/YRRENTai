import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AuthSplitLayout } from '@/components/auth/auth-split-layout';

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');

  return (
    <AuthSplitLayout>
      <div className="mb-8 text-center lg:text-left">
        <h2 className="mb-3 text-3xl font-bold text-white">{t('forgotPasswordTitle')}</h2>
        <p className="text-slate-400">{t('forgotPasswordDescription')}</p>
      </div>

      <p className="text-center text-sm lg:text-left">
        <Link
          href="/login"
          className="font-medium text-blue-400 transition-colors hover:text-blue-300"
        >
          {t('forgotPasswordBack')}
        </Link>
      </p>
    </AuthSplitLayout>
  );
}
