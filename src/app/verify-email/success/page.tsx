import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

export const metadata = { title: 'Email verified — StoryVenue' };

export default function VerifyEmailSuccess() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-10 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-6">
          <CheckCircle2 className="w-7 h-7 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-3">Email verified</h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          Your StoryVenue account is fully activated. Payment processing is now
          being set up in the background — you can start creating proposals
          right away.
        </p>
        <Link
          href="/dashboard"
          className="inline-block bg-[#1b1b1b] text-white font-semibold rounded-lg px-6 py-3 hover:bg-black transition"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
