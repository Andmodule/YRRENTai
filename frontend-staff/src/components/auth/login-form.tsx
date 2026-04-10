'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSWRConfig } from 'swr';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const loginSchema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов').max(128),
});

type LoginValues = z.infer<typeof loginSchema>;

type LoginFormProps = {
  /**
   * Встроено в TelegramStaffGate: без редиректа — родитель переключает экран по SWR после входа.
   * Иначе двойной router.replace (onSubmit + useEffect) ломал клиент в dev (Turbopack).
   */
  embedded?: boolean;
};

export function LoginForm({ embedded = false }: LoginFormProps = {}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { isAuthenticated, isStaff, isLoading } = useAuth();
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (embedded) return;
    if (!isLoading && isAuthenticated && isStaff) {
      router.replace('/tasks');
    }
  }, [embedded, isAuthenticated, isStaff, isLoading, router]);

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
      await apiClient.post('/auth/login', values);
      const user = await mutate('staff-auth/me');
      if (user?.role !== 'STAFF') {
        try { await apiClient.post('/auth/logout'); } catch { /* ignore */ }
        await mutate('staff-auth/me', null, { revalidate: false });
        toast.error('Этот вход только для персонала. Обратитесь к администратору.');
        return;
      }
      toast.success('Добро пожаловать!');
    } catch {
      toast.error('Неверный email или пароль');
    }
  };

  return (
    <div className="staff-card rounded-2xl p-6 sm:p-7">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="staff@example.com"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          {errors.email && (
            <p className="text-xs text-red-600">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium text-gray-700">
            Пароль
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pr-11"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600"
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-red-600">{errors.password.message}</p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} size="lg" className="mt-2 w-full">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Вход…
            </>
          ) : (
            'Войти'
          )}
        </Button>
      </form>
    </div>
  );
}
