'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Send, Save, Plus, Trash2 } from 'lucide-react';
import { formatCents } from '@/lib/utils';

const SURCHARGE_RATE = 0.0275; // 2.75%
const SURCHARGE_ID = '__surcharge__';

interface Product { id: string; name: string; description: string | null; price: number; unit: string; }

interface LineItem {
  id: string;
  name: string;
  description: string;
  amount: string;
  isSurcharge?: boolean;
}

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
  const local = digits.startsWith('1') && digits.length > 10 ? digits.slice(1) : digits;
  if (local.length <= 3) return `+1 (${local}`;
  if (local.length <= 6) return `+1 (${local.slice(0, 3)}) ${local.slice(3)}`;
  if (local.length <= 10) return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6, 10)}`;
}

function toE164(formatted: string): string {
  const digits = formatted.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return formatted;
}

function emptyLineItem(): LineItem {
  return { id: uid(), name: '', description: '', amount: '' };
}

function makeSurcharge(subtotalCents: number): LineItem {
  const amt = ((subtotalCents * SURCHARGE_RATE) / 100).toFixed(2);
  return { id: SURCHARGE_ID, name: 'Processing Fee (2.75%)', description: 'Credit card processing surcharge', amount: amt, isSurcharge: true };
}

export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem(), makeSurcharge(0)]);
  const [paymentType, setPaymentType] = useState<'full' | 'installment' | 'subscription'>('full');

  const [installments, setInstallments] = useState<Installment[]>([
    { id: uid(), amount: '', date: '' },
  ]);
  const [subAmount, setSubAmount] = useState('');
  const [subFrequency, setSubFrequency] = useState<'monthly' | 'weekly'>('monthly');
  const [subStartDate, setSubStartDate] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts]     = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState<Record<string, string>>({});
  const [showSuggestions, setShowSuggestions] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Product[]>>({});
  const suggestDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch('/api/products').then(r => r.ok ? r.json() : []).then(d => setProducts(Array.isArray(d) ? d : []));
  }, []);

  function searchProducts(itemId: string, query: string) {
    setProductSearch(prev => ({ ...prev, [itemId]: query }));
    clearTimeout(suggestDebounce.current[itemId]);
    if (!query.trim()) { setSuggestions(prev => ({ ...prev, [itemId]: [] })); setShowSuggestions(prev => ({ ...prev, [itemId]: false })); return; }
    suggestDebounce.current[itemId] = setTimeout(() => {
      const filtered = products.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
      setSuggestions(prev => ({ ...prev, [itemId]: filtered }));
      setShowSuggestions(prev => ({ ...prev, [itemId]: filtered.length > 0 }));
    }, 150);
  }

  function selectProduct(itemId: string, product: Product) {
    updateLineItem(itemId, 'name', product.name);
    updateLineItem(itemId, 'description', product.description || '');
    updateLineItem(itemId, 'amount', (product.price / 100).toFixed(2));
    setShowSuggestions(prev => ({ ...prev, [itemId]: false }));
    setProductSearch(prev => ({ ...prev, [itemId]: '' }));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const name = searchParams.get('name');
    const email = searchParams.get('email');
    if (name) setCustomerName(name);
    if (email) setCustomerEmail(email);
  }, [searchParams]);

  // Subtotal = all non-surcharge items
  const subtotalCents = lineItems
    .filter(i => !i.isSurcharge)
    .reduce((sum, item) => {
      const val = parseFloat(item.amount || '0');
      return sum + (isNaN(val) ? 0 : Math.round(val * 100));
    }, 0);

  function updateLineItem(id: string, field: keyof LineItem, value: string) {
    setLineItems((prev) => {
      const updated = prev.map((item) => (item.id === id ? { ...item, [field]: value } : item));
      // Recalculate surcharge when non-surcharge items change
      if (id !== SURCHARGE_ID) {
        const newSubtotal = updated
          .filter(i => !i.isSurcharge)
          .reduce((s, i) => { const v = parseFloat(i.amount || '0'); return s + (isNaN(v) ? 0 : Math.round(v * 100)); }, 0);
        return updated.map(i => i.isSurcharge
          ? { ...i, amount: ((newSubtotal * SURCHARGE_RATE) / 100).toFixed(2) }
          : i
        );
      }
      return updated;
    });
  }

  function removeLineItem(id: string) {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  }

  function addSurcharge() {
    setLineItems(prev => {
      if (prev.find(i => i.isSurcharge)) return prev;
      return [...prev, makeSurcharge(subtotalCents)];
    });
  }

  const totalCents = lineItems.reduce((sum, item) => {
    const val = parseFloat(item.amount || '0');
    return sum + (isNaN(val) ? 0 : Math.round(val * 100));
  }, 0);

  const hasSurcharge = lineItems.some(i => i.isSurcharge);

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
          customerPhone: customerPhone ? toE164(customerPhone) : undefined,
          lineItems: lineItems.map((item) => ({
            name: item.name,
            description: item.description,
            amount: Math.round(parseFloat(item.amount || '0') * 100),
          })),
          price: totalCents,
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

  return (
    <div className="mx-auto max-w-2xl w-full">
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Phone <span className="text-gray-400 font-normal text-xs">(US — for SMS)</span>
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(formatPhoneNumber(e.target.value))}
              placeholder="+1 (555) 000-0000"
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
            />
          </div>
        </div>

        {/* Line Items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-gray-700">
              Line Items <span className="text-red-400">*</span>
            </label>
          </div>

          <div className="rounded-lg border border-gray-200 overflow-hidden">
            {/* Column headers */}
            {/* Column headers — hidden on mobile */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_120px_36px] gap-3 bg-gray-50 px-4 py-2.5 border-b border-gray-200">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Item / Service</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Note / Description</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Amount</span>
              <span />
            </div>

            <div className="divide-y divide-gray-100">
              {lineItems.map((item, idx) => (
                <div key={item.id}
                  className={`flex flex-col sm:grid sm:grid-cols-[1fr_1fr_120px_36px] gap-2 sm:gap-3 px-4 py-3 ${item.isSurcharge ? 'bg-blue-50/40' : ''}`}>
                  <div className="relative">
                    <input
                      type="text"
                      value={item.isSurcharge ? item.name : (productSearch[item.id] !== undefined ? productSearch[item.id] : item.name)}
                      onChange={(e) => {
                        if (item.isSurcharge) { updateLineItem(item.id, 'name', e.target.value); return; }
                        updateLineItem(item.id, 'name', e.target.value);
                        searchProducts(item.id, e.target.value);
                      }}
                      onFocus={() => { if (!item.isSurcharge && item.name) searchProducts(item.id, item.name); }}
                      onBlur={() => setTimeout(() => setShowSuggestions(prev => ({ ...prev, [item.id]: false })), 150)}
                      placeholder={item.isSurcharge ? 'Processing Fee (2.75%)' : `Item ${idx + 1} — type to search products`}
                      className={`w-full rounded-md border px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 ${item.isSurcharge ? 'border-blue-200 bg-blue-50/60 font-medium text-blue-900' : 'border-gray-300'}`}
                    />
                    {!item.isSurcharge && showSuggestions[item.id] && (suggestions[item.id] ?? []).length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                        {(suggestions[item.id] ?? []).map(p => (
                          <button key={p.id} type="button"
                            onMouseDown={() => selectProduct(item.id, p)}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{p.name}</p>
                              {p.description && <p className="text-xs text-gray-400">{p.description}</p>}
                            </div>
                            <span className="text-xs font-semibold text-gray-600 ml-3 flex-shrink-0">{formatCents(p.price)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                    placeholder={item.isSurcharge ? 'Credit card processing surcharge' : 'Optional note...'}
                    className={`w-full rounded-md border px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 ${item.isSurcharge ? 'border-blue-200 bg-blue-50/60 text-blue-700' : 'border-gray-300 text-gray-900'}`}
                  />
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:flex-none sm:w-full">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.amount}
                        onChange={(e) => updateLineItem(item.id, 'amount', e.target.value)}
                        placeholder="0.00"
                        className={`w-full rounded-md border pl-6 pr-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900 ${item.isSurcharge ? 'border-blue-200 bg-blue-50/60 font-medium' : 'border-gray-300'}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLineItem(item.id)}
                      className="sm:hidden p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLineItem(item.id)}
                    className="hidden sm:block mt-1.5 p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title={item.isSurcharge ? 'Remove processing fee' : 'Remove item'}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>

            {/* Footer: Add line + subtotal + total */}
            <div className="border-t border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setLineItems((prev) => {
                      const nonSurcharge = prev.filter(i => !i.isSurcharge);
                      const surcharge = prev.filter(i => i.isSurcharge);
                      return [...nonSurcharge, emptyLineItem(), ...surcharge];
                    })}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-900 hover:opacity-80 transition-opacity"
                  >
                    <Plus size={14} />
                    Add Line Item
                  </button>
                  {!hasSurcharge && (
                    <button
                      type="button"
                      onClick={addSurcharge}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <Plus size={12} />
                      Add 2.75% fee
                    </button>
                  )}
                </div>
                <div className="flex flex-col items-end gap-0.5 text-sm">
                  {hasSurcharge && (
                    <div className="flex items-center gap-3 text-gray-400">
                      <span>Subtotal</span>
                      <span className="min-w-[80px] text-right">{formatCents(subtotalCents)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 font-semibold text-gray-900">
                    <span>Total</span>
                    <span className="min-w-[80px] text-right">{totalCents > 0 ? formatCents(totalCents) : '$0.00'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
            style={{ backgroundColor: '#1b1b1b' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#333333')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1b1b1b')}
          >
            <Send size={16} />
            {submitting ? 'Sending...' : 'Send Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
