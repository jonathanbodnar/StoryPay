import type { Metadata } from 'next';
import { ShieldOff } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Account Suspended — StoryVenue',
};

export default function SuspendedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-red-100 p-4">
            <ShieldOff size={36} className="text-red-600" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">Account Suspended</h1>
          <p className="text-gray-600 leading-relaxed">
            Your account access has been suspended. If you believe this is an
            error, please contact support at{' '}
            <a
              href="mailto:clients@storyvenue.com"
              className="text-blue-600 hover:underline font-medium"
            >
              clients@storyvenue.com
            </a>
            .
          </p>
        </div>

        <a
          href="mailto:clients@storyvenue.com"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
