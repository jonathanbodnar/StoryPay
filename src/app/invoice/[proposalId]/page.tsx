'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatCents, formatDate } from '@/lib/utils';

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

interface InvoiceData {
  proposal_id: string;
  customer_name: string;
  customer_email: string;
  content: string;
  price: number;
  payment_type: string;
  payment_config: Record<string, unknown> | null;
  status: string;
  paid_at: string | null;
  signed_at: string | null;
  created_at: string;
  venue_name: string;
  venue_logo_url: string | null;
  venue_brand: VenueBrand | null;
  service_fee_rate: number;
  schedule: {
    payments?: Array<{
      amount: number;
      scheduledDate: string;
      status: string;
    }>;
  } | null;
  subscription: {
    amount: number;
    interval: string;
    intervalCount: number;
    status: string;
    nextPaymentDate: string;
  } | null;
}

export default function InvoicePage() {
  const { proposalId } = useParams<{ proposalId: string }>();
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInvoice() {
      try {
        const res = await fetch(`/api/invoices/${proposalId}`);
        if (!res.ok) throw new Error('Invoice not found');
        setInvoice(await res.json());
      } catch {
        setError('Invoice not found.');
      } finally {
        setLoading(false);
      }
    }
    if (proposalId) fetchInvoice();
  }, [proposalId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-400">Loading invoice…</div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">
            Invoice Not Found
          </h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  const invoiceNumber = invoice.proposal_id.slice(0, 8).toUpperCase();
  const payments =
    invoice.payment_type === 'installment' && invoice.payment_config
      ? ((invoice.payment_config as { payments: Array<{ amount: number; date: string }> }).payments ?? [])
      : [];
  const schedulePayments = invoice.schedule?.payments ?? [];
  const feeRate = Number(invoice.service_fee_rate ?? 0);
  const hasFee = feeRate > 0;
  const feeCents = hasFee ? Math.round(invoice.price * feeRate / 100) : 0;
  const totalWithFee = invoice.price + feeCents;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4 print:bg-white print:py-0">
      <div className="mx-auto max-w-2xl">
        {/* Print button */}
        <div className="flex justify-end mb-4 print:hidden">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden print:shadow-none print:border-none">
          {/* Header — branded */}
          {(() => {
            const brand = invoice.venue_brand;
            const color = brand?.color || '#293745';
            return (
              <div className="px-8 py-7" style={{ backgroundColor: color }}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    {invoice.venue_logo_url ? (
                      <img src={invoice.venue_logo_url} alt={invoice.venue_name} className="h-12 object-contain" />
                    ) : (
                      <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center text-white text-xl font-bold">
                        {invoice.venue_name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <p className="text-white font-bold text-base">{invoice.venue_name}</p>
                      {brand?.tagline && <p className="text-white/70 text-xs mt-0.5">{brand.tagline}</p>}
                      {(brand?.address || brand?.city) && (
                        <p className="text-white/60 text-xs mt-0.5">
                          {[brand.address, brand.city, brand.state, brand.zip].filter(Boolean).join(', ')}
                        </p>
                      )}
                      {brand?.email && <p className="text-white/60 text-xs">{brand.email}</p>}
                      {brand?.phone && <p className="text-white/60 text-xs">{brand.phone}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <img src="/storypay-logo-dark.png" alt="StoryPay" className="h-4 ml-auto mb-3 opacity-40 print:hidden" />
                    <h1 className="text-3xl font-bold text-white">INVOICE</h1>
                    <p className="mt-1 text-sm text-white/60">#{invoiceNumber}</p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Details */}
          <div className="px-8 py-6 grid grid-cols-2 gap-6 border-b border-gray-100">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Bill To
              </p>
              <p className="text-sm font-medium text-gray-900">
                {invoice.customer_name}
              </p>
              <p className="text-sm text-gray-500">{invoice.customer_email}</p>
            </div>
            <div className="text-right">
              <div className="mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Invoice Date
                </p>
                <p className="text-sm text-gray-700">
                  {formatDate(invoice.paid_at || invoice.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Status
                </p>
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 uppercase">
                  Paid
                </span>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="px-8 py-6 border-b border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Description
                  </th>
                  <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-4 text-gray-900">
                    Proposal – {invoice.customer_name}
                    <br />
                    <span className="text-xs text-gray-500 capitalize">
                      {invoice.payment_type === 'full'
                        ? 'One-time payment'
                        : `${invoice.payment_type} plan`}
                    </span>
                  </td>
                  <td className="py-4 text-right font-medium text-gray-900">
                    {formatCents(invoice.price)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="px-8 py-6 bg-gray-50/50 border-b border-gray-100">
            {hasFee ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-700">{formatCents(invoice.price)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Processing fee ({feeRate}%)</span>
                  <span className="text-gray-700">{formatCents(feeCents)}</span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                  <span className="text-lg font-semibold text-gray-900">Total</span>
                  <span className="text-2xl font-bold text-gray-900">{formatCents(totalWithFee)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-gray-900">Total</span>
                <span className="text-2xl font-bold text-gray-900">{formatCents(invoice.price)}</span>
              </div>
            )}
          </div>

          {/* Payment schedule breakdown */}
          {invoice.payment_type === 'installment' && (payments.length > 0 || schedulePayments.length > 0) && (
            <div className="px-8 py-6 border-b border-gray-100">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">
                Payment Schedule
              </h3>
              <div className="space-y-2">
                {(schedulePayments.length > 0 ? schedulePayments : payments).map(
                  (payment, i) => {
                    const date = 'scheduledDate' in payment ? payment.scheduledDate : (payment as { date: string }).date;
                    const status = 'status' in payment ? (payment as { status: string }).status : 'scheduled';
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                            {i + 1}
                          </span>
                          <span className="text-sm text-gray-700">
                            {formatDate(date)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <PaymentStatusBadge status={status} />
                          <span className="text-sm font-medium text-gray-900">
                            {formatCents(payment.amount)}
                          </span>
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* Subscription details */}
          {invoice.payment_type === 'subscription' && invoice.subscription && (
            <div className="px-8 py-6 border-b border-gray-100">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">
                Subscription Details
              </h3>
              <div className="rounded-lg border border-gray-100 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-medium text-gray-900">
                    {formatCents(invoice.subscription.amount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Frequency</span>
                  <span className="font-medium text-gray-900 capitalize">
                    Every {invoice.subscription.intervalCount}{' '}
                    {invoice.subscription.interval}(s)
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Next Payment</span>
                  <span className="font-medium text-gray-900">
                    {formatDate(invoice.subscription.nextPaymentDate)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Status</span>
                  <PaymentStatusBadge status={invoice.subscription.status} />
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-8 py-6 text-center">
            <p className="text-xs text-gray-400">
              Thank you for your business
            </p>
          </div>
        </div>

        {/* Footer note from venue branding */}
        {invoice.venue_brand?.footer_note && (
          <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-500 leading-relaxed">
            {invoice.venue_brand.footer_note}
          </div>
        )}

        {/* Branding footer */}
        <div className="mt-6 flex flex-col items-center gap-2 print:hidden">
          <img src="/storypay-logo-dark.png" alt="StoryPay" className="h-5" />
          <p className="text-xs text-gray-300">&copy; StoryVenue 2026</p>
        </div>
      </div>
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-emerald-100 text-emerald-700',
    active: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-yellow-100 text-yellow-700',
    scheduled: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status}
    </span>
  );
}
