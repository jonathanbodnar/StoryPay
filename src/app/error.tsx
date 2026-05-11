'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
          <svg
            className="h-8 w-8 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h2 className="font-heading text-xl font-semibold text-gray-900">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          An unexpected error occurred. Please try again — if the problem
          persists, contact support.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black transition-colors"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
