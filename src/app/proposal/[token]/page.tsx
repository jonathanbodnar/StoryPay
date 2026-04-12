'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatCents, formatDate } from '@/lib/utils';

interface SigningField {
  field_type: 'signature' | 'name' | 'date';
  label: string;
  required: boolean;
  sort_order: number;
}

interface VenueBrand {
  color: string;
  tagline: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  footer_note: string | null;
}

interface ProposalData {
  customer_name: string;
  customer_email: string;
  content: string;
  price: number;
  payment_type: string;
  payment_config: Record<string, unknown> | null;
  status: string;
  signature_fields: SigningField[] | null;
  signed_at: string | null;
  paid_at: string | null;
  venue_name: string;
  venue_logo_url: string | null;
  venue_brand: VenueBrand | null;
  proposal_id: string;
  service_fee_rate: number;
}

function SignatureCanvas({ onSignatureChange }: { onSignatureChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isDrawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!;
    const pos = getPos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stop = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    onSignatureChange(canvasRef.current!.toDataURL());
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    onSignatureChange(null);
  };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-gray-200 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={600}
          height={180}
          className="w-full cursor-crosshair touch-none"
          onMouseDown={start}
          onMouseMove={draw}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={draw}
          onTouchEnd={stop}
        />
        <div className="absolute bottom-3 left-4 right-4 border-b border-gray-200" />
        <span className="absolute bottom-1 left-4 text-[10px] text-gray-300 tracking-wider uppercase">
          Sign above
        </span>
      </div>
      <button type="button" onClick={clear} className="mt-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
        Clear signature
      </button>
    </div>
  );
}

function PaymentButton({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/public/${token}/checkout`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start payment');
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment');
      setLoading(false);
    }
  };

  return (
    <div>
      {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">{error}</div>}
      <button
        onClick={handlePay}
        disabled={loading}
        className="w-full rounded-xl bg-gradient-to-r from-brand-900 to-brand-700 px-6 py-4 text-sm font-semibold text-white hover:from-brand-700 hover:to-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-900 focus:ring-offset-2 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Redirecting to payment…
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
            Pay Now
          </>
        )}
      </button>
      <p className="mt-3 text-center text-xs text-gray-400">
        You&apos;ll be redirected to a secure payment page
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-sky-50 text-sky-700 border-sky-200',
    opened: 'bg-amber-50 text-amber-700 border-amber-200',
    signed: 'bg-violet-50 text-violet-700 border-violet-200',
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-3.5 py-1 text-xs font-semibold capitalize ${styles[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {status}
    </span>
  );
}

function StepIndicator({ step, currentStep }: { step: number; currentStep: number }) {
  const done = currentStep > step;
  const active = currentStep === step;
  return (
    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-all ${
      done ? 'bg-emerald-500 text-white' : active ? 'bg-brand-700 text-white ring-4 ring-brand-900/20' : 'bg-gray-100 text-gray-400'
    }`}>
      {done ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : step}
    </div>
  );
}

export default function ProposalPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/proposals/public/${token}`);
        if (!res.ok) throw new Error('Proposal not found');
        const data = await res.json();
        setProposal(data);

        const sigFields: SigningField[] = data.signature_fields?.length
          ? data.signature_fields
          : [
              { field_type: 'signature', label: 'Client Signature', required: true, sort_order: 0 },
              { field_type: 'name', label: 'Printed Name', required: true, sort_order: 1 },
              { field_type: 'date', label: 'Date', required: true, sort_order: 2 },
            ];
        const dateDefaults: Record<string, string> = {};
        for (const f of sigFields) {
          if (f.field_type === 'date') {
            dateDefaults[`${f.field_type}_${f.sort_order}`] = new Date().toISOString().split('T')[0];
          }
        }
        if (Object.keys(dateDefaults).length) {
          setFieldValues((prev) => ({ ...dateDefaults, ...prev }));
        }
      } catch {
        setError('This proposal could not be found or has expired.');
      } finally {
        setLoading(false);
      }
    }
    if (token) load();
  }, [token]);

  const handleSign = async () => {
    if (!proposal) return;
    const fields = proposal.signature_fields ?? [];
    const required = fields.filter((f) => f.required);
    for (const f of required) {
      const key = `${f.field_type}_${f.sort_order}`;
      if (!fieldValues[key]) {
        setError(`Please fill in "${f.label}"`);
        return;
      }
    }

    setSigning(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/public/${token}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureData: fieldValues }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to sign');
      }
      setProposal((prev) => prev ? { ...prev, status: 'signed', signed_at: new Date().toISOString() } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed');
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading proposal…
        </div>
      </div>
    );
  }

  if (error && !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 px-4">
        <div className="bg-white rounded-3xl p-12 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Proposal Not Found</h1>
          <p className="text-gray-500 text-sm leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  if (!proposal) return null;

  const canSign = proposal.status === 'sent' || proposal.status === 'opened';
  const needsPayment = proposal.status === 'signed';
  const isPaid = proposal.status === 'paid';
  const currentStep = isPaid ? 4 : needsPayment ? 3 : canSign ? 2 : 1;
  const fields: SigningField[] = proposal.signature_fields?.length
    ? proposal.signature_fields
    : [
        { field_type: 'signature', label: 'Client Signature', required: true, sort_order: 0 },
        { field_type: 'name', label: 'Printed Name', required: true, sort_order: 1 },
        { field_type: 'date', label: 'Date', required: true, sort_order: 2 },
      ];

  const installments = proposal.payment_config
    ? (proposal.payment_config as { installments?: Array<{ amount: number; date: string }> }).installments
    : undefined;
  const feeRate = Number(proposal.service_fee_rate ?? 0);
  const hasFee = feeRate > 0;
  const feeCents = hasFee ? Math.round(proposal.price * feeRate / 100) : 0;
  const totalWithFee = proposal.price + feeCents;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {/* Header bar — branded */}
      {(() => {
        const brand = proposal.venue_brand;
        const color = brand?.color || '#1b1b1b';
        return (
          <header style={{ backgroundColor: color }}>
            <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {proposal.venue_logo_url ? (
                  <img src={proposal.venue_logo_url} alt={proposal.venue_name} className="h-10 object-contain" />
                ) : (
                  <>
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-bold bg-white/20">
                      {proposal.venue_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-white text-sm">{proposal.venue_name}</p>
                      {brand?.tagline && <p className="text-white/70 text-xs">{brand.tagline}</p>}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex flex-col text-right text-white/70 text-xs gap-0.5">
                  {brand?.email && <span>{brand.email}</span>}
                  {brand?.phone && <span>{brand.phone}</span>}
                </div>
                <StatusBadge status={proposal.status} />
              </div>
            </div>
          </header>
        );
      })()}

      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Progress Steps */}
        <div className="mb-8 flex items-center justify-center gap-0">
          {[
            { step: 1, label: 'Review' },
            { step: 2, label: 'Sign' },
            { step: 3, label: 'Pay' },
          ].map((s, i) => (
            <div key={s.step} className="flex items-center">
              {i > 0 && <div className={`w-16 h-0.5 mx-1 ${currentStep > s.step ? 'bg-emerald-400' : currentStep === s.step ? 'bg-brand-400' : 'bg-gray-200'}`} />}
              <div className="flex flex-col items-center gap-1.5">
                <StepIndicator step={s.step} currentStep={currentStep} />
                <span className={`text-[11px] font-medium ${currentStep >= s.step ? 'text-gray-700' : 'text-gray-400'}`}>{s.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Main card */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {/* Proposal header */}
          <div className="px-8 pt-8 pb-6 border-b border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-900 mb-2">Proposal</p>
            {proposal.venue_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proposal.venue_logo_url} alt={proposal.venue_name} className="h-12 object-contain mb-3" />
            ) : (
              <h1 className="text-3xl font-bold text-gray-900 mb-1 font-heading">{proposal.venue_name}</h1>
            )}
            <p className="text-gray-500">
              Prepared for <span className="font-medium text-gray-700">{proposal.customer_name}</span>
            </p>
          </div>

          {/* Contract content — renders WYSIWYG HTML */}
          <div className="px-8 py-8">
            <div
              className="proposal-content prose prose-gray prose-sm sm:prose-base max-w-none
                prose-headings:font-semibold prose-headings:text-gray-900
                prose-h1:text-2xl prose-h1:mb-4 prose-h1:mt-6
                prose-h2:text-xl prose-h2:mb-3 prose-h2:mt-5
                prose-h3:text-lg prose-h3:mb-2 prose-h3:mt-4
                prose-p:text-gray-600 prose-p:leading-relaxed
                prose-li:text-gray-600
                prose-strong:text-gray-900
                prose-blockquote:border-brand-400 prose-blockquote:text-gray-500
                prose-hr:border-gray-200
                prose-a:text-brand-900 prose-a:no-underline hover:prose-a:underline"
              dangerouslySetInnerHTML={{ __html: proposal.content }}
            />
          </div>

          {/* Pricing section — base price only, fee shown at payment step */}
          <div className="mx-8 mb-8 rounded-xl bg-gradient-to-r from-gray-50 to-gray-50/50 border border-gray-100 p-6">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Total Due</p>
                <p className="text-4xl font-bold text-gray-900 tracking-tight">{formatCents(proposal.price)}</p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 capitalize">
                  {proposal.payment_type === 'full' ? 'One-time payment' : proposal.payment_type === 'installment' ? 'Installment plan' : 'Subscription'}
                </span>
              </div>
            </div>

            {proposal.payment_type === 'installment' && installments && installments.length > 0 && (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Payment Schedule</p>
                {installments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-white border border-gray-100 px-4 py-3 text-sm">
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-500">
                        {i + 1}
                      </div>
                      <span className="text-gray-600">{formatDate(p.date)}</span>
                    </div>
                    <span className="font-semibold text-gray-900">{formatCents(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            {proposal.payment_type === 'subscription' && proposal.payment_config && (
              <div className="mt-4 text-sm text-gray-600">
                <span className="font-semibold text-gray-900">
                  {formatCents((proposal.payment_config as { amount: number }).amount)}
                </span>{' '}
                / {(proposal.payment_config as { frequency: string }).frequency}, starting{' '}
                {formatDate((proposal.payment_config as { start_date: string }).start_date)}
              </div>
            )}
          </div>

          {/* Signing section */}
          {canSign && (
            <div className="border-t border-gray-100 px-8 py-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Sign This Proposal</h2>
                <p className="text-sm text-gray-500">
                  Please review the terms above, then complete the fields below to sign.
                </p>
              </div>

              {error && (
                <div className="mb-5 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="space-y-6">
                {fields.map((field) => {
                  const key = `${field.field_type}_${field.sort_order}`;
                  return (
                    <div key={key}>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {field.label}
                        {field.required && <span className="text-red-400 ml-1">*</span>}
                      </label>
                      {field.field_type === 'signature' ? (
                        <SignatureCanvas
                          onSignatureChange={(dataUrl) =>
                            setFieldValues((prev) => ({ ...prev, [key]: dataUrl ?? '' }))
                          }
                        />
                      ) : field.field_type === 'date' ? (
                        <input
                          type="date"
                          defaultValue={new Date().toISOString().split('T')[0]}
                          onChange={(e) => setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder={field.label}
                          onChange={(e) => setFieldValues((prev) => ({ ...prev, [key]: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                onClick={handleSign}
                disabled={signing}
                className="mt-8 w-full rounded-xl bg-gradient-to-r from-brand-900 to-brand-700 px-6 py-4 text-sm font-semibold text-white hover:from-brand-700 hover:to-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-900 focus:ring-offset-2 disabled:opacity-50 transition-all"
              >
                {signing ? 'Signing…' : 'Sign Proposal'}
              </button>

              <p className="mt-3 text-center text-xs text-gray-400">
                By signing, you agree to the terms outlined in this proposal.
              </p>
            </div>
          )}

          {/* Signed confirmation + payment */}
          {needsPayment && (
            <div className="border-t border-gray-100 px-8 py-8">
              <div className="text-center mb-8">
                <div className="w-14 h-14 bg-violet-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">Proposal Signed</h2>
                <p className="text-sm text-gray-500">
                  Signed on {proposal.signed_at ? formatDate(proposal.signed_at) : 'just now'}.
                  Please complete your payment below.
                </p>
              </div>

              {proposal.payment_type === 'installment' && installments && installments.length > 1 ? (() => {
                const firstAmt = installments[0].amount;
                const firstFee = hasFee ? Math.round(firstAmt * feeRate / 100) : 0;
                return (
                  <div className="rounded-xl bg-gray-50 border border-gray-100 p-6 mb-6">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-500">Due today (Payment 1 of {installments.length})</span>
                      <span className="text-2xl font-bold text-gray-900">{formatCents(firstAmt + firstFee)}</span>
                    </div>
                    {hasFee && (
                      <p className="text-xs text-gray-400 text-right mb-3">incl. {formatCents(firstFee)} processing fee ({feeRate}%)</p>
                    )}
                    <div className="border-t border-gray-200 pt-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Remaining payments</p>
                      {installments.slice(1).map((p, i) => {
                        const pFee = hasFee ? Math.round(p.amount * feeRate / 100) : 0;
                        return (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">{formatDate(p.date)}</span>
                            <span className="font-medium text-gray-700">{formatCents(p.amount + pFee)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })() : (
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-6 mb-6">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-500">Amount due</span>
                    <span className="text-2xl font-bold text-gray-900">{formatCents(hasFee ? totalWithFee : proposal.price)}</span>
                  </div>
                  {hasFee && (
                    <p className="text-xs text-gray-400 text-right">incl. {formatCents(feeCents)} processing fee ({feeRate}%)</p>
                  )}
                </div>
              )}

              <PaymentButton token={token} />
            </div>
          )}

          {/* Paid success */}
          {isPaid && (
            <div className="border-t border-gray-100 px-8 py-12 text-center">
              <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h2>
              <p className="text-gray-500 text-sm mb-8 max-w-sm mx-auto">
                Thank you, {proposal.customer_name}. Your payment has been processed successfully.
              </p>
              <button
                onClick={() => router.push(`/invoice/${proposal.proposal_id}`)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-900 to-brand-700 px-8 py-3.5 text-sm font-semibold text-white hover:from-brand-700 hover:to-brand-700 transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                View Invoice
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 flex flex-col items-center gap-2">
          <img src="/storyvenue-dark-logo.png" alt="StoryPay" className="h-5 opacity-60" />
          <p className="text-xs text-gray-300">&copy; StoryVenue 2026</p>
        </div>
      </div>
    </div>
  );
}
