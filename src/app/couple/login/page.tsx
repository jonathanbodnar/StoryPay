import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export default function CoupleLoginPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-gray-500">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
