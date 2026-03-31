import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { Sparkles } from 'lucide-react';

export const metadata: Metadata = { title: 'Вход — RentAI Staff' };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* декоративные пятна */}
      <div
        className="pointer-events-none absolute -left-24 top-20 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-sky-400/15 blur-3xl"
        aria-hidden
      />

      <div className="relative z-10 w-full max-w-[400px] animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-2xl font-bold text-white shadow-lg shadow-teal-600/30">
            R
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-teal-800 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Персонал
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            RentAI Staff
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Вход в мобильное приложение для смены: задачи на сегодня, статусы и фото.
          </p>
        </div>
        <LoginForm />
        <p className="mt-8 text-center text-xs text-slate-500">
          Доступ только для аккаунтов с ролью Staff
        </p>
      </div>
    </div>
  );
}
