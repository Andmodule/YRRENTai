import { AdminLoginForm } from '@/components/auth/admin-login-form';
import { LoginRedirectIfSuperadmin } from '@/components/auth/login-redirect-if-superadmin';

export default function AdminLoginPage() {
  return (
    <LoginRedirectIfSuperadmin>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 p-6 text-zinc-100">
        <div className="text-center">
          <h1 className="text-xl font-semibold">RentAI Admin</h1>
          <p className="mt-2 max-w-md text-sm text-zinc-400">
            Sign in with a <strong className="text-zinc-300">SUPERADMIN</strong> account. Session cookie is set for this
            admin origin only (e.g. :3001), separate from the main app.
          </p>
        </div>
        <AdminLoginForm />
      </main>
    </LoginRedirectIfSuperadmin>
  );
}
