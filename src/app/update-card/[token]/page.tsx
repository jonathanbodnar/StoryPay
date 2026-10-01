'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import StripeCardUpdateForm from '@/components/payments/StripeCardUpdateForm';

interface CardUpdateData {
  provider?: 'stripe' | 'lunarpay';
  customer_name: string;
  customer_email: string;
  reason: string;
  venue_name: string;
  venue_logo_url: string | null;
}

export default function UpdateCardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<CardUpdateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/card-update/${token}`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || 'Link not found');
        }
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid link');
      } finally {
        setLoading(false);
      }
    }
    if (token) fetchData();
  }, [token]);


  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-400">Loading…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">
            Invalid Link
          </h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">
            Card Updated!
          </h1>
          <p className="text-gray-500">
            Your payment method has been successfully updated. You can close this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-lg">
        {/* Venue branding */}
        <div className="text-center mb-8">
          {data.venue_logo_url && (
            <img
              src={data.venue_logo_url}
              alt={data.venue_name}
              className="h-16 mx-auto mb-4 object-contain"
            />
          )}
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-900">
            {data.venue_name}
          </h2>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-8 py-6 border-b border-gray-100">
            <h1 className="text-2xl font-semibold text-gray-900">
              Update Payment Method
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Hi <span className="font-medium text-gray-700">{data.customer_name}</span>,
              please enter your new card details below.
            </p>
            {data.reason && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                {data.reason}
              </div>
            )}
          </div>

          <div className="px-8 py-6">
            {data.provider === 'stripe' ? (
              <StripeCardUpdateForm token={token} onSuccess={() => setSuccess(true)} />
            ) : (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                This link is from {data.venue_name || 'the venue'}&rsquo;s old payment system and no longer works.
                Please ask them to send you a new link to update your card.
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-gray-400">
          Powered by StoryVenue
        </p>
      </div>
    </div>
  );
}
