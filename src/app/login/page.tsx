import { Suspense } from 'react';
import { LoginClient } from './LoginClient';

export default function LoginPage() {
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
