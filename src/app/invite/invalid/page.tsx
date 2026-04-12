import Link from 'next/link';

export default function InvalidInvitePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 text-4xl">🔗</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid or Expired Invite</h1>
        <p className="text-sm text-gray-500 mb-6">
          This invitation link is invalid or has already been used. Please ask your team admin to send a new invite.
        </p>
        <Link href="/"
          className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors">
          Back to home
        </Link>
      </div>
      <p className="text-center text-xs text-gray-400 mt-8">
        <Link href="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</Link>
        {' · '}
        <Link href="/terms" className="hover:text-gray-600 transition-colors">Terms of Use</Link>
      </p>
    </div>
  );
}
