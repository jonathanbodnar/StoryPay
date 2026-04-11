'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Send, FileText, Plus, Trash2, Save, Search, UserPlus, X } from 'lucide-react';
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

interface GHLContact {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
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

function displayName(c: GHLContact) {
  if (c.name) return c.name;
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown';
}

/**
 * Format a US phone number for display as +1 (NXX) NXX-XXXX.
 * Always ensures the +1 country code is present and visible.
 */
function formatPhoneNumber(value: string): string {
  // Strip everything except digits
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  // Remove leading 1 if it was already included (we re-add it below)
  const local = digits.startsWith('1') && digits.length > 10 ? digits.slice(1) : digits;
  if (local.length <= 3) return `+1 (${local}`;
  if (local.length <= 6) return `+1 (${local.slice(0, 3)}) ${local.slice(3)}`;
  if (local.length <= 10) return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6, 10)}`;
}

/** Extract E.164 from a formatted phone string for API submission. */
function toE164(formatted: string): string {
  const digits = formatted.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return formatted; // pass through if already formatted or unknown
}

export default function NewProposalPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [templateId, setTemplateId] = useState('');

  // Customer selection
  const [customerMode, setCustomerMode] = useState<'search' | 'new'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GHLContact[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<GHLContact | null>(null);
  const [ghlConnected, setGhlConnected] = useState<boolean | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const [customerFirst, setCustomerFirst] = useState('');
  const [customerLast, setCustomerLast]   = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const customerName = [customerFirst, customerLast].filter(Boolean).join(' ');

  const [priceDollars, setPriceDollars] = useState('');
  const [includeSurcharge, setIncludeSurcharge] = useState(true);
  const [surchargeOverride, setSurchargeOverride] = useState(''); // empty = auto
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

    fetch('/api/contacts?search=&limit=1')
      .then(async (r) => {
        if (r.ok) {
          setGhlConnected(true);
        } else {
          const body = await r.json().catch(() => ({}));
          if (body.error === 'No customer sources configured') {
            setGhlConnected(false);
            setCustomerMode('new');
          } else {
            setGhlConnected(true);
          }
        }
      })
      .catch(() => {
        setGhlConnected(false);
        setCustomerMode('new');
      });
  }, []);

  const searchContacts = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (customerMode !== 'search' || selectedCustomer) return;
    const t = setTimeout(() => searchContacts(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery, customerMode, selectedCustomer, searchContacts]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectCustomer(c: GHLContact) {
    setSelectedCustomer(c);
    const name = displayName(c);
    const parts = name.trim().split(' ');
    setCustomerFirst(parts[0] || '');
    setCustomerLast(parts.slice(1).join(' ') || '');
    setCustomerEmail(c.email || '');
    setCustomerPhone(c.phone || '');
    setSearchQuery(name);
    setShowDropdown(false);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerFirst('');
    setCustomerLast('');
    setCustomerEmail('');
    setCustomerPhone('');
    setSearchQuery('');
  }

  function switchToNew() {
    setCustomerMode('new');
    setSelectedCustomer(null);
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  }

  function switchToSearch() {
    setCustomerMode('search');
    clearCustomer();
  }

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

  function buildBody(asDraft: boolean) {
    return {
      templateId,
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone ? toE164(customerPhone) : undefined,
      ghlContactId: selectedCustomer?.id || undefined,
      price: pricePreview,
      paymentType,
      paymentConfig: buildPaymentConfig(),
      asDraft,
      surchargeAmount: surchargeCents,
    };
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!templateId || !customerFirst.trim() || !customerLast.trim() || !customerEmail) {
      setError('Please fill in all required fields.');
      return;
    }

    if (basePriceCents <= 0) {
      setError('Please enter a valid price.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(false)),
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

  async function handleSaveDraft() {
    setError('');

    if (!templateId) {
      setError('Please select a template to save a draft.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(true)),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save draft');
      }

      router.push('/dashboard/proposals');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  const basePriceCents = Math.round(parseFloat(priceDollars || '0') * 100);
  const surchargeCents = includeSurcharge
    ? surchargeOverride !== ''
      ? Math.round(parseFloat(surchargeOverride || '0') * 100)
      : Math.round(basePriceCents * 0.0275)
    : 0;
  const pricePreview = basePriceCents + surchargeCents;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-semibold text-gray-900">New Proposal</h1>
        <p className="mt-1 text-sm text-gray-500">Create a new proposal and send it or save as a draft</p>
      </div>

      <form onSubmit={handleSend} className="space-y-6">
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
              className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
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

        {/* Customer section */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Customer <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-1">
              {ghlConnected && (
                <button
                  type="button"
                  onClick={switchToSearch}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    customerMode === 'search'
                      ? 'bg-brand-900/5 text-brand-900'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <Search size={12} className="inline mr-1" />
                  Existing
                </button>
              )}
              <button
                type="button"
                onClick={switchToNew}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  customerMode === 'new'
                    ? 'bg-brand-900/5 text-brand-900'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <UserPlus size={12} className="inline mr-1" />
                New
              </button>
            </div>
          </div>

          {customerMode === 'search' ? (
            <div ref={searchRef} className="relative">
              {selectedCustomer ? (
                <div className="flex items-center justify-between rounded-lg border border-brand-900/20 bg-brand-900/5 px-4 py-3">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{customerName}</span>
                    <span className="ml-2 text-xs text-gray-500">{customerEmail}</span>
                    {customerPhone && (
                      <span className="ml-2 text-xs text-gray-400">{customerPhone}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={clearCustomer}
                    className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowDropdown(true);
                      }}
                      onFocus={() => searchQuery.length >= 2 && setShowDropdown(true)}
                      placeholder="Search by name, email, or phone…"
                      className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
                    />
                    {searchLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-900" />
                      </div>
                    )}
                  </div>

                  {showDropdown && searchQuery.length >= 2 && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-60 overflow-y-auto">
                      {searchResults.length > 0 ? (
                        searchResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectCustomer(c)}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-gray-50 transition-colors"
                          >
                            <div>
                              <span className="font-medium text-gray-900">{displayName(c)}</span>
                              {c.email && (
                                <span className="ml-2 text-xs text-gray-400">{c.email}</span>
                              )}
                            </div>
                            {c.phone && (
                              <span className="text-xs text-gray-400">{c.phone}</span>
                            )}
                          </button>
                        ))
                      ) : !searchLoading ? (
                        <div className="px-4 py-3 text-sm text-gray-500">
                          No customers found.{' '}
                          <button
                            type="button"
                            onClick={switchToNew}
                            className="text-brand-900 font-medium hover:underline"
                          >
                            Create new customer
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-gray-200 p-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  First Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={customerFirst}
                  onChange={(e) => setCustomerFirst(e.target.value)}
                  placeholder="Jane"
                  style={{ fontSize: 16 }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Last Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={customerLast}
                  onChange={(e) => setCustomerLast(e.target.value)}
                  placeholder="Smith"
                  style={{ fontSize: 16 }}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Phone <span className="text-gray-400 font-normal">(US — for SMS)</span>
                </label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(formatPhoneNumber(e.target.value))}
                  placeholder="+1 (555) 000-0000"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
                />
              </div>
              <p className="sm:col-span-2 text-xs text-gray-400">
                A new customer will be created in LunarPay when the proposal is sent. If messaging is connected, a GHL contact will also be created for SMS.
              </p>
            </div>
          )}
        </div>

        {/* Price + Surcharge */}
        <div className="rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Base Price <span className="text-red-400">*</span>
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
          </div>

          {/* Surcharge row */}
          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSurcharge}
                  onChange={e => { setIncludeSurcharge(e.target.checked); setSurchargeOverride(''); }}
                  className="rounded border-gray-300 text-brand-900"
                />
                Include 2.75% processing fee
              </label>
              {includeSurcharge && (
                <span className="text-xs text-blue-600 font-medium">
                  {formatCents(surchargeCents)} added
                </span>
              )}
            </div>
            {includeSurcharge && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Override amount:</span>
                <div className="relative w-32">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={surchargeOverride}
                    onChange={e => setSurchargeOverride(e.target.value)}
                    placeholder={(basePriceCents * 0.0275 / 100).toFixed(2)}
                    className="w-full rounded-lg border border-blue-200 bg-white pl-5 pr-2 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-brand-900 focus:ring-1 focus:ring-brand-900/20 outline-none"
                  />
                </div>
                <span className="text-xs text-gray-400">Leave blank for auto (2.75%)</span>
              </div>
            )}
          </div>

          {/* Total */}
          {basePriceCents > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Total charged to client</span>
              <span className="text-base font-bold text-gray-900">{formatCents(pricePreview)}</span>
            </div>
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
                        setInstallments((prev) =>
                          prev.map((i) => (i.id === inst.id ? { ...i, amount: e.target.value } : i))
                        )
                      }
                      placeholder="0.00"
                      className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
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
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-900 hover:text-brand-900 transition-colors"
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
                    className="w-full rounded-lg border border-gray-300 pl-7 pr-3.5 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Frequency</label>
                <select
                  value={subFrequency}
                  onChange={(e) => setSubFrequency(e.target.value as 'monthly' | 'weekly')}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
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
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-900 focus:ring-2 focus:ring-brand-900/20 outline-none transition"
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
            disabled={submitting || saving || !templateId || !customerFirst.trim() || !customerLast.trim() || !customerEmail}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={16} />
            {submitting ? 'Sending…' : 'Send Proposal'}
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={submitting || saving || !templateId}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/dashboard/proposals')}
            className="rounded-lg px-5 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
