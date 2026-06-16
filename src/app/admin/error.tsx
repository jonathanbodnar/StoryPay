'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportClientError } from '@/components/ClientErrorLogger';

/**
 * Admin-scoped error boundary. Catches render crashes anywhere in the super
 * admin UI (which almost entirely lives in admin/[[...slug]]/layout.tsx) so a
 * single broken panel shows a clean recoverable screen instead of bubbling to
 * the full-page root error screen — and reports every crash to the Error Log.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AdminError]', error);
    reportClientError({
      level: 'error',
      category: 'admin_render',
      message: error.message || 'Admin page render error',
      stack: error.stack,
      context: { digest: error.digest, area: 'super_admin' },
    });
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-screen px-4 bg-gray-50">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
          <AlertTriangle className="h-6 w-6 text-red-500" />
        </div>
        <h2 className="font-heading text-lg font-semibold text-gray-900">
          This admin screen hit an error
        </h2>
        <p className="mt-1.5 text-sm text-gray-500">
          It&apos;s been logged to the Error Log automatically. Try again, or
          head back to the admin dashboard.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-black transition-colors"
          >
            Try again
          </button>
          <a
            href="/admin"
            className="rounded-xl border border-gray-200 px-3.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Admin dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
