'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Mail, Phone, MapPin, FileText, Loader2, ExternalLink, Receipt, Pencil, Copy, RefreshCw, RotateCcw } from 'lucide-react';
import RefundModal from '@/components/RefundModal';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';

interface Customer {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface Proposal {
  id: string;
  customer_name: string;
  customer_email: string;
  status: string;
  price: number;
  payment_type: string;
  payment_config: Record<string, unknown> | null;
  public_token: string;
  charge_id?: string | null;
  sent_at: string | null;
  signed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<Proposal | null>(null);
  const [proposalSearch, setProposalSearch] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/customers/${customerId}`);
        if (res.ok) {
          const data = await res.json();
          setCustomer(data.customer);
          setProposals(data.proposals || []);
        } else {
          setError('Customer not found');
        }
      } catch {
        setError('Failed to load customer');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [customerId]);

  function copyLink(p: Proposal) {
    const url = `${window.location.origin}/proposal/${p.public_token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleResend(p: Proposal) {
    setResendingId(p.id);
    try {
      const res = await fetch(`/api/proposals/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendNow: true }),
      });
      if (res.ok) {
        alert('Proposal resent successfully.');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to resend');
      }
    } catch {
      alert('Failed to resend proposal');
    } finally {
      setResendingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="py-20 text-center">
        <p className="text-gray-500">{error || 'Customer not found'}</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-brand-900 hover:underline">Go back</button>
      </div>
    );
  }

  const paidProposals = proposals.filter((p) => p.status === 'paid');
  const totalPaid = paidProposals.reduce((sum, p) => sum + (p.price || 0), 0);
  const pendingProposals = proposals.filter((p) => p.status === 'sent' || p.status === 'opened' || p.status === 'signed');
  const totalPending = pendingProposals.reduce((sum, p) => sum + (p.price || 0), 0);

  const installmentProposals = proposals.filter((p) => p.payment_type === 'installment' && p.payment_config);

  return (
    <div>
      <button
        onClick={() => router.push('/dashboard/customers')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-brand-900 transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        Back to Customers
      </button>

      {/* Customer header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-semibold text-white"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            {customer.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <h1 className="font-heading text-2xl text-gray-900">{customer.name}</h1>
            <div className="flex items-center gap-4 mt-1">
              {customer.email && (
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Mail size={14} /> {customer.email}
                </span>
              )}
              {customer.phone && (
                <span className="flex items-center gap-1 text-sm text-gray-500">
                  <Phone size={14} /> {customer.phone}
                </span>
              )}
            </div>
            {(customer.address || customer.city || customer.state) && (
              <span className="flex items-center gap-1 text-sm text-gray-400 mt-0.5">
                <MapPin size={14} />
                {[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/invoices/new?email=${encodeURIComponent(customer.email || '')}&name=${encodeURIComponent(customer.name || '')}`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Receipt size={16} />
            Create Invoice
          </Link>
          <Link
            href={`/dashboard/proposals/new?email=${encodeURIComponent(customer.email || '')}&name=${encodeURIComponent(customer.name || '')}`}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: '#1b1b1b' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#333333')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1b1b1b')}
          >
            <FileText size={16} />
            Create Proposal
          </Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div className="rounded-xl border border-gray-100 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Proposals</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{proposals.length}</p>
        </div>
        <div className="rounded-xl border border-gray-100 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Total Paid</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{formatCents(totalPaid)}</p>
        </div>
        <div className="rounded-xl border border-gray-100 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Pending</p>
          <p className="mt-1 text-2xl font-bold text-amber-600">{formatCents(totalPending)}</p>
        </div>
        <div className="rounded-xl border border-gray-100 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Payment Plans</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{installmentProposals.length}</p>
        </div>
      </div>

      {/* Proposals list */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="font-heading text-lg text-gray-900">Proposals & Invoices</h2>
        <div className="flex items-center gap-3">
          <Link href="/dashboard/payments/proposals" className="text-sm text-gray-500 hover:text-gray-900 transition-colors underline">
            View All Proposals
          </Link>
          <div className="relative">
            <input
              type="text"
              value={proposalSearch}
              onChange={e => setProposalSearch(e.target.value)}
              placeholder="Search proposals..."
              className="rounded-xl border border-gray-200 bg-white pl-3.5 pr-8 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors w-48"
              style={{ fontSize: 16 }}
            />
            {proposalSearch && (
              <button onClick={() => setProposalSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <span className="text-xs">×</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Amount</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Type</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Sent</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Signed</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Paid</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {proposals.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No proposals for this customer yet</td></tr>
            ) : (() => {
              const filtered = [...proposals]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .filter(p => !proposalSearch || [p.status, p.payment_type, String(p.price/100), p.sent_at??'', p.paid_at??'', p.created_at].some(v => v.toLowerCase().includes(proposalSearch.toLowerCase())));
              if (filtered.length === 0) return <tr><td colSpan={7} className="px-5 py-10 text-center text-gray-400">No proposals match your search</td></tr>;
              return filtered.map((p) => {
                const color = getStatusColor(p.status);
                return (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="px-5 py-3.5">
                      <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', color.bg, color.text)}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-700">{formatCents(p.price)}</td>
                    <td className="px-5 py-3.5 text-gray-700 capitalize">{p.payment_type}</td>
                    <td className="px-5 py-3.5 text-gray-500">{p.sent_at ? formatDate(p.sent_at) : '---'}</td>
                    <td className="px-5 py-3.5 text-gray-500">{p.signed_at ? formatDate(p.signed_at) : '---'}</td>
                    <td className="px-5 py-3.5 text-gray-500">{p.paid_at ? formatDate(p.paid_at) : '---'}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/dashboard/proposals/${p.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                          title="View/Edit"
                        >
                          <Pencil size={13} />
                        </Link>
                        {p.status !== 'paid' && (
                          <button
                            onClick={() => handleResend(p)}
                            disabled={resendingId === p.id}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                            title="Resend"
                          >
                            <RefreshCw size={13} className={resendingId === p.id ? 'animate-spin' : ''} />
                          </button>
                        )}
                        <button
                          onClick={() => copyLink(p)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                          title="Copy Link"
                        >
                          <Copy size={13} />
                          {copiedId === p.id && <span className="text-[10px]">Copied!</span>}
                        </button>
                        <Link
                          href={`/proposal/${p.public_token}`}
                          target="_blank"
                          className="inline-flex items-center rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                          title="View"
                        >
                          <ExternalLink size={14} />
                        </Link>
                        {p.status === 'paid' && (
                          <Link
                            href={`/invoice/${p.id}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100"
                            title="Invoice"
                          >
                            <Receipt size={13} />
                          </Link>
                        )}
                        {(p.status === 'paid') && (
                          <button
                            onClick={() => setRefundTarget(p)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
                            title="Refund"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {/* Payment schedules */}
      {installmentProposals.length > 0 && (
        <div className="mt-8">
          <h2 className="font-heading text-lg text-gray-900 mb-4">Payment Schedules</h2>
          <div className="space-y-4">
            {installmentProposals.map((p) => {
              const config = p.payment_config as { installments?: { amount: number; date: string }[] } | null;
              const installments = config?.installments || [];
              return (
                <div key={p.id} className="rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Installment Plan - {formatCents(p.price)}</p>
                      <p className="text-xs text-gray-400">{installments.length} payments</p>
                    </div>
                    <span className={classNames('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', getStatusColor(p.status).bg, getStatusColor(p.status).text)}>
                      {p.status}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {installments.map((inst, i) => (
                      <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-gray-500">Payment {i + 1}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-gray-700">{formatCents(inst.amount)}</span>
                          <span className="text-gray-400 text-xs">{inst.date ? formatDate(inst.date) : '---'}</span>
                          {i === 0 && p.status === 'paid' && (
                            <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Paid</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {refundTarget && (
        <RefundModal
          proposalId={refundTarget.id}
          chargeId={refundTarget.charge_id}
          customerName={refundTarget.customer_name || customer?.name || 'Customer'}
          originalAmount={refundTarget.price}
          onSuccess={(fullRefund) => {
            if (fullRefund) {
              setProposals(prev => prev.map(p => p.id === refundTarget.id ? { ...p, status: 'refunded' } : p));
            }
            setRefundTarget(null);
          }}
          onClose={() => setRefundTarget(null)}
        />
      )}
    </div>
  );
}
