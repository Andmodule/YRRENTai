import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Toaster } from 'sonner';
import { routing } from '@/i18n/routing';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { PwaRegister } from '@/components/pwa-register';
import { ThemeColorSync } from '@/components/theme-color-sync';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'RentAI — Dashboard',
  description: 'AI-powered rental property management dashboard',
  manifest: '/manifest.json?v=2',
  appleWebApp: {
    capable: true,
    title: 'RentAI',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages({ locale });

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <PwaRegister />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange={false}>
          <ThemeColorSync />
          <QueryProvider>
            <NextIntlClientProvider locale={locale} messages={messages}>
              <Suspense fallback={null}>
                <Toaster richColors theme="system" position="top-center" />
              </Suspense>
              {children}
            </NextIntlClientProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
