'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Send, Save, Trash2, Plus, ArrowLeft, ExternalLink, Copy, RefreshCw, FileText, Receipt } from 'lucide-react';
import { formatCents, formatDate, getStatusColor, classNames } from '@/lib/utils';

interface Installment {
  id: string;
  amount: string;
  date: string;
}

interface Proposal {
  id: string;
  status: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  price: number;
  payment_type: string;
  payment_config: Record<string, unknown>;
  template_id: string;
  public_token: string;
  sent_at: string | null;
  signed_at: string | null;
  paid_at: string | null;
  created_at: string;
  content: string | null;
  checkout_session_id: string | null;
  transaction_id: string | null;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function toDateValue(d?: string) {
  if (!d) return '';
  return d.slice(0, 10);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [paymentType, setPaymentType] = useState<'full' | 'installment' | 'subscription'>('full');

  const [installments, setInstallments] = useState<Installment[]>([
    { id: uid(), amount: '', date: '' },
  ]);
  const [subAmount, setSubAmount] = useState('');
  const [subFrequency, setSubFrequency] = useState<'monthly' | 'weekly'>('monthly');
  const [subStartDate, setSubStartDate] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/proposals/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data: Proposal = await res.json();

        setProposal(data);
        setCustomerName(data.customer_name || '');
        setCustomerEmail(data.customer_email || '');
        setCustomerPhone(data.customer_phone || '');
        setPriceDollars(data.price ? (data.price / 100).toString() : '');
        setPaymentType((data.payment_type as 'full' | 'installment' | 'subscription') || 'full');

        const config = data.payment_config || {};
        if (data.payment_type === 'installment' && Array.isArray(config.installments)) {
          setInstallments(
            (config.installments as { amount: number; date: string }[]).map((i) => ({
              id: uid(),
              amount: (i.amount / 100).toString(),
              date: toDateValue(i.date),
            }))
          );
        }
        if (data.payment_type === 'subscription') {
          setSubAmount(config.amount ? ((config.amount as number) / 100).toString() : '');
          setSubFrequency((config.frequency as 'monthly' | 'weekly') || 'monthly');
          setSubStartDate(toDateValue((config.start_date as string) || ''));
        }
      } catch {
        setError('Proposal not found');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const isDraft = proposal?.status === 'draft';
  const isPaid = proposal?.status === 'paid';
  const canEdit = isDraft;

  function buildPaymentConfig() {
    if (paymentType === 'installment') {
      return {
        installments: installments.map((i) => ({
          amount: Math.round(parseFloat(i.amount || '0') * 100),
          date: i.date,
        })),
      };
    }
    if (paymentType === 'subscription') {
      return {
        amount: Math.round(parseFloat(subAmount || '0') * 100),
        frequency: subFrequency,
        start_date: subStartDate,
      };
    }
    return {};
  }

  function buildBody(sendNow: boolean) {
    return {
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      price: Math.round(parseFloat(priceDollars || '0') * 100),
      paymentType,
      paymentConfig: buildPaymentConfig(),
      sendNow,
    };
  }

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(false)),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      const updated = await res.json();
      setProposal(updated);
      setError('');
      alert('Saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    setError('');
    if (!customerName || !customerEmail) {
      setError('Customer name and email are required to send.');
      return;
    }
    const price = Math.round(parseFloat(priceDollars || '0') * 100);
    if (price <= 0) {
      setError('A valid price is required to send.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(true)),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send');
      }
      const updated = await res.json();
      setProposal(updated);
      alert('Proposal sent successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/proposals/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      router.push('/dashboard/proposals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setDeleting(false);
    }
  }

  function copyLink() {
    if (!proposal) return;
    const url = `${window.location.origin}/proposal/${proposal.public_token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const pricePreview = Math.round(parseFloat(priceDollars || '0') * 100);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="mx-auto max-w-2xl text-center py-16">
        <p className="text-gray-500">{error || 'Proposal not found.'}</p>
        <button onClick={() => router.back()} className="mt-4 text-sm text-brand-900 hover:underline">Go back</button>
      </div>
    );
  }

  const statusColor = getStatusColor(proposal.status);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <button
          onClick={() => router.push('/dashboard/proposals')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Proposals
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-2xl text-gray-900">
              {isDraft ? 'Edit Draft' : 'Proposal Details'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {isDraft ? 'Update this draft and send it when ready' : `For ${proposal.customer_name || 'Unknown'}`}
            </p>
          </div>
          <span className={classNames('inline-block rounded-full px-3 py-1 text-xs font-medium capitalize', statusColor.bg, statusColor.text)}>
            {proposal.status}
          </span>
        </div>
      </div>

      {/* Quick actions for non-draft proposals */}
      {!isDraft && (
        <div className="mb-6 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <Copy size={14} />
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <Link
              href={`/proposal/${proposal.public_token}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <ExternalLink size={14} />
              View Proposal
            </Link>
            {isPaid && (
              <Link
                href={`/invoice/${proposal.id}`}
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Receipt size={14} />
                View Invoice
              </Link>
            )}
            {!isPaid && (
              <button
                onClick={handleSend}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#293745' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2f3e4e')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#293745')}
              >
                <RefreshCw size={14} className={submitting ? 'animate-spin' : ''} />
                {submitting ? 'Resending...' : 'Resend'}
              </button>
            )}
          </div>

          {/* Timeline */}
          <div className="mt-4 flex flex-wrap gap-6 text-xs text-gray-500">
            <span>Created: {formatDate(proposal.created_at)}</span>
            {proposal.sent_at && <span>Sent: {formatDate(proposal.sent_at)}</span>}
            {proposal.signed_at && <span>Signed: {formatDate(proposal.signed_at)}</span>}
            {proposal.paid_at && <span>Paid: {formatDate(proposal.paid_at)}</span>}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Customer info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Customer Name {canEdit && <span className="text-red-400">*</span>}
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Jane Smith"
              disabled={!canEdit}
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 disabled:bg-gray-50 disabled:text-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email {canEdit && <span className="text-red-400">*</span>}
            </label>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="jane@example.com"
              disabled={!canEdit}
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 disabled:bg-gray-50 disabled:text-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              disabled={!canEdit}
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 disabled:bg-gray-50 disabled:text-gray-600"
            />
          </div>
        </div>

        {/* Price */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Total Price {canEdit && <span className="text-red-400">*</span>}
          </label>
          <div className="relative w-48">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              placeholder="0.00"
              disabled={!canEdit}
              className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition disabled:bg-gray-50 disabled:text-gray-600"
            />
          </div>
          {pricePreview > 0 && (
            <p className="mt-1 text-xs text-gray-400">{formatCents(pricePreview)}</p>
          )}
        </div>

        {/* Payment Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Payment Type</label>
          <div className="flex gap-2">
            {(['full', 'installment', 'subscription'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => canEdit && setPaymentType(type)}
                disabled={!canEdit}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  paymentType === type
                    ? 'border-brand-900 bg-brand-900/5 text-brand-900'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                } disabled:cursor-default`}
              >
                {type === 'full' ? 'Full Payment' : type === 'installment' ? 'Installment Plan' : 'Subscription'}
              </button>
            ))}
          </div>
        </div>

        {/* Installment Schedule */}
        {paymentType === 'installment' && (
          <div className="rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Installment Schedule</h3>
            <div className="space-y-3">
              {installments.map((inst) => (
                <div key={inst.id} className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={inst.amount}
                      onChange={(e) =>
                        setInstallments((prev) =>
                          prev.map((i) => (i.id === inst.id ? { ...i, amount: e.target.value } : i))
                        )
                      }
                      placeholder="0.00"
                      disabled={!canEdit}
                      className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition disabled:bg-gray-50"
                    />
                  </div>
                  <input
                    type="date"
                    min={today()}
                    value={toDateValue(inst.date)}
                    onChange={(e) =>
                      setInstallments((prev) =>
                        prev.map((i) => (i.id === inst.id ? { ...i, date: e.target.value } : i))
                      )
                    }
                    disabled={!canEdit}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition disabled:bg-gray-50"
                  />
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setInstallments((prev) => prev.filter((i) => i.id !== inst.id))}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setInstallments((prev) => [...prev, { id: uid(), amount: '', date: '' }])}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-900 hover:text-brand-900 transition-colors"
              >
                <Plus size={14} />
                Add Payment
              </button>
            )}
          </div>
        )}

        {/* Subscription Details */}
        {paymentType === 'subscription' && (
          <div className="rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Subscription Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount per Period</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={subAmount}
                    onChange={(e) => setSubAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={!canEdit}
                    className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition disabled:bg-gray-50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Frequency</label>
                <select
                  value={subFrequency}
                  onChange={(e) => setSubFrequency(e.target.value as 'monthly' | 'weekly')}
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition disabled:bg-gray-50"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                <input
                  type="date"
                  min={today()}
                  value={toDateValue(subStartDate)}
                  onChange={(e) => setSubStartDate(e.target.value)}
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition disabled:bg-gray-50"
                />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          {isDraft ? (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={15} />
                {deleting ? 'Deleting...' : 'Delete Draft'}
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || submitting}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  <Save size={16} />
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={submitting || saving}
                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: '#293745' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2f3e4e')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#293745')}
                >
                  <Send size={16} />
                  {submitting ? 'Sending...' : 'Send Proposal'}
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 ml-auto">
              <button
                onClick={() => router.push('/dashboard/proposals')}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Back to Proposals
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
