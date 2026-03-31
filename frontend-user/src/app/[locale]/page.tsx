import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

type Locale = (typeof routing.locales)[number];

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: '/login', locale: locale as Locale });
}
