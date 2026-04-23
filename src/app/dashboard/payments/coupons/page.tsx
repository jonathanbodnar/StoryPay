'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { VenueCouponRow } from '@/lib/venue-coupons-logic';

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors';
const LABEL = 'block text-sm font-medium text-gray-700 mb-1.5';

export default function VenueCouponsPage() {
  const [coupons, setCoupons] = useState<VenueCouponRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    discount_type: 'percent' as 'percent' | 'fixed_cents',
    discount_percent: '',
    discount_dollars: '',
    max_redemptions: '' as string,
    unlimited: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/venue-coupons', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Failed to load coupons');
        return;
      }
      setCoupons(Array.isArray(d.coupons) ? d.coupons : []);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setForm({
      code: '',
      name: '',
      description: '',
      discount_type: 'percent',
      discount_percent: '',
      discount_dollars: '',
      max_redemptions: '',
      unlimited: true,
    });
  }

  function startEdit(c: VenueCouponRow) {
    setEditingId(c.id);
    const max = c.max_redemptions;
    setForm({
      code: c.code,
      name: c.name,
      description: c.description || '',
      discount_type: c.discount_type,
      discount_percent: c.discount_type === 'percent' && c.discount_percent != null
        ? String(Math.round(Number(c.discount_percent) / 5) * 5)
        : '',
      discount_dollars:
        c.discount_type === 'fixed_cents' && c.discount_amount_cents != null
          ? (c.discount_amount_cents / 100).toFixed(2)
          : '',
      max_redemptions: max == null ? '' : String(max),
      unlimited: max == null,
    });
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const code = form.code.trim();
      const name = form.name.trim();
      if (!code || !name) {
        setError('Code and name are required.');
        return;
      }
      const body: Record<string, unknown> = {
        code,
        name,
        description: form.description.trim() || null,
        discount_type: form.discount_type,
        max_redemptions: form.unlimited ? null : Math.max(1, parseInt(form.max_redemptions || '1', 10)),
        active: true,
      };
      if (form.discount_type === 'percent') {
        const p = parseInt(form.discount_percent, 10);
        if (!Number.isFinite(p) || p < 5 || p > 100 || p % 5 !== 0) {
          setError('Select a percentage between 5% and 100%.');
          return;
        }
        body.discount_percent = p;
      } else {
        const dollars = parseFloat(form.discount_dollars);
        if (!Number.isFinite(dollars) || dollars <= 0) {
          setError('Enter a valid dollar amount.');
          return;
        }
        body.discount_amount_cents = Math.round(dollars * 100);
      }

      const res = await fetch('/api/venue-coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Could not create coupon');
        return;
      }
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError('');
    try {
      const code = form.code.trim();
      const name = form.name.trim();
      if (!code || !name) {
        setError('Code and name are required.');
        return;
      }
      const body: Record<string, unknown> = {
        code,
        name,
        description: form.description.trim() || null,
        discount_type: form.discount_type,
        max_redemptions: form.unlimited ? null : Math.max(1, parseInt(form.max_redemptions || '1', 10)),
      };
      if (form.discount_type === 'percent') {
        const p = parseInt(form.discount_percent, 10);
        if (!Number.isFinite(p) || p < 5 || p > 100 || p % 5 !== 0) {
          setError('Select a percentage between 5% and 100%.');
          return;
        }
        body.discount_percent = p;
      } else {
        const dollars = parseFloat(form.discount_dollars);
        if (!Number.isFinite(dollars) || dollars <= 0) {
          setError('Enter a valid dollar amount.');
          return;
        }
        body.discount_amount_cents = Math.round(dollars * 100);
      }

      const res = await fetch(`/api/venue-coupons/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Could not update coupon');
        return;
      }
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function removeCoupon(c: VenueCouponRow) {
    const msg =
      (c.uses_count ?? 0) > 0
        ? 'This coupon has been used. It will be deactivated instead of deleted. Continue?'
        : 'Delete this coupon permanently?';
    if (!confirm(msg)) return;
    setError('');
    try {
      const res = await fetch(`/api/venue-coupons/${c.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Could not remove coupon');
        return;
      }
      await load();
    } catch {
      setError('Network error');
    }
  }

  async function toggleActive(c: VenueCouponRow) {
    setError('');
    try {
      const res = await fetch(`/api/venue-coupons/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !c.active }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Could not update');
        return;
      }
      await load();
    } catch {
      setError('Network error');
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link
        href="/dashboard/payments/new"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 mb-4 transition-colors"
      >
        <ArrowLeft size={14} /> Back to New proposal & invoice
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
        <p className="text-sm text-gray-500 mt-1">
          Create discount codes for proposals and invoices. Apply them as a line item when you send a document.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
          {editingId ? <Pencil size={16} className="text-gray-500" /> : <Plus size={16} className="text-gray-500" />}
          <p className="text-sm font-semibold text-gray-900">{editingId ? 'Edit coupon' : 'New coupon'}</p>
        </div>
        <form
          onSubmit={editingId ? submitEdit : submitCreate}
          className="px-5 py-4 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Code</label>
              <input
                className={INPUT}
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="e.g. SUMMER2026"
                autoComplete="off"
              />
            </div>
            <div>
              <label className={LABEL}>Display name</label>
              <input
                className={INPUT}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Shown on the discount line"
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>Description (optional)</label>
            <input
              className={INPUT}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Internal note"
            />
          </div>

          <div>
            <label className={LABEL}>Discount type</label>
            <div className="flex flex-wrap gap-2">
              {(['percent', 'fixed_cents'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, discount_type: t }))}
                  className={`rounded-2xl border-2 px-4 py-2 text-sm font-medium transition-all ${
                    form.discount_type === t
                      ? 'border-gray-900 bg-gray-50 text-gray-900'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {t === 'percent' ? 'Percentage' : 'Fixed amount'}
                </button>
              ))}
            </div>
          </div>

          {form.discount_type === 'percent' ? (
            <div>
              <label className={LABEL}>Percent off</label>
              <select
                className={INPUT}
                value={form.discount_percent}
                onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))}
              >
                <option value="">Select percentage…</option>
                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map((pct) => (
                  <option key={pct} value={String(pct)}>{pct}%</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className={LABEL}>Amount off</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  className={`${INPUT} pl-7`}
                  value={form.discount_dollars}
                  onChange={(e) => setForm((f) => ({ ...f, discount_dollars: e.target.value }))}
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={form.unlimited}
                onChange={(e) => setForm((f) => ({ ...f, unlimited: e.target.checked }))}
              />
              Unlimited redemptions
            </label>
            {!form.unlimited && (
              <div>
                <label className={LABEL}>Max uses (total)</label>
                <input
                  type="number"
                  min={1}
                  className={INPUT}
                  value={form.max_redemptions}
                  onChange={(e) => setForm((f) => ({ ...f, max_redemptions: e.target.value }))}
                  placeholder="1 = one-time"
                />
                <p className="text-xs text-gray-500 mt-1">Leave unlimited off and set 1 for a single-use code.</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {editingId ? 'Save changes' : 'Create coupon'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={() => resetForm()}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900">Your coupons</p>
        </div>
        {loading ? (
          <div className="py-16 flex justify-center text-gray-400">
            <Loader2 className="animate-spin" size={24} />
          </div>
        ) : coupons.length === 0 ? (
          <div className="py-12 px-5 text-center text-sm text-gray-500">No coupons yet. Create one above.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {coupons.map((c) => (
              <li key={c.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    {c.code}
                    {!c.active && (
                      <span className="ml-2 text-xs font-normal text-amber-700">Inactive</span>
                    )}
                  </p>
                  <p className="text-sm text-gray-600">{c.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {c.discount_type === 'percent'
                      ? `${Number(c.discount_percent)}% off`
                      : `$${((c.discount_amount_cents ?? 0) / 100).toFixed(2)} off`}
                    {' · '}
                    {c.max_redemptions == null
                      ? 'Unlimited uses'
                      : c.max_redemptions === 1
                        ? 'One-time'
                        : `Max ${c.max_redemptions} uses`}
                    {' · '}
                    Used {c.uses_count ?? 0}
                    {c.max_redemptions != null ? ` / ${c.max_redemptions}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(c)}
                    className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    {c.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
                    aria-label="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeCoupon(c)}
                    className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete or deactivate"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
