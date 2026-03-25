'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const msg = searchParams.get('msg') || 'An unexpected error occurred';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="font-heading text-2xl text-brand-900 mb-3">Something Went Wrong</h1>
        <p className="text-gray-500 text-sm">{msg}</p>
      </div>
    </div>
  );
}

export default function LoginErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
