'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

type Values = z.infer<typeof schema>;

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export function AdminLoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: Values) => {
    try {
      await apiClient.post<{ data: AuthUser }>('/auth/login', values);
      const me = await apiClient.get<{ data: AuthUser }>('/users/me');
      const role = me.data.data?.role;
      if (role !== 'SUPERADMIN') {
        await apiClient.post('/auth/logout');
        toast.error('Access denied. This account must have SUPERADMIN role.');
        return;
      }
      toast.success('Signed in');
      router.replace('/');
    } catch {
      toast.error('Invalid email or password');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="w-full max-w-sm space-y-4">
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm text-zinc-400">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          {...register('email')}
        />
        {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm text-zinc-400">
          Password
        </label>
        <input
          id="password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          {...register('password')}
        />
        {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {showPassword ? 'Hide' : 'Show'} password
        </button>
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          'Sign in to Admin'
        )}
      </button>
    </form>
  );
}
