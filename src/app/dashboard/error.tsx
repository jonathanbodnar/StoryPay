'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
          <AlertTriangle className="h-6 w-6 text-red-500" />
        </div>
        <h2 className="font-heading text-lg font-semibold text-gray-900">
          Something went wrong
        </h2>
        <p className="mt-1.5 text-sm text-gray-500">
          This page encountered an error. Try reloading, or head back to the
          dashboard.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-black transition-colors"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
