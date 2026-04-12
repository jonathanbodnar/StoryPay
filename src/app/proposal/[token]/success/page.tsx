'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';

export default function ProposalSuccessPage() {
  const { token } = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');

    async function verify() {
      if (!sessionId) {
        const res = await fetch(`/api/proposals/public/${token}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'paid') {
            setProposalId(data.proposal_id);
            setStatus('success');
            return;
          }
        }
        setError('Missing payment session. Please try again.');
        setStatus('error');
        return;
      }

      try {
        const res = await fetch(`/api/proposals/public/${token}/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Verification failed');
        setStatus('success');

        const proposalRes = await fetch(`/api/proposals/public/${token}`);
        if (proposalRes.ok) {
          const proposalData = await proposalRes.json();
          setProposalId(proposalData.proposal_id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Payment verification failed');
        setStatus('error');
      }
    }

    if (token) verify();
  }, [token, searchParams]);

  if (status === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-brand-900 mx-auto mb-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <p className="text-gray-500 font-medium">Verifying your payment…</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 px-4">
        <div className="bg-white rounded-3xl p-12 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Payment Issue</h1>
          <p className="text-gray-500 text-sm mb-6">{error}</p>
          <button
            onClick={() => router.push(`/proposal/${token}`)}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-100 px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Return to Proposal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 px-4">
      <div className="bg-white rounded-3xl p-12 max-w-md w-full text-center">
        <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h1>
        <p className="text-gray-500 text-sm mb-8">
          Your payment has been processed successfully. Thank you!
        </p>
        {proposalId && (
          <button
            onClick={() => router.push(`/invoice/${proposalId}`)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-900 to-brand-700 px-8 py-3.5 text-sm font-semibold text-white hover:from-brand-700 hover:to-brand-700 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            View Invoice
          </button>
        )}
        <p className="mt-8 text-xs text-gray-300">
&copy; StoryVenue 2026
        </p>
      </div>
    </div>
  );
}
