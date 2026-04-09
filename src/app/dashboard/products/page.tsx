'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Loader2, Package, Check, X } from 'lucide-react';
import { formatCents } from '@/lib/utils';

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string;
  active: boolean;
  created_at: string;
}

const UNITS = ['item', 'hour', 'day', 'person', 'package', 'flat fee'];
const INPUT = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';

function emptyForm() {
  return { name: '', description: '', price: '', unit: 'item' };
}

export default function ProductsPage() {
  const [products, setProducts]   = useState<Product[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editing, setEditing]     = useState<Product | null>(null);
  const [form, setForm]           = useState(emptyForm());
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(d => setProducts(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setError('');
    setShowForm(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description || '',
      price: (p.price / 100).toFixed(2),
      unit: p.unit,
    });
    setError('');
    setShowForm(true);
  }

  function cancel() { setShowForm(false); setEditing(null); setForm(emptyForm()); setError(''); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (editing) {
        const res = await fetch(`/api/products/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error); return; }
        setProducts(prev => prev.map(p => p.id === editing.id ? data : p));
      } else {
        const res = await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error); return; }
        setProducts(prev => [...prev, data]);
      }
      cancel();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Archive this product?')) return;
    setDeletingId(id);
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
    setProducts(prev => prev.filter(p => p.id !== id));
    setDeletingId(null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Products</h1>
          <p className="mt-1 text-sm text-gray-500">Create products and services to quickly add to invoices</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shadow-sm"
          style={{ backgroundColor: '#1b1b1b' }}>
          <Plus size={15} /> Add Product
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">{editing ? 'Edit Product' : 'New Product'}</h2>
            <button onClick={cancel} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={16} /></button>
          </div>
          <form onSubmit={save} className="px-6 py-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Product / Service Name <span className="text-red-400">*</span></label>
                <input type="text" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Grand Ballroom Rental, Catering Package" className={INPUT} autoFocus />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                <input type="text" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Brief description shown on invoices" className={INPUT} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Default Price</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
                    placeholder="0.00" className={`${INPUT} pl-7`} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Unit</label>
                <div className="relative">
                  <select value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                    className={`${INPUT} appearance-none pr-8`}>
                    {UNITS.map(u => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={cancel}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                style={{ backgroundColor: '#1b1b1b' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Products list */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Package size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-900">Products & Services</span>
          <span className="ml-auto text-xs text-gray-400">{products.length} item{products.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
        ) : products.length === 0 ? (
          <div className="py-14 text-center">
            <Package size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">No products yet</p>
            <p className="text-xs text-gray-400 mt-1">Add products to quickly populate invoice line items</p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[1fr_180px_100px_90px] gap-4 px-6 py-2.5 border-b border-gray-100 bg-gray-50/60">
              {['Product / Service', 'Description', 'Price', 'Actions'].map(h => (
                <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{h}</span>
              ))}
            </div>
            <div className="divide-y divide-gray-50">
              {products.map(p => (
                <div key={p.id} className="flex flex-col sm:grid sm:grid-cols-[1fr_180px_100px_90px] gap-2 sm:gap-4 px-6 py-4 hover:bg-gray-50/40 transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5 capitalize sm:hidden">{p.description || p.unit}</p>
                  </div>
                  <p className="hidden sm:block text-sm text-gray-500 truncate self-center">{p.description || <span className="text-gray-300">—</span>}</p>
                  <div className="flex items-center gap-1.5 self-center">
                    <span className="text-sm font-semibold text-gray-900">{formatCents(p.price)}</span>
                    <span className="text-xs text-gray-400">/ {p.unit}</span>
                  </div>
                  <div className="flex items-center gap-1 self-center">
                    <button onClick={() => openEdit(p)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(p.id)} disabled={deletingId === p.id}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                      {deletingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
