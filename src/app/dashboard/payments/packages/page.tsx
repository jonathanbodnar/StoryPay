'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Plus, Trash2, Pencil, Layers } from 'lucide-react';
import { formatCents } from '@/lib/utils';

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none transition-colors';
const LABEL = 'block text-sm font-medium text-gray-700 mb-1.5';

type ProductOpt = { id: string; name: string; price: number; active: boolean };

type EmbeddedProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  active: boolean;
};

type PackageLine = {
  id?: string;
  product_id: string;
  quantity: number;
  price_override_cents: number | null;
  sort_order: number;
  venue_products?: EmbeddedProduct | EmbeddedProduct[] | null;
};

type VenuePackage = {
  id: string;
  name: string;
  description: string | null;
  season_label: string | null;
  valid_from: string | null;
  valid_to: string | null;
  minimum_subtotal_cents: number;
  sort_order: number;
  active: boolean;
  venue_package_lines: PackageLine[];
};

function normProduct(line: PackageLine): EmbeddedProduct | null {
  const v = line.venue_products;
  const p = Array.isArray(v) ? v[0] : v;
  return p && p.id ? p : null;
}

export default function VenuePackagesPage() {
  const [rows, setRows] = useState<VenuePackage[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    season_label: '',
    valid_from: '',
    valid_to: '',
    minimum_dollars: '0',
    lines: [] as Array<{ product_id: string; quantity: string; override_dollars: string }>,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pr, pk] = await Promise.all([
        fetch('/api/products?manage=1', { cache: 'no-store' }),
        fetch('/api/venue-packages?manage=1', { cache: 'no-store' }),
      ]);
      const pj = await pr.json();
      const kj = await pk.json();
      if (!pr.ok) {
        setError(typeof pj.error === 'string' ? pj.error : 'Failed to load products');
        return;
      }
      if (!pk.ok) {
        setError(typeof kj.error === 'string' ? kj.error : 'Failed to load packages');
        return;
      }
      setProducts(
        (Array.isArray(pj) ? pj : [])
          .filter((p: ProductOpt) => p.active !== false)
          .map((p: ProductOpt) => ({ id: p.id, name: p.name, price: p.price, active: p.active })),
      );
      setRows(Array.isArray(kj) ? kj : []);
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
      season_label: '',
      valid_from: '',
      valid_to: '',
      minimum_dollars: '0',
      lines: [{ product_id: '', quantity: '1', override_dollars: '' }],
    });
  }

  function startEdit(p: VenuePackage) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description || '',
      season_label: p.season_label || '',
      valid_from: p.valid_from || '',
      valid_to: p.valid_to || '',
      minimum_dollars: (p.minimum_subtotal_cents / 100).toFixed(2),
      lines:
        p.venue_package_lines?.length ?
          p.venue_package_lines.map((L) => ({
            product_id: L.product_id,
            quantity: String(L.quantity),
            override_dollars:
              L.price_override_cents != null ? (L.price_override_cents / 100).toFixed(2) : '',
          }))
        : [{ product_id: '', quantity: '1', override_dollars: '' }],
    });
  }

  function buildLinesPayload() {
    const out: Array<{ product_id: string; quantity: number; price_override_cents: number | null }> = [];
    for (const L of form.lines) {
      if (!L.product_id) continue;
      const q = Math.max(1, parseInt(L.quantity || '1', 10) || 1);
      const od = L.override_dollars.trim();
      let price_override_cents: number | null = null;
      if (od !== '') {
        const dollars = parseFloat(od);
        if (Number.isFinite(dollars) && dollars >= 0) {
          price_override_cents = Math.round(dollars * 100);
        }
      }
      out.push({ product_id: L.product_id, quantity: q, price_override_cents });
    }
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (!form.name.trim()) {
        setError('Package name is required.');
        return;
      }
      const minCents = Math.max(0, Math.round(parseFloat(form.minimum_dollars || '0') * 100) || 0);
      const lines = buildLinesPayload();
      if (lines.length === 0) {
        setError('Add at least one product line.');
        return;
      }

      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        season_label: form.season_label.trim() || null,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        minimum_subtotal_cents: minCents,
        lines,
      };

      if (editingId) {
        const res = await fetch(`/api/venue-packages/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, lines }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof j.error === 'string' ? j.error : 'Save failed');
          return;
        }
      } else {
        const res = await fetch('/api/venue-packages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(typeof j.error === 'string' ? j.error : 'Create failed');
          return;
        }
      }
      resetForm();
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(id: string) {
    if (!confirm('Deactivate this package? It will disappear from new quotes.')) return;
    const res = await fetch(`/api/venue-packages/${id}`, { method: 'DELETE' });
    if (res.ok) void load();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/dashboard/payments/new"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft size={16} />
        New proposal / invoice
      </Link>
      <div className="mb-6 flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gray-100">
          <Layers className="text-gray-700" size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quote packages</h1>
          <p className="mt-1 text-sm text-gray-600">
            Bundled line items for seasonal pricing and minimums. Apply on{' '}
            <Link href="/dashboard/payments/new" className="font-medium text-gray-900 underline underline-offset-2">
              new proposals
            </Link>
            .
          </p>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {loading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : (
        <ul className="mb-10 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {r.name}{' '}
                    {!r.active ? <span className="text-xs font-normal text-amber-700">(inactive)</span> : null}
                  </p>
                  {r.season_label ? (
                    <p className="text-xs text-gray-500">Season: {r.season_label}</p>
                  ) : null}
                  <p className="text-xs text-gray-500">
                    Min. subtotal {formatCents(r.minimum_subtotal_cents)} ·{' '}
                    {r.valid_from || r.valid_to ?
                      `${r.valid_from ?? '…'} → ${r.valid_to ?? '…'}`
                    : 'Always available'}
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-gray-700">
                    {r.venue_package_lines?.map((L) => {
                      const p = normProduct(L);
                      const unit = L.price_override_cents ?? p?.price ?? 0;
                      const sum = unit * L.quantity;
                      return (
                        <li key={L.id ?? `${L.product_id}-${L.sort_order}`}>
                          {p?.name ?? 'Product'} × {L.quantity} · {formatCents(sum)}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-gray-50"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deactivate(r.id)}
                    className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
              No packages yet. Create one below.
            </li>
          ) : null}
        </ul>
      )}

      <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">{editingId ? 'Edit package' : 'New package'}</h2>
        <div>
          <label className={LABEL}>Name</label>
          <input className={INPUT} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className={LABEL}>Description (optional)</label>
          <textarea
            className={INPUT}
            rows={2}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Season label (optional)</label>
            <input
              className={INPUT}
              value={form.season_label}
              onChange={(e) => setForm((f) => ({ ...f, season_label: e.target.value }))}
              placeholder="Saturday peak"
            />
          </div>
          <div>
            <label className={LABEL}>Minimum subtotal ($)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              className={INPUT}
              value={form.minimum_dollars}
              onChange={(e) => setForm((f) => ({ ...f, minimum_dollars: e.target.value }))}
            />
          </div>
          <div>
            <label className={LABEL}>Valid from</label>
            <input
              type="date"
              className={INPUT}
              value={form.valid_from}
              onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
            />
          </div>
          <div>
            <label className={LABEL}>Valid to</label>
            <input
              type="date"
              className={INPUT}
              value={form.valid_to}
              onChange={(e) => setForm((f) => ({ ...f, valid_to: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <p className={LABEL}>Lines</p>
          <div className="space-y-2">
            {form.lines.map((L, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-gray-50/80 p-3">
                <div className="min-w-[160px] flex-1">
                  <label className="text-[11px] text-gray-500">Product</label>
                  <select
                    className={INPUT}
                    value={L.product_id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        lines: f.lines.map((x, i) => (i === idx ? { ...x, product_id: v } : x)),
                      }));
                    }}
                  >
                    <option value="">Select…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCents(p.price)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
                  <label className="text-[11px] text-gray-500">Qty</label>
                  <input
                    type="number"
                    min={1}
                    className={INPUT}
                    value={L.quantity}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        lines: f.lines.map((x, i) => (i === idx ? { ...x, quantity: v } : x)),
                      }));
                    }}
                  />
                </div>
                <div className="w-28">
                  <label className="text-[11px] text-gray-500">Override $</label>
                  <input
                    className={INPUT}
                    placeholder="opt."
                    value={L.override_dollars}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        lines: f.lines.map((x, i) => (i === idx ? { ...x, override_dollars: v } : x)),
                      }));
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="mb-0.5 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      lines: f.lines.filter((_, i) => i !== idx),
                    }))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  lines: [...f.lines, { product_id: '', quantity: '1', override_dollars: '' }],
                }))
              }
            >
              <Plus size={14} /> Add line
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create package'}
          </button>
          {editingId ? (
            <button type="button" className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm" onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
