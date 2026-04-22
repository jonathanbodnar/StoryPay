'use client';

/**
 * Unified "Offerings" page — replaces the separate Products and Packages
 * pages with a single catalog that handles both simple items and bundles.
 *
 * Data model notes:
 *  - Simple items are backed by `venue_products` (unchanged) via /api/products.
 *  - Bundles are backed by `venue_packages` (+ `venue_package_lines`) via
 *    /api/venue-packages. Each bundle line still references an existing
 *    product_id, so a venue must first create items before bundling them.
 *    For bundles the UI offers an inline "Quick add item" shortcut that
 *    creates the backing product on the fly and immediately adds it as a
 *    line, so the owner doesn't have to bounce between pages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Package, Layers, Plus, Pencil, Trash2, X, Check, Search,
} from 'lucide-react';
import { formatCents } from '@/lib/utils';

const INPUT =
  'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';
const SELECT = `${INPUT} appearance-none bg-gray-50`;
const BRAND = '#1b1b1b';

// ---- Shared types ---------------------------------------------------------

type Recurrence = 'one_time' | 'monthly' | 'weekly';
type InventoryMode = 'unlimited' | 'limited';

type ItemRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  unit: string;
  recurrence: Recurrence;
  inventory_mode: InventoryMode;
  inventory_quantity: number | null;
  show_on_customer_portal: boolean;
  lunarpay_product_id: string | null;
  active: boolean;
};

type EmbeddedProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  active: boolean;
};

type BundleLine = {
  id?: string;
  product_id: string;
  quantity: number;
  price_override_cents: number | null;
  sort_order: number;
  venue_products?: EmbeddedProduct | EmbeddedProduct[] | null;
};

type BundleRow = {
  id: string;
  name: string;
  description: string | null;
  season_label: string | null;
  valid_from: string | null;
  valid_to: string | null;
  minimum_subtotal_cents: number;
  sort_order: number;
  active: boolean;
  venue_package_lines: BundleLine[];
};

function bundleLineProduct(line: BundleLine): EmbeddedProduct | null {
  const v = line.venue_products;
  const p = Array.isArray(v) ? v[0] : v;
  return p && p.id ? p : null;
}

function bundleTotalCents(bundle: BundleRow): number {
  return (bundle.venue_package_lines ?? []).reduce((sum, l) => {
    const p = bundleLineProduct(l);
    const unit = l.price_override_cents ?? p?.price ?? 0;
    return sum + unit * l.quantity;
  }, 0);
}

// ---- Page component -------------------------------------------------------

type TabFilter = 'all' | 'items' | 'bundles';

export default function OfferingsPage() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<TabFilter>('all');
  const [search, setSearch] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKind, setEditorKind] = useState<'item' | 'bundle'>('item');
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pr, pk] = await Promise.all([
        fetch('/api/products?manage=1', { cache: 'no-store' }),
        fetch('/api/venue-packages?manage=1', { cache: 'no-store' }),
      ]);
      const prJson = await pr.json().catch(() => []);
      const pkJson = await pk.json().catch(() => []);
      if (!pr.ok) {
        setError(typeof prJson.error === 'string' ? prJson.error : 'Failed to load items');
      } else {
        setItems(Array.isArray(prJson) ? prJson : []);
      }
      if (!pk.ok) {
        setError(typeof pkJson.error === 'string' ? pkJson.error : 'Failed to load bundles');
      } else {
        setBundles(Array.isArray(pkJson) ? pkJson : []);
      }
    } catch {
      setError('Network error while loading packages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function openNew(kind: 'item' | 'bundle') {
    setEditorKind(kind);
    setEditingId(null);
    setEditorOpen(true);
  }
  function openEditItem(row: ItemRow) {
    setEditorKind('item');
    setEditingId(row.id);
    setEditorOpen(true);
  }
  function openEditBundle(row: BundleRow) {
    setEditorKind('bundle');
    setEditingId(row.id);
    setEditorOpen(true);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (text: string) => (q ? text.toLowerCase().includes(q) : true);
    const showItems = filter === 'all' || filter === 'items';
    const showBundles = filter === 'all' || filter === 'bundles';
    return {
      items: showItems ? items.filter((r) => matches(r.name)) : [],
      bundles: showBundles ? bundles.filter((r) => matches(r.name)) : [],
    };
  }, [items, bundles, filter, search]);

  const editingItem = useMemo(
    () => (editingId && editorKind === 'item' ? items.find((r) => r.id === editingId) ?? null : null),
    [editingId, editorKind, items],
  );
  const editingBundle = useMemo(
    () => (editingId && editorKind === 'bundle' ? bundles.find((r) => r.id === editingId) ?? null : null),
    [editingId, editorKind, bundles],
  );

  const isEmpty = !loading && filtered.items.length === 0 && filtered.bundles.length === 0;

  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Packages</h1>
          <p className="mt-1 text-sm text-gray-500">
            Everything your venue sells — simple items and bundled packages. Use them on invoices and proposals.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openNew('item')}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            <Plus size={15} /> New item
          </button>
          <button
            type="button"
            onClick={() => openNew('bundle')}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: BRAND }}
          >
            <Plus size={15} /> New bundle
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-2xl border border-gray-200 bg-white p-1">
          {([
            ['all', 'All'],
            ['items', 'Items'],
            ['bundles', 'Bundles'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === id ? 'text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
              style={filter === id ? { backgroundColor: BRAND } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className={`${INPUT} pl-9`}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16 text-gray-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : isEmpty ? (
          <div className="py-14 text-center">
            <Package size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">
              {search ? 'No packages match your search.' : 'No packages yet.'}
            </p>
            {!search ? (
              <p className="mt-1 text-xs text-gray-400">
                Create a simple item, or bundle several items together for package pricing.
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.items.map((row) => (
              <OfferingRowItem
                key={`item-${row.id}`}
                row={row}
                onEdit={() => openEditItem(row)}
                onChanged={loadAll}
                onError={setError}
              />
            ))}
            {filtered.bundles.map((row) => (
              <OfferingRowBundle
                key={`bundle-${row.id}`}
                row={row}
                onEdit={() => openEditBundle(row)}
                onChanged={loadAll}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </div>

      {editorOpen ? (
        <OfferingEditor
          kind={editorKind}
          setKind={setEditorKind}
          editingItem={editingItem}
          editingBundle={editingBundle}
          items={items.filter((i) => i.active)}
          onClose={() => {
            setEditorOpen(false);
            setEditingId(null);
          }}
          onSaved={async () => {
            await loadAll();
          }}
          onItemCreated={(created) => {
            // Optimistic add so the new item is selectable immediately inside
            // the bundle line picker without another API round trip.
            setItems((prev) => [...prev, created]);
          }}
        />
      ) : null}
    </div>
  );
}

// ---- List rows ------------------------------------------------------------

function OfferingRowItem({
  row,
  onEdit,
  onChanged,
  onError,
}: {
  row: ItemRow;
  onEdit: () => void;
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function archive() {
    if (!confirm('Archive this item? It will stop appearing on new invoices and bundles.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/products/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        onError(typeof d.error === 'string' ? d.error : 'Could not archive item.');
        return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Package size={14} className="text-gray-400" />
          <p className="truncate text-sm font-semibold text-gray-900">{row.name}</p>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
            Item
          </span>
          {!row.active ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Inactive
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-gray-400">
          {formatCents(row.price)} / {row.unit}
          {row.recurrence !== 'one_time' ? ` · ${row.recurrence.replace('_', ' ')}` : ''}
          {row.inventory_mode === 'limited' && row.inventory_quantity != null
            ? ` · ${row.inventory_quantity} in stock`
            : ''}
        </p>
        {row.description ? (
          <p className="mt-1 line-clamp-1 text-xs text-gray-500">{row.description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"
          aria-label="Edit item"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => void archive()}
          disabled={busy}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-50"
          aria-label="Archive item"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </li>
  );
}

function OfferingRowBundle({
  row,
  onEdit,
  onChanged,
  onError,
}: {
  row: BundleRow;
  onEdit: () => void;
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function archive() {
    if (!confirm('Archive this bundle? It will stop appearing on new invoices and proposals.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/venue-packages/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        onError(typeof d.error === 'string' ? d.error : 'Could not archive bundle.');
        return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }
  const total = bundleTotalCents(row);
  const lineCount = row.venue_package_lines?.length ?? 0;
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-gray-400" />
          <p className="truncate text-sm font-semibold text-gray-900">{row.name}</p>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
            style={{ backgroundColor: BRAND }}
          >
            Bundle
          </span>
          {!row.active ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Inactive
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-gray-400">
          {lineCount} line{lineCount === 1 ? '' : 's'} · {formatCents(total)}
          {row.season_label ? ` · ${row.season_label}` : ''}
          {row.minimum_subtotal_cents > 0 ? ` · min ${formatCents(row.minimum_subtotal_cents)}` : ''}
        </p>
        {row.venue_package_lines?.length ? (
          <p className="mt-1 line-clamp-1 text-xs text-gray-500">
            {row.venue_package_lines
              .map((L) => {
                const p = bundleLineProduct(L);
                return `${p?.name ?? 'Item'} × ${L.quantity}`;
              })
              .join(' · ')}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50"
          aria-label="Edit bundle"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => void archive()}
          disabled={busy}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-50"
          aria-label="Archive bundle"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      </div>
    </li>
  );
}

// ---- Editor modal ---------------------------------------------------------

function OfferingEditor({
  kind,
  setKind,
  editingItem,
  editingBundle,
  items,
  onClose,
  onSaved,
  onItemCreated,
}: {
  kind: 'item' | 'bundle';
  setKind: (k: 'item' | 'bundle') => void;
  editingItem: ItemRow | null;
  editingBundle: BundleRow | null;
  items: ItemRow[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onItemCreated: (row: ItemRow) => void;
}) {
  const editing = kind === 'item' ? editingItem : editingBundle;
  const isNew = editing == null;
  const title = `${isNew ? 'New' : 'Edit'} ${kind === 'item' ? 'item' : 'bundle'}`;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl rounded-3xl border border-gray-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">{title}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              {kind === 'item'
                ? 'A single priced line item — one thing, one price.'
                : 'Multiple items rolled into one package with optional seasonal pricing.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {isNew ? (
          <div className="border-b border-gray-200 px-5 py-3">
            <div className="inline-flex rounded-2xl border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setKind('item')}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  kind === 'item' ? 'text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
                style={kind === 'item' ? { backgroundColor: BRAND } : undefined}
              >
                Simple item
              </button>
              <button
                type="button"
                onClick={() => setKind('bundle')}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  kind === 'bundle' ? 'text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
                style={kind === 'bundle' ? { backgroundColor: BRAND } : undefined}
              >
                Bundle
              </button>
            </div>
          </div>
        ) : null}

        {kind === 'item' ? (
          <ItemForm
            editing={editingItem}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : (
          <BundleForm
            editing={editingBundle}
            items={items}
            onClose={onClose}
            onSaved={onSaved}
            onItemCreated={onItemCreated}
          />
        )}
      </div>
    </div>
  );
}

// ---- Item form ------------------------------------------------------------

type ItemFormState = {
  name: string;
  description: string;
  price: string;
  unit: string;
  recurrence: Recurrence;
  inventory_mode: InventoryMode;
  inventory_quantity: string;
  show_on_customer_portal: boolean;
  active: boolean;
};

function emptyItemForm(): ItemFormState {
  return {
    name: '',
    description: '',
    price: '',
    unit: 'item',
    recurrence: 'one_time',
    inventory_mode: 'unlimited',
    inventory_quantity: '',
    show_on_customer_portal: false,
    active: true,
  };
}

function ItemForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: ItemRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<ItemFormState>(() =>
    editing
      ? {
          name: editing.name,
          description: editing.description || '',
          price: (editing.price / 100).toFixed(2),
          unit: editing.unit || 'item',
          recurrence: editing.recurrence,
          inventory_mode: editing.inventory_mode,
          inventory_quantity:
            editing.inventory_mode === 'limited' && editing.inventory_quantity != null
              ? String(editing.inventory_quantity)
              : '',
          show_on_customer_portal: editing.show_on_customer_portal,
          active: editing.active,
        }
      : emptyItemForm(),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setErr('Name is required.');
      return;
    }
    const priceDollars = parseFloat(form.price || '0');
    if (!Number.isFinite(priceDollars) || priceDollars < 0) {
      setErr('Enter a valid price.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: priceDollars,
        unit: form.unit.trim() || 'item',
        recurrence: form.recurrence,
        inventory_mode: form.inventory_mode,
        inventory_quantity:
          form.inventory_mode === 'limited'
            ? Math.max(0, parseInt(form.inventory_quantity || '0', 10) || 0)
            : null,
        show_on_customer_portal: form.show_on_customer_portal,
      };
      if (editing) body.active = form.active;
      const url = editing ? `/api/products/${editing.id}` : '/api/products';
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof d.error === 'string' ? d.error : 'Save failed.');
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      {err ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
      ) : null}
      <div>
        <label className={LABEL}>Name</label>
        <input
          className={INPUT}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Grand Ballroom rental"
          autoFocus
          required
        />
      </div>
      <div>
        <label className={LABEL}>Description (optional)</label>
        <textarea
          className={`${INPUT} min-h-[72px]`}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Shown on invoices and proposals."
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Price (USD)</label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">$</span>
            <input
              className={`${INPUT} pl-7`}
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              placeholder="0.00"
              required
            />
          </div>
        </div>
        <div>
          <label className={LABEL}>Unit</label>
          <input
            className={INPUT}
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            placeholder="item, hour, person, package…"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Recurrence</label>
          <select
            className={SELECT}
            value={form.recurrence}
            onChange={(e) => setForm((f) => ({ ...f, recurrence: e.target.value as Recurrence }))}
          >
            <option value="one_time">One time</option>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div>
          <label className={LABEL}>Inventory</label>
          <select
            className={SELECT}
            value={form.inventory_mode}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                inventory_mode: e.target.value as InventoryMode,
                inventory_quantity: e.target.value === 'limited' ? f.inventory_quantity : '',
              }))
            }
          >
            <option value="unlimited">Unlimited</option>
            <option value="limited">Limited quantity</option>
          </select>
          {form.inventory_mode === 'limited' ? (
            <input
              className={`${INPUT} mt-2`}
              type="number"
              min={0}
              value={form.inventory_quantity}
              onChange={(e) => setForm((f) => ({ ...f, inventory_quantity: e.target.value }))}
              placeholder="Quantity"
            />
          ) : null}
        </div>
      </div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={form.show_on_customer_portal}
          onChange={(e) => setForm((f) => ({ ...f, show_on_customer_portal: e.target.checked }))}
        />
        <span className="text-sm text-gray-700">
          Show on customer portal
          <span className="block text-xs text-gray-400">Reserved for future portal catalog features.</span>
        </span>
      </label>
      {editing ? (
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          <span className="text-sm text-gray-700">
            Active
            <span className="block text-xs text-gray-400">Uncheck to hide from new invoices and bundles.</span>
          </span>
        </label>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: BRAND }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {editing ? 'Save changes' : 'Create item'}
        </button>
      </div>
    </form>
  );
}

// ---- Bundle form ----------------------------------------------------------

type BundleLineState = {
  product_id: string;
  quantity: string;
  override_dollars: string;
};

type BundleFormState = {
  name: string;
  description: string;
  season_label: string;
  valid_from: string;
  valid_to: string;
  minimum_dollars: string;
  active: boolean;
  lines: BundleLineState[];
};

function emptyBundleForm(): BundleFormState {
  return {
    name: '',
    description: '',
    season_label: '',
    valid_from: '',
    valid_to: '',
    minimum_dollars: '0',
    active: true,
    lines: [{ product_id: '', quantity: '1', override_dollars: '' }],
  };
}

function BundleForm({
  editing,
  items,
  onClose,
  onSaved,
  onItemCreated,
}: {
  editing: BundleRow | null;
  items: ItemRow[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onItemCreated: (row: ItemRow) => void;
}) {
  const [form, setForm] = useState<BundleFormState>(() =>
    editing
      ? {
          name: editing.name,
          description: editing.description || '',
          season_label: editing.season_label || '',
          valid_from: editing.valid_from || '',
          valid_to: editing.valid_to || '',
          minimum_dollars: (editing.minimum_subtotal_cents / 100).toFixed(2),
          active: editing.active,
          lines:
            editing.venue_package_lines?.length
              ? editing.venue_package_lines.map((L) => ({
                  product_id: L.product_id,
                  quantity: String(L.quantity),
                  override_dollars:
                    L.price_override_cents != null ? (L.price_override_cents / 100).toFixed(2) : '',
                }))
              : [{ product_id: '', quantity: '1', override_dollars: '' }],
        }
      : emptyBundleForm(),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Inline "quick add item" sub-form, tied to a specific line index.
  const [quickAddIdx, setQuickAddIdx] = useState<number | null>(null);
  const [quickAdd, setQuickAdd] = useState({ name: '', price: '', unit: 'item' });
  const [quickAddBusy, setQuickAddBusy] = useState(false);

  async function createItemInline(idx: number) {
    if (!quickAdd.name.trim()) {
      setErr('Item name is required.');
      return;
    }
    const price = parseFloat(quickAdd.price || '0');
    if (!Number.isFinite(price) || price < 0) {
      setErr('Enter a valid price.');
      return;
    }
    setQuickAddBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: quickAdd.name.trim(),
          price,
          unit: quickAdd.unit.trim() || 'item',
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof d.error === 'string' ? d.error : 'Could not create item.');
        return;
      }
      const created = d as ItemRow;
      onItemCreated(created);
      setForm((f) => ({
        ...f,
        lines: f.lines.map((L, i) => (i === idx ? { ...L, product_id: created.id } : L)),
      }));
      setQuickAdd({ name: '', price: '', unit: 'item' });
      setQuickAddIdx(null);
    } finally {
      setQuickAddBusy(false);
    }
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
    if (!form.name.trim()) {
      setErr('Bundle name is required.');
      return;
    }
    const lines = buildLinesPayload();
    if (lines.length === 0) {
      setErr('Add at least one line to the bundle.');
      return;
    }
    const minCents = Math.max(0, Math.round(parseFloat(form.minimum_dollars || '0') * 100) || 0);
    setSaving(true);
    setErr('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        season_label: form.season_label.trim() || null,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        minimum_subtotal_cents: minCents,
        lines,
      };
      if (editing) body.active = form.active;
      const url = editing ? `/api/venue-packages/${editing.id}` : '/api/venue-packages';
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(typeof d.error === 'string' ? d.error : 'Save failed.');
        return;
      }
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const subtotal = useMemo(() => {
    return form.lines.reduce((sum, L) => {
      if (!L.product_id) return sum;
      const item = items.find((it) => it.id === L.product_id);
      const qty = Math.max(1, parseInt(L.quantity || '1', 10) || 1);
      const od = L.override_dollars.trim();
      const unitCents =
        od !== '' && Number.isFinite(parseFloat(od))
          ? Math.round(parseFloat(od) * 100)
          : item?.price ?? 0;
      return sum + unitCents * qty;
    }, 0);
  }, [form.lines, items]);

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      {err ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>
      ) : null}
      <div>
        <label className={LABEL}>Bundle name</label>
        <input
          className={INPUT}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Saturday peak wedding package"
          autoFocus
          required
        />
      </div>
      <div>
        <label className={LABEL}>Description (optional)</label>
        <textarea
          className={`${INPUT} min-h-[72px]`}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Shown on invoices and proposals."
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">$</span>
            <input
              className={`${INPUT} pl-7`}
              inputMode="decimal"
              value={form.minimum_dollars}
              onChange={(e) => setForm((f) => ({ ...f, minimum_dollars: e.target.value }))}
              placeholder="0.00"
            />
          </div>
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
        <div className="mb-2 flex items-center justify-between">
          <p className={LABEL}>Lines</p>
          <p className="text-xs text-gray-500">
            Subtotal: <span className="font-semibold text-gray-900">{formatCents(subtotal)}</span>
          </p>
        </div>
        <div className="space-y-2">
          {form.lines.map((L, idx) => (
            <div key={idx} className="rounded-xl border border-gray-100 bg-gray-50/80 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[160px] flex-1">
                  <label className="text-[11px] text-gray-500">Item</label>
                  <select
                    className={SELECT}
                    value={L.product_id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        lines: f.lines.map((x, i) => (i === idx ? { ...x, product_id: v } : x)),
                      }));
                    }}
                  >
                    <option value="">Select an item…</option>
                    {items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCents(p.price)})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-20">
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
                    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))
                  }
                  aria-label="Remove line"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {!L.product_id ? (
                quickAddIdx === idx ? (
                  <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-dashed border-gray-300 bg-white p-3 sm:grid-cols-[1fr_140px_100px_auto]">
                    <input
                      className={INPUT}
                      placeholder="New item name"
                      value={quickAdd.name}
                      onChange={(e) => setQuickAdd((q) => ({ ...q, name: e.target.value }))}
                    />
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-400">$</span>
                      <input
                        className={`${INPUT} pl-7`}
                        inputMode="decimal"
                        placeholder="Price"
                        value={quickAdd.price}
                        onChange={(e) => setQuickAdd((q) => ({ ...q, price: e.target.value }))}
                      />
                    </div>
                    <input
                      className={INPUT}
                      placeholder="Unit"
                      value={quickAdd.unit}
                      onChange={(e) => setQuickAdd((q) => ({ ...q, unit: e.target.value }))}
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void createItemInline(idx)}
                        disabled={quickAddBusy}
                        className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                        style={{ backgroundColor: BRAND }}
                      >
                        {quickAddBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Create
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickAddIdx(null);
                          setQuickAdd({ name: '', price: '', unit: 'item' });
                        }}
                        className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setQuickAddIdx(idx)}
                    className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    + Create a new item for this line
                  </button>
                )
              ) : null}
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

      {editing ? (
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={form.active}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
          />
          <span className="text-sm text-gray-700">
            Active
            <span className="block text-xs text-gray-400">Uncheck to hide from new invoices and proposals.</span>
          </span>
        </label>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: BRAND }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {editing ? 'Save changes' : 'Create bundle'}
        </button>
      </div>
    </form>
  );
}
