'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { formatCents, formatDate } from '@/lib/utils';

interface ProposalData {
  customer_name: string;
  customer_email: string;
  content: string;
  price: number;
  payment_type: string;
  payment_config: Record<string, unknown> | null;
  status: string;
  signature_fields: Array<{ type: string; label: string; name: string }> | null;
  signed_at: string | null;
  paid_at: string | null;
  venue_name: string;
  venue_logo_url: string | null;
  proposal_id: string;
}

declare global {
  interface Window {
    Commerce?: {
      new (clientToken: string, options: Record<string, unknown>): {
        mount(el: HTMLElement): void;
        on(event: string, cb: (data: Record<string, unknown>) => void): void;
        destroy?(): void;
      };
    };
  }
}

/* ─── Signature Canvas ─── */
function SignatureCanvas({
  onSignatureChange,
}: {
  onSignatureChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  const getPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    isDrawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    onSignatureChange(canvasRef.current!.toDataURL());
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onSignatureChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={500}
        height={160}
        className="w-full rounded-lg border-2 border-dashed border-gray-300 bg-white cursor-crosshair touch-none"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      <button
        type="button"
        onClick={clear}
        className="mt-2 text-sm text-gray-500 hover:text-gray-700 underline"
      >
        Clear
      </button>
    </div>
  );
}

/* ─── Payment Form ─── */
function PaymentForm({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: (invoiceUrl: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    let destroyed = false;

    async function init() {
      try {
        const res = await fetch(`/api/proposals/public/${token}/payment-intent`, {
          method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to create payment intent');
        const { clientToken, environment } = await res.json();

        if (destroyed) return;

        const script = document.createElement('script');
        script.src = 'https://js.fortis.tech/commercejs-v1.0.0.min.js';
        script.onload = () => {
          if (destroyed || !window.Commerce || !containerRef.current) return;
          const commerce = new window.Commerce(clientToken, {
            environment,
            container: '#payment-element',
            showSubmitButton: false,
          });

          commerce.on('ready', () => {
            if (!destroyed) setLoading(false);
          });

          commerce.on('token', async (data: Record<string, unknown>) => {
            if (destroyed) return;
            setProcessing(true);
            try {
              const payRes = await fetch(
                `/api/proposals/public/${token}/pay`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ticketId: data.id || data.ticketId,
                    nameHolder: data.nameHolder || '',
                  }),
                }
              );
              const result = await payRes.json();
              if (!payRes.ok)
                throw new Error(result.error || 'Payment failed');
              onSuccess(result.invoiceUrl);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Payment failed');
              setProcessing(false);
            }
          });

          commerce.on('error', (data: Record<string, unknown>) => {
            if (!destroyed)
              setError((data.message as string) || 'Payment error');
          });

          commerce.mount(containerRef.current!);
        };
        document.body.appendChild(script);
      } catch (err) {
        if (!destroyed) {
          setError(err instanceof Error ? err.message : 'Failed to load payment form');
          setLoading(false);
        }
      }
    }

    init();
    return () => {
      destroyed = true;
    };
  }, [token, onSuccess]);

  return (
    <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Complete Payment
      </h3>
      {loading && (
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
      <div id="payment-element" ref={containerRef} />
      {processing && (
        <div className="mt-4 flex items-center justify-center text-teal-600 text-sm font-medium">
          <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Processing payment…
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function ProposalPage() {
  const { token } = useParams<{ token: string }>();
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signatureValues, setSignatureValues] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProposal() {
      try {
        const res = await fetch(`/api/proposals/public/${token}`);
        if (!res.ok) throw new Error('Proposal not found');
        setProposal(await res.json());
      } catch {
        setError('This proposal could not be found or has expired.');
      } finally {
        setLoading(false);
      }
    }
    if (token) fetchProposal();
  }, [token]);

  const handleSign = async () => {
    if (!proposal) return;
    setSigning(true);
    try {
      const res = await fetch(`/api/proposals/public/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData: signatureValues }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to sign');
      }
      setProposal((prev) => (prev ? { ...prev, status: 'signed' } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed');
    } finally {
      setSigning(false);
    }
  };

  const handlePaymentSuccess = useCallback((url: string) => {
    setInvoiceUrl(url);
    setProposal((prev) => (prev ? { ...prev, status: 'paid' } : prev));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-400">Loading proposal…</div>
      </div>
    );
  }

  if (error && !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">Proposal Not Found</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!proposal) return null;

  const canSign = proposal.status === 'sent' || proposal.status === 'opened';
  const needsPayment = proposal.status === 'signed';
  const isPaid = proposal.status === 'paid';
  const fields = proposal.signature_fields ?? [
    { type: 'signature', label: 'Signature', name: 'signature' },
    { type: 'name', label: 'Full Name', name: 'printed_name' },
    { type: 'date', label: 'Date', name: 'date' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        {/* Venue branding */}
        <div className="text-center mb-8">
          {proposal.venue_logo_url && (
            <img
              src={proposal.venue_logo_url}
              alt={proposal.venue_name}
              className="h-16 mx-auto mb-4 object-contain"
            />
          )}
          <h2 className="text-sm font-semibold uppercase tracking-wider text-teal-600">
            {proposal.venue_name}
          </h2>
        </div>

        {/* Proposal card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="border-b border-gray-100 px-8 py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">Proposal</h1>
                <p className="mt-1 text-gray-500">
                  Prepared for{' '}
                  <span className="font-medium text-gray-700">
                    {proposal.customer_name}
                  </span>
                </p>
              </div>
              <StatusBadge status={proposal.status} />
            </div>
          </div>

          {/* Content */}
          <div className="px-8 py-6">
            <div
              className="prose prose-gray max-w-none"
              dangerouslySetInnerHTML={{ __html: proposal.content }}
            />
          </div>

          {/* Price & Payment Details */}
          <div className="border-t border-gray-100 px-8 py-6 bg-gray-50/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Amount</p>
                <p className="text-3xl font-bold text-gray-900">
                  {formatCents(proposal.price)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Payment Plan</p>
                <p className="text-sm font-medium text-gray-700 capitalize">
                  {proposal.payment_type === 'full'
                    ? 'One-time payment'
                    : proposal.payment_type}
                </p>
              </div>
            </div>

            {proposal.payment_type === 'installment' &&
              proposal.payment_config && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Payment Schedule
                  </p>
                  {(
                    (proposal.payment_config as { payments: Array<{ amount: number; date: string }> })
                      .payments ?? []
                  ).map((p: { amount: number; date: string }, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-white px-4 py-2 text-sm border border-gray-100"
                    >
                      <span className="text-gray-600">{formatDate(p.date)}</span>
                      <span className="font-medium text-gray-900">
                        {formatCents(p.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
          </div>

          {/* Signature section */}
          {canSign && (
            <div className="border-t border-gray-100 px-8 py-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Sign This Proposal
              </h3>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              )}
              <div className="space-y-5">
                {fields.map((field) => (
                  <div key={field.name}>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {field.label}
                    </label>
                    {field.type === 'signature' ? (
                      <SignatureCanvas
                        onSignatureChange={(dataUrl) =>
                          setSignatureValues((prev) => ({
                            ...prev,
                            [field.name]: dataUrl ?? '',
                          }))
                        }
                      />
                    ) : field.type === 'date' ? (
                      <input
                        type="date"
                        defaultValue={new Date().toISOString().split('T')[0]}
                        onChange={(e) =>
                          setSignatureValues((prev) => ({
                            ...prev,
                            [field.name]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-teal-500 focus:ring-teal-500"
                      />
                    ) : (
                      <input
                        type="text"
                        placeholder={field.label}
                        onChange={(e) =>
                          setSignatureValues((prev) => ({
                            ...prev,
                            [field.name]: e.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-teal-500 focus:ring-teal-500"
                      />
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={handleSign}
                disabled={signing}
                className="mt-6 w-full rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 transition-colors"
              >
                {signing ? 'Signing…' : 'Sign Proposal'}
              </button>
            </div>
          )}

          {/* Payment section */}
          {needsPayment && (
            <div className="border-t border-gray-100 px-8 py-6">
              <PaymentForm
                token={token}
                onSuccess={handlePaymentSuccess}
              />
            </div>
          )}

          {/* Success / Paid */}
          {(isPaid || invoiceUrl) && (
            <div className="border-t border-gray-100 px-8 py-8 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Payment Complete!
              </h3>
              <p className="text-gray-500 mb-6">
                Thank you for your payment. Your invoice is ready.
              </p>
              <a
                href={invoiceUrl || `/invoice/${proposal.proposal_id}`}
                className="inline-block rounded-xl bg-teal-600 px-8 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 transition-colors"
              >
                View Invoice
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-gray-400">
          Powered by StoryPay
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-100 text-blue-700',
    opened: 'bg-yellow-100 text-yellow-700',
    signed: 'bg-purple-100 text-purple-700',
    paid: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium capitalize ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status}
    </span>
  );
}
