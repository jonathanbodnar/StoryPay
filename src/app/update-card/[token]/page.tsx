'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

interface CardUpdateData {
  customer_name: string;
  customer_email: string;
  reason: string;
  venue_name: string;
  venue_logo_url: string | null;
}

interface CommerceInstance {
  mount(el: HTMLElement): void;
  on(event: string, cb: (data: Record<string, unknown>) => void): void;
  destroy?(): void;
}

declare global {
  interface Window {
    Commerce?: {
      elements: new (clientToken: string, options?: Record<string, unknown>) => CommerceInstance;
    };
  }
}

export default function UpdateCardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<CardUpdateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!data) return;
    let destroyed = false;

    async function initPayment() {
      try {
        const res = await fetch(`/api/card-update/${token}/intent`, {
          method: 'POST',
        });
        if (!res.ok) {
          const intentRes = await fetch(
            `/api/proposals/public/${token}/payment-intent`,
            { method: 'POST' }
          );
          if (!intentRes.ok) throw new Error('Failed to init payment');
          const { clientToken, environment } = await intentRes.json();
          loadCommerce(clientToken, environment, destroyed);
          return;
        }
        const { clientToken, environment } = await res.json();
        loadCommerce(clientToken, environment, destroyed);
      } catch {
        // Fallback: load a fresh intent via the card-update specific route if it exists,
        // or show an error
        try {
          const res = await fetch(`/api/card-update/${token}/payment-intent`, {
            method: 'POST',
          });
          if (!res.ok) throw new Error('Payment setup failed');
          const { clientToken, environment } = await res.json();
          loadCommerce(clientToken, environment, destroyed);
        } catch {
          if (!destroyed) {
            setError('Unable to load payment form. Please try again later.');
            setFormLoading(false);
          }
        }
      }
    }

    function loadCommerce(clientToken: string, environment: string, isDestroyed: boolean) {
      const script = document.createElement('script');
      script.src = 'https://js.fortis.tech/commercejs-v1.0.0.min.js';
      script.onload = () => {
        if (isDestroyed || !window.Commerce?.elements || !containerRef.current) return;

        const commerce = new window.Commerce.elements(clientToken, {
          environment,
          container: '#card-update-element',
          showSubmitButton: false,
        });

        commerce.on('ready', () => {
          if (!isDestroyed) setFormLoading(false);
        });

        commerce.on('token', async (tokenData: Record<string, unknown>) => {
          if (isDestroyed) return;
          setProcessing(true);
          try {
            const saveRes = await fetch(`/api/card-update/${token}/save`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticketId: tokenData.id || tokenData.ticketId,
                nameHolder: tokenData.nameHolder || '',
              }),
            });
            const result = await saveRes.json();
            if (!saveRes.ok)
              throw new Error(result.error || 'Failed to save card');
            setSuccess(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update card');
            setProcessing(false);
          }
        });

        commerce.on('error', (errData: Record<string, unknown>) => {
          if (!isDestroyed)
            setError((errData.message as string) || 'Payment form error');
        });

        commerce.mount(containerRef.current!);
      };
      document.body.appendChild(script);
    }

    initPayment();
    return () => {
      destroyed = true;
    };
  }, [data, token]);

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
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
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
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
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

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
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
            {formLoading && (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading payment form…
              </div>
            )}
            {error && (
              <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}
            <div id="card-update-element" ref={containerRef} />
            {processing && (
              <div className="mt-4 flex items-center justify-center text-brand-900 text-sm font-medium">
                <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Updating your card…
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-gray-400">
          Powered by StoryPay
        </p>
      </div>
    </div>
  );
}
