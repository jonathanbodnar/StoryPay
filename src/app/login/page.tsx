import { Suspense } from 'react';
import { getSessionUser } from '@/lib/session';
import { LoginClient } from './LoginClient';
import LoginRedirect from './LoginRedirect';

export default async function LoginPage() {
  // Already signed in? Skip the login form and go to the dashboard — but via
  // a CLIENT-side router.replace (see LoginRedirect), never a server
  // redirect(). The shipped native binary lacks `allowNavigation`, so an HTTP
  // redirect off /login gets bounced to the system browser (Chrome/Safari)
  // instead of staying inside the app webview.
  const user = await getSessionUser();
  if (user) return <LoginRedirect />;

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
