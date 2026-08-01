import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { LoginClient } from './LoginClient';

export default async function LoginPage() {
  // Already signed in? Skip the login form entirely and go to the dashboard.
  // This is what makes `/login` a fast, safe entry point for the native app:
  // returning owners land straight on the dashboard, first-timers see the form.
  const user = await getSessionUser();
  if (user) redirect('/dashboard');

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
