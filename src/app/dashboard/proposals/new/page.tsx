'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, FileText, Plus, Trash2 } from 'lucide-react';
import { formatCents } from '@/lib/utils';

interface Template {
  id: string;
  name: string;
}

interface Installment {
  id: string;
  amount: string;
  date: string;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function NewProposalPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [templateId, setTemplateId] = useState('');
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
    fetch('/api/templates')
      .then((r) => r.json())
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, []);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!templateId || !customerName || !customerEmail) {
      setError('Please fill in all required fields.');
      return;
    }

    const price = Math.round(parseFloat(priceDollars || '0') * 100);
    if (price <= 0) {
      setError('Please enter a valid price.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          customerName,
          customerEmail,
          customerPhone: customerPhone || undefined,
          price,
          paymentType,
          paymentConfig: buildPaymentConfig(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create proposal');
      }

      router.push('/dashboard/proposals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  const pricePreview = Math.round(parseFloat(priceDollars || '0') * 100);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">New Proposal</h1>
        <p className="mt-1 text-sm text-gray-500">Send a new proposal to your customer</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Template select */}
        <div>
          <label htmlFor="template" className="block text-sm font-medium text-gray-700 mb-1.5">
            Template <span className="text-red-400">*</span>
          </label>
          {loadingTemplates ? (
            <div className="h-10 w-full animate-pulse rounded-lg bg-gray-100" />
          ) : templates.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
              <FileText size={20} className="text-gray-400" />
              <p className="text-sm text-gray-500">
                No templates found. Create a template first.
              </p>
            </div>
          ) : (
            <select
              id="template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="">Select a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Customer info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
              Customer Name <span className="text-red-400">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              id="email"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1.5">
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              If provided and messaging is connected, an SMS will be sent with the proposal link.
            </p>
          </div>
        </div>

        {/* Price */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Total Price <span className="text-red-400">*</span>
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
              className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
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
                onClick={() => setPaymentType(type)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  paymentType === type
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
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
                      className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                    />
                  </div>
                  <input
                    type="date"
                    value={inst.date}
                    onChange={(e) =>
                      setInstallments((prev) =>
                        prev.map((i) => (i.id === inst.id ? { ...i, date: e.target.value } : i))
                      )
                    }
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setInstallments((prev) => prev.filter((i) => i.id !== inst.id))}
                    className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setInstallments((prev) => [...prev, { id: uid(), amount: '', date: '' }])}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700 transition-colors"
            >
              <Plus size={14} />
              Add Payment
            </button>
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
                    className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Frequency</label>
                <select
                  value={subFrequency}
                  onChange={(e) => setSubFrequency(e.target.value as 'monthly' | 'weekly')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                <input
                  type="date"
                  value={subStartDate}
                  onChange={(e) => setSubStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition"
                />
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !templateId || !customerName || !customerEmail}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {submitting ? 'Sending…' : 'Send Proposal'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/proposals')}
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
