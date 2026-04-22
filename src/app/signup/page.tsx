import { Suspense } from 'react';
import { SignupClient } from './SignupClient';

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <SignupClient />
    </Suspense>
  );
}
