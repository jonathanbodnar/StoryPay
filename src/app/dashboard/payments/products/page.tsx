'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, Package } from 'lucide-react';

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors';
const LABEL = 'block text-sm font-medium text-gray-700 mb-1.5';
const SELECT = INPUT + ' appearance-none bg-white';

type VenueProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string;
  recurrence: string;
  inventory_mode: string;
  inventory_quantity: number | null;
  show_on_customer_portal: boolean;
  lunarpay_product_id: string | null;
  active: boolean;
};

export default function VenueProductsPage() {
  const [rows, setRows] = useState<VenueProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    price: '',
    unit: 'item',
    recurrence: 'one_time' as 'one_time' | 'monthly' | 'weekly',
    inventory_mode: 'unlimited' as 'unlimited' | 'limited',
    inventory_quantity: '',
    show_on_customer_portal: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/products?manage=1', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Failed to load products');
        return;
      }
      setRows(Array.isArray(d) ? d : []);
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
      name: '',
      description: '',
      price: '',
      unit: 'item',
      recurrence: 'one_time',
      inventory_mode: 'unlimited',
      inventory_quantity: '',
      show_on_customer_portal: false,
    });
  }

  function startEdit(p: VenueProductRow) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description || '',
      price: (p.price / 100).toFixed(2),
      unit: p.unit || 'item',
      recurrence: (p.recurrence as typeof form.recurrence) || 'one_time',
      inventory_mode: (p.inventory_mode as typeof form.inventory_mode) || 'unlimited',
      inventory_quantity:
        p.inventory_mode === 'limited' && p.inventory_quantity != null ? String(p.inventory_quantity) : '',
      show_on_customer_portal: p.show_on_customer_portal,
    });
  }

  function buildBody(): Record<string, unknown> {
    const price = parseFloat(form.price || '0');
    if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid price.');
    return {
      name: form.name.trim(),
      description: form.description.trim() || null,
      price,
      unit: form.unit.trim() || 'item',
      recurrence: form.recurrence,
      inventory_mode: form.inventory_mode,
      inventory_quantity:
        form.inventory_mode === 'limited' ? Math.max(0, parseInt(form.inventory_quantity || '0', 10) || 0) : null,
      show_on_customer_portal: form.show_on_customer_portal,
    };
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (!form.name.trim()) {
        setError('Product name is required.');
        return;
      }
      const body = buildBody();
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Could not create product');
        return;
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create product');
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
      if (!form.name.trim()) {
        setError('Product name is required.');
        return;
      }
      const body = buildBody();
      const res = await fetch(`/api/products/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Could not update product');
        return;
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update product');
    } finally {
      setSaving(false);
    }
  }

  async function removeProduct(p: VenueProductRow) {
    if (!confirm('Deactivate this product? It will no longer appear when creating proposals or invoices.')) return;
    setError('');
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === 'string' ? d.error : 'Could not remove product');
        return;
      }
      if (editingId === p.id) resetForm();
      await load();
    } catch {
      setError('Network error');
    }
  }

  async function toggleActive(p: VenueProductRow) {
    setError('');
    try {
      const res = await fetch(`/api/products/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !p.active }),
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
        <h1 className="text-2xl font-bold text-gray-900">Products & services</h1>
        <p className="text-sm text-gray-500 mt-1">
          Save preset line items with fixed prices. When you create a proposal or invoice, type the product name to add
          it quickly. If your LunarPay merchant API supports catalog sync, we store the remote product id when creation
          succeeds.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden mb-8">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
          {editingId ? <Pencil size={16} className="text-gray-500" /> : <Plus size={16} className="text-gray-500" />}
          <p className="text-sm font-semibold text-gray-900">{editingId ? 'Edit product' : 'Create product'}</p>
        </div>
        <form onSubmit={editingId ? submitEdit : submitCreate} className="px-5 py-4 space-y-4">
          <div>
            <label className={LABEL}>Product name</label>
            <input
              className={INPUT}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Conference Ticket"
              required
            />
          </div>
          <div>
            <label className={LABEL}>Description (optional)</label>
            <textarea
              className={`${INPUT} resize-none min-h-[88px]`}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Shown on the line item when selected…"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Price (USD)</label>
              <input
                className={INPUT}
                type="text"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
                required
              />
            </div>
            <div>
              <label className={LABEL}>Unit</label>
              <input
                className={INPUT}
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="item, hour, package…"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Recurrence</label>
              <select
                className={SELECT}
                value={form.recurrence}
                onChange={(e) =>
                  setForm((f) => ({ ...f, recurrence: e.target.value as typeof f.recurrence }))
                }
              >
                <option value="one_time">One time</option>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">For your records; checkout terms still follow the proposal.</p>
            </div>
            <div>
              <label className={LABEL}>Inventory</label>
              <select
                className={SELECT}
                value={form.inventory_mode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    inventory_mode: e.target.value as typeof f.inventory_mode,
                    inventory_quantity: e.target.value === 'limited' ? f.inventory_quantity : '',
                  }))
                }
              >
                <option value="unlimited">Unlimited</option>
                <option value="limited">Limited quantity</option>
              </select>
              {form.inventory_mode === 'limited' && (
                <input
                  className={`${INPUT} mt-2`}
                  type="number"
                  min={0}
                  value={form.inventory_quantity}
                  onChange={(e) => setForm((f) => ({ ...f, inventory_quantity: e.target.value }))}
                  placeholder="Quantity"
                />
              )}
              <p className="text-xs text-gray-400 mt-1">Optional tracking; not enforced at checkout yet.</p>
            </div>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-gray-300"
              checked={form.show_on_customer_portal}
              onChange={(e) => setForm((f) => ({ ...f, show_on_customer_portal: e.target.checked }))}
            />
            <span>
              <span className="text-sm font-medium text-gray-800">Show on customer portal</span>
              <span className="block text-xs text-gray-400 mt-0.5">
                Reserved for future portal catalog features.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              {editingId ? 'Save changes' : 'Create product'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
          <Package size={16} className="text-gray-500" />
          <p className="text-sm font-semibold text-gray-900">Your catalog</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500 px-5 py-10 text-center">No products yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((p) => (
              <li key={p.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    ${(p.price / 100).toFixed(2)} · {p.recurrence.replace('_', ' ')}
                    {!p.active ? ' · Inactive' : ''}
                    {p.lunarpay_product_id ? ` · LunarPay #${p.lunarpay_product_id}` : ''}
                  </p>
                  {p.description ? <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description}</p> : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(p)}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-50"
                  >
                    {p.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"
                    aria-label="Edit"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeProduct(p)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-100 text-red-500 hover:bg-red-50"
                    aria-label="Remove"
                  >
                    <Trash2 size={15} />
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
