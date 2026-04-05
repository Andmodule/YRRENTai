'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSWRConfig } from 'swr';
import { registerSchema } from '@rentai/shared';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authDarkInputClass } from '@/components/auth/auth-field-styles';
import type { AuthUser } from '@/hooks/use-auth';

type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      companyName: '',
    },
  });

  const onSubmit = async (values: RegisterValues) => {
    try {
      await apiClient.post<{ data: AuthUser }>('/auth/register', values);
      await mutate('auth/me');
      toast.success(t('registerSuccess'));
      router.replace('/dashboard');
    } catch {
      toast.error(t('registerError'));
    }
  };

  const field = (hasError: boolean) => authDarkInputClass(hasError);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex w-full flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className="mb-1.5 block text-sm font-medium text-slate-200">
            {t('firstName')}
          </label>
          <Input
            id="firstName"
            autoComplete="given-name"
            className={field(!!errors.firstName)}
            aria-invalid={!!errors.firstName}
            {...register('firstName')}
          />
          {errors.firstName && (
            <p className="mt-1 text-xs text-red-400">{errors.firstName.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="lastName" className="mb-1.5 block text-sm font-medium text-slate-200">
            {t('lastName')}
          </label>
          <Input
            id="lastName"
            autoComplete="family-name"
            className={field(!!errors.lastName)}
            aria-invalid={!!errors.lastName}
            {...register('lastName')}
          />
          {errors.lastName && (
            <p className="mt-1 text-xs text-red-400">{errors.lastName.message}</p>
          )}
        </div>
      </div>
      <div>
        <label htmlFor="companyName" className="mb-1.5 block text-sm font-medium text-slate-200">
          {t('companyName')}
        </label>
        <Input
          id="companyName"
          autoComplete="organization"
          placeholder={t('companyNamePlaceholder')}
          className={field(!!errors.companyName)}
          aria-invalid={!!errors.companyName}
          {...register('companyName')}
        />
        {errors.companyName && (
          <p className="mt-1 text-xs text-red-400">{errors.companyName.message}</p>
        )}
      </div>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-200">
          {t('email')}
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
          className={field(!!errors.email)}
          aria-invalid={!!errors.email}
          {...register('email')}
        />
        {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email.message}</p>}
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-200">
          {t('password')}
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
          className={field(!!errors.password)}
          aria-invalid={!!errors.password}
          {...register('password')}
        />
        {errors.password && (
          <p className="mt-1 text-xs text-red-400">{errors.password.message}</p>
        )}
      </div>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="mt-2 flex h-auto w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-base font-medium text-white shadow-sm shadow-blue-600/25 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
            {t('submitting')}
          </>
        ) : (
          t('registerSubmit')
        )}
      </Button>
    </form>
  );
}
