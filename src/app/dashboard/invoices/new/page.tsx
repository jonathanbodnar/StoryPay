'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Send, Save, Plus, Trash2 } from 'lucide-react';
import { formatCents } from '@/lib/utils';

interface Installment {
  id: string;
  amount: string;
  date: string;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+${digits.slice(0, digits.length - 10)} (${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [description, setDescription] = useState('');
  const [priceDollars, setPriceDollars] = useState('');
  const [paymentType, setPaymentType] = useState<'full' | 'installment' | 'subscription'>('full');

  const [installments, setInstallments] = useState<Installment[]>([
    { id: uid(), amount: '', date: '' },
  ]);
  const [subAmount, setSubAmount] = useState('');
  const [subFrequency, setSubFrequency] = useState<'monthly' | 'weekly'>('monthly');
  const [subStartDate, setSubStartDate] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const name = searchParams.get('name');
    const email = searchParams.get('email');
    if (name) setCustomerName(name);
    if (email) setCustomerEmail(email);
  }, [searchParams]);

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

  async function handleSubmit(asDraft: boolean) {
    setError('');
    if (asDraft) setSaving(true); else setSubmitting(true);

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName || undefined,
          customerEmail: customerEmail || undefined,
          customerPhone: customerPhone || undefined,
          description,
          price: Math.round(parseFloat(priceDollars || '0') * 100),
          paymentType,
          paymentConfig: buildPaymentConfig(),
          asDraft,
        }),
      });

      if (res.ok) {
        router.push('/dashboard/proposals');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create invoice');
      }
    } catch {
      setError('Network error - please try again');
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  }

  const pricePreview = Math.round(parseFloat(priceDollars || '0') * 100);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4 transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <h1 className="font-heading text-2xl text-gray-900">Create Invoice</h1>
        <p className="mt-1 text-sm text-gray-500">Send a one-off invoice to a customer</p>
      </div>

      <div className="space-y-6">
        {/* Customer info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Customer Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Email <span className="text-red-400">*</span>
            </label>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(formatPhoneNumber(e.target.value))}
              placeholder="(555) 000-0000"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this invoice for?"
            rows={3}
            className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 resize-none"
          />
        </div>

        {/* Price */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Amount <span className="text-red-400">*</span>
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
              className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
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
                    ? 'border-brand-900 bg-brand-900/5 text-brand-900'
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
                        setInstallments((prev) => prev.map((i) => (i.id === inst.id ? { ...i, amount: e.target.value } : i)))
                      }
                      placeholder="0.00"
                      className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
                    />
                  </div>
                  <input
                    type="date"
                    min={today()}
                    value={inst.date}
                    onChange={(e) =>
                      setInstallments((prev) => prev.map((i) => (i.id === inst.id ? { ...i, date: e.target.value } : i)))
                    }
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
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
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-900 transition-colors"
            >
              <Plus size={14} />
              Add Payment
            </button>
          </div>
        )}

        {/* Subscription */}
        {paymentType === 'subscription' && (
          <div className="rounded-lg border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Subscription Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount per Period</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" step="0.01" value={subAmount} onChange={(e) => setSubAmount(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Frequency</label>
                <select value={subFrequency} onChange={(e) => setSubFrequency(e.target.value as 'monthly' | 'weekly')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition">
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                <input type="date" min={today()} value={subStartDate} onChange={(e) => setSubStartDate(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition" />
              </div>
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={saving || submitting}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={submitting || saving}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#293745' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2f3e4e')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#293745')}
          >
            <Send size={16} />
            {submitting ? 'Sending...' : 'Send Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
