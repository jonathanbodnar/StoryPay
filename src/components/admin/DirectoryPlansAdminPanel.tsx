'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Pencil, Check } from 'lucide-react';

const BRAND = '#1b1b1b';

type FeatureDef = {
  id: string;
  feature_key: string;
  label: string;
  description: string | null;
  category: string | null;
  sort_order: number;
};

type PlanRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  is_default: boolean;
  price_monthly_cents: number | null;
  stripe_price_id: string | null;
  feature_flags: Record<string, boolean>;
};

export function DirectoryPlansAdminPanel() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [newFeat, setNewFeat] = useState({ key: '', label: '', category: '' });
  const [featSaving, setFeatSaving] = useState(false);

  const [planForm, setPlanForm] = useState({
    name: '',
    slug: '',
    description: '',
    sort_order: 0,
    price_monthly_cents: '' as string,
    is_default: false,
  });
  const [planSaving, setPlanSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFlags, setEditFlags] = useState<Record<string, boolean>>({});
  const [editMeta, setEditMeta] = useState({
    name: '',
    slug: '',
    description: '',
    sort_order: 0,
    price_monthly_cents: '' as string,
    is_default: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/directory-plans');
      if (!res.ok) {
        setErr('Could not load plans');
        return;
      }
      const d = (await res.json()) as { plans?: PlanRow[]; features?: FeatureDef[] };
      setPlans(d.plans || []);
      setFeatures(d.features || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addFeature(e: React.FormEvent) {
    e.preventDefault();
    setFeatSaving(true);
    try {
      const res = await fetch('/api/admin/directory-features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature_key: newFeat.key.trim().toLowerCase(),
          label: newFeat.label.trim(),
          category: newFeat.category.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Failed');
        return;
      }
      setNewFeat({ key: '', label: '', category: '' });
      await load();
    } finally {
      setFeatSaving(false);
    }
  }

  async function deleteFeature(id: string) {
    if (!confirm('Delete this feature key? Plans keep JSON flags but UI may show orphan keys.')) return;
    const res = await fetch(`/api/admin/directory-features/${id}`, { method: 'DELETE' });
    if (!res.ok) alert('Delete failed');
    await load();
  }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    setPlanSaving(true);
    try {
      const flags: Record<string, boolean> = {};
      for (const f of features) flags[f.feature_key] = true;

      const res = await fetch('/api/admin/directory-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: planForm.name.trim(),
          slug: planForm.slug.trim().toLowerCase(),
          description: planForm.description.trim() || null,
          sort_order: planForm.sort_order,
          is_default: planForm.is_default,
          price_monthly_cents: planForm.price_monthly_cents
            ? Math.round(parseFloat(planForm.price_monthly_cents) * 100)
            : null,
          feature_flags: flags,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Failed');
        return;
      }
      setPlanForm({
        name: '',
        slug: '',
        description: '',
        sort_order: 0,
        price_monthly_cents: '',
        is_default: false,
      });
      await load();
    } finally {
      setPlanSaving(false);
    }
  }

  function startEdit(p: PlanRow) {
    setEditingId(p.id);
    setEditFlags({ ...(p.feature_flags || {}) });
    setEditMeta({
      name: p.name,
      slug: p.slug,
      description: p.description || '',
      sort_order: p.sort_order,
      price_monthly_cents: p.price_monthly_cents != null ? (p.price_monthly_cents / 100).toFixed(2) : '',
      is_default: p.is_default,
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    const res = await fetch(`/api/admin/directory-plans/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editMeta.name.trim(),
        slug: editMeta.slug.trim().toLowerCase(),
        description: editMeta.description.trim() || null,
        sort_order: editMeta.sort_order,
        is_default: editMeta.is_default,
        price_monthly_cents: editMeta.price_monthly_cents
          ? Math.round(parseFloat(editMeta.price_monthly_cents) * 100)
          : null,
        feature_flags: editFlags,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      alert(j.error || 'Save failed');
      return;
    }
    setEditingId(null);
    await load();
  }

  async function deletePlan(id: string) {
    if (!confirm('Delete this plan? Venues using it will have directory_plan_id set to NULL.')) return;
    const res = await fetch(`/api/admin/directory-plans/${id}`, { method: 'DELETE' });
    if (!res.ok) alert('Delete failed');
    await load();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-gray-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h2 className="font-heading text-xl text-gray-900">Directory plans &amp; features</h2>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          Define feature keys venues can have per plan. Assign plans on the Venue management tab. Venues with no plan
          keep full access (legacy). Stripe fields are optional for later billing.
        </p>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h3 className="font-semibold text-gray-900 mb-3">Feature catalog</h3>
        <form onSubmit={addFeature} className="flex flex-wrap gap-2 items-end mb-4">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Key</label>
            <input
              value={newFeat.key}
              onChange={(e) => setNewFeat({ ...newFeat, key: e.target.value })}
              placeholder="e.g. payments"
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm w-36"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Label</label>
            <input
              value={newFeat.label}
              onChange={(e) => setNewFeat({ ...newFeat, label: e.target.value })}
              placeholder="Display name"
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm w-44"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-1">Category</label>
            <input
              value={newFeat.category}
              onChange={(e) => setNewFeat({ ...newFeat, category: e.target.value })}
              placeholder="Optional"
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm w-32"
            />
          </div>
          <button
            type="submit"
            disabled={featSaving}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {featSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add feature
          </button>
        </form>
        <div className="overflow-x-auto border border-gray-100 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase text-gray-500">
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {features.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2 font-mono text-xs">{f.feature_key}</td>
                  <td className="px-3 py-2">{f.label}</td>
                  <td className="px-3 py-2 text-gray-500">{f.category || '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void deleteFeature(f.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Delete feature"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h3 className="font-semibold text-gray-900 mb-3">New plan</h3>
        <p className="text-xs text-gray-500 mb-3">
          New plans start with <strong>all current features enabled</strong>. Edit the plan to turn features off.
        </p>
        <form onSubmit={createPlan} className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input
              value={planForm.name}
              onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Slug *</label>
            <input
              value={planForm.slug}
              onChange={(e) => setPlanForm({ ...planForm, slug: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono"
              placeholder="starter-tier"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input
              value={planForm.description}
              onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sort order</label>
            <input
              type="number"
              value={planForm.sort_order}
              onChange={(e) => setPlanForm({ ...planForm, sort_order: parseInt(e.target.value, 10) || 0 })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Monthly price (USD)</label>
            <input
              value={planForm.price_monthly_cents}
              onChange={(e) => setPlanForm({ ...planForm, price_monthly_cents: e.target.value })}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="ndef"
              checked={planForm.is_default}
              onChange={(e) => setPlanForm({ ...planForm, is_default: e.target.checked })}
            />
            <label htmlFor="ndef" className="text-sm text-gray-700">
              Default plan for new assignments
            </label>
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={planSaving}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {planSaving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Create plan
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Existing plans</h3>
        <div className="space-y-4">
          {plans.map((p) => (
            <div key={p.id} className="border border-gray-100 rounded-xl p-4">
              {editingId === p.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={editMeta.name}
                      onChange={(e) => setEditMeta({ ...editMeta, name: e.target.value })}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                    />
                    <input
                      value={editMeta.slug}
                      onChange={(e) => setEditMeta({ ...editMeta, slug: e.target.value })}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <input
                    value={editMeta.description}
                    onChange={(e) => setEditMeta({ ...editMeta, description: e.target.value })}
                    placeholder="Description"
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                  />
                  <div className="flex flex-wrap gap-3">
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      Sort{' '}
                      <input
                        type="number"
                        value={editMeta.sort_order}
                        onChange={(e) =>
                          setEditMeta({ ...editMeta, sort_order: parseInt(e.target.value, 10) || 0 })
                        }
                        className="w-16 rounded border border-gray-200 px-1 py-0.5"
                      />
                    </label>
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      $/mo{' '}
                      <input
                        value={editMeta.price_monthly_cents}
                        onChange={(e) => setEditMeta({ ...editMeta, price_monthly_cents: e.target.value })}
                        className="w-20 rounded border border-gray-200 px-1 py-0.5"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={editMeta.is_default}
                        onChange={(e) => setEditMeta({ ...editMeta, is_default: e.target.checked })}
                      />
                      Default
                    </label>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-56 overflow-y-auto border border-gray-50 rounded-lg p-2">
                    {features.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={editFlags[f.feature_key] === true}
                          onChange={(e) =>
                            setEditFlags({ ...editFlags, [f.feature_key]: e.target.checked })
                          }
                        />
                        <span>{f.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveEdit()}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-white"
                      style={{ backgroundColor: BRAND }}
                    >
                      <Check size={14} /> Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">{p.name}</p>
                    <p className="text-xs font-mono text-gray-400">{p.slug}</p>
                    {p.is_default ? (
                      <span className="inline-block mt-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                        Default
                      </span>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                      aria-label="Edit plan"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deletePlan(p.id)}
                      className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-red-50 hover:text-red-600"
                      aria-label="Delete plan"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
