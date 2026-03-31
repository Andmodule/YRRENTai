'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSWRConfig } from 'swr';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { authDarkInputClass } from '@/components/auth/auth-field-styles';
import type { AuthUser } from '@/hooks/use-auth';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [showPassword, setShowPassword] = useState(false);

  const loginSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(t('emailInvalid')),
        password: z.string().min(8, t('passwordMin')).max(128, t('passwordMax')),
      }),
    [t],
  );

  type LoginValues = z.infer<typeof loginSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginValues) => {
    try {
      await apiClient.post<{ data: AuthUser }>('/auth/login', values);
      await mutate('auth/me');
      toast.success(t('loginSuccess'));
      router.replace('/dashboard');
    } catch {
      toast.error(t('loginError'));
    }
  };

  const inputClass = (hasError: boolean) => authDarkInputClass(hasError);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="w-full space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-slate-200">
          {t('email')}
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'email-error' : undefined}
          className={inputClass(!!errors.email)}
          {...register('email')}
        />
        {errors.email && (
          <p id="email-error" className="mt-1 text-xs text-red-400">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="password" className="text-sm font-medium text-slate-200">
            {t('password')}
          </label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
          >
            {t('forgotPassword')}
          </Link>
        </div>
        <div className="relative">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t('passwordPlaceholder')}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            className={cn(inputClass(!!errors.password), 'pr-11')}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-200"
            aria-label={showPassword ? t('hidePassword') : t('showPassword')}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {errors.password && (
          <p id="password-error" className="mt-1 text-xs text-red-400">
            {errors.password.message}
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        className="mt-4 flex h-auto w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-base font-medium text-white shadow-sm shadow-blue-600/25 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
            {t('loginSubmitLoading')}
          </>
        ) : (
          t('loginSubmitPanel')
        )}
      </Button>
    </form>
  );
}
