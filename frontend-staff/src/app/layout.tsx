import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Toaster } from 'sonner';
import { Providers } from '@/components/providers';
import './globals.css';

const staffThemeBootScript = `(function(){try{var t=localStorage.getItem('rentai.staff.theme');if(t==='dark')document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'RentAI Staff',
  description: 'RentAI — приложение для персонала',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#0d9488',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="staff-app-bg min-h-screen antialiased">
        <Script id="staff-theme-boot" strategy="beforeInteractive">
          {staffThemeBootScript}
        </Script>
        <Providers>
          <Toaster richColors position="top-center" />
          {children}
        </Providers>
      </body>
    </html>
  );
}
