'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Pencil, Check, ChevronDown, Copy, Eye, EyeOff, Star, Lock } from 'lucide-react';
import {
  DIRECTORY_NAV_GROUP_LABELS,
  DIRECTORY_NAV_REGISTRY,
  defaultNavPermissionsAllTrue,
  type DirectoryNavGroup,
} from '@/lib/directory-nav-registry';
import { buildPlanNavPayloadFromEditor, mergeNavPermissionsForEditor } from '@/lib/directory-plans-venue';

const BRAND = '#1b1b1b';

const NAV_GROUP_ORDER: DirectoryNavGroup[] = ['main', 'listing', 'payments', 'marketing', 'settings'];

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
  is_public: boolean;
  is_legacy?: boolean;
  highlight_label?: string | null;
  price_monthly_cents: number | null;
  fortis_merchant_id?: string | null;
  feature_flags: Record<string, boolean>;
  nav_permissions?: Record<string, boolean> | null;
  trial_period_value?: number | null;
  trial_period_unit?: 'none' | 'days' | 'weeks' | 'months' | 'years' | 'forever' | string | null;
  hide_header?: boolean;
};

type TrialUnit = 'none' | 'days' | 'weeks' | 'months' | 'years' | 'forever';
const TRIAL_UNIT_OPTIONS: { value: TrialUnit; label: string }[] = [
  { value: 'none', label: 'No trial' },
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' },
  { value: 'forever', label: 'Forever (free)' },
];

function trialDescription(unit: TrialUnit | string | null | undefined, value: number | null | undefined): string {
  const u = (unit as TrialUnit) || 'none';
  if (u === 'none') return 'No trial — billed immediately';
  if (u === 'forever') return 'Perpetual free trial — never auto-billed';
  const v = typeof value === 'number' ? value : 0;
  if (v <= 0) return 'No trial — billed immediately';
  return `${v}-${u.replace(/s$/, '')} free trial — first charge after trial ends`;
}

export function DirectoryPlansAdminPanel() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [platformFortisMerchantIdConfigured, setPlatformFortisMerchantIdConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [trialMigrationMissing, setTrialMigrationMissing] = useState(false);

  const [newFeat, setNewFeat] = useState({ key: '', label: '', category: '' });
  const [featSaving, setFeatSaving] = useState(false);

  const [planForm, setPlanForm] = useState({
    name: '',
    slug: '',
    description: '',
    sort_order: 0,
    price_monthly_cents: '' as string,
    fortis_merchant_id: '',
    is_default: false,
    trial_period_value: '14' as string,
    trial_period_unit: 'none' as TrialUnit,
  });
  const [planSaving, setPlanSaving] = useState(false);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNav, setEditNav] = useState<Record<string, boolean>>({});
  // Per-plan feature-flag extras that aren't owned by the nav editor.  When a
  // plan has these enabled the corresponding paid add-on is auto-included for
  // every venue on that plan and cannot be toggled off at checkout.
  const [editAddons, setEditAddons] = useState({
    verified:            false,
    sponsored:           false,
    concierge_available: false,
    concierge_included:  false,
  });
  const [editMeta, setEditMeta] = useState({
    name: '',
    slug: '',
    description: '',
    sort_order: 0,
    price_monthly_cents: '' as string,
    fortis_merchant_id: '',
    is_default: false,
    is_public: true,
    is_legacy: false,
    highlight_label: '',
    hide_header: false,
    trial_period_value: '0' as string,
    trial_period_unit: 'none' as TrialUnit,
  });
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(null);

  // ── Addon pricing (global, DB-driven) ─────────────────────────────────────
  const [addonPrices, setAddonPrices] = useState({
    verified_cents:  1900,
    sponsored_cents: 9900,
    concierge_cents: 49900,
  });
  const [addonPriceInputs, setAddonPriceInputs] = useState({
    verified:  '19',
    sponsored: '99',
    concierge: '499',
  });
  const [addonPriceSaving, setAddonPriceSaving] = useState(false);
  const [addonPriceMsg, setAddonPriceMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [plansRes, pricesRes] = await Promise.all([
        fetch('/api/admin/directory-plans'),
        fetch('/api/admin/addon-prices'),
      ]);
      if (!plansRes.ok) {
        setErr('Could not load plans');
        return;
      }
      const d = (await plansRes.json()) as {
        plans?: PlanRow[];
        features?: FeatureDef[];
        platformFortisMerchantIdConfigured?: boolean;
      };
      const loadedPlans = d.plans || [];
      setPlans(loadedPlans);
      setFeatures(d.features || []);
      setPlatformFortisMerchantIdConfigured(d.platformFortisMerchantIdConfigured === true);
      if (loadedPlans.length > 0 && loadedPlans[0].trial_period_unit === undefined) {
        setTrialMigrationMissing(true);
      }
      if (pricesRes.ok) {
        const prices = (await pricesRes.json()) as {
          verified_cents?: number;
          sponsored_cents?: number;
          concierge_cents?: number;
        };
        const v  = prices.verified_cents  ?? 1900;
        const s  = prices.sponsored_cents ?? 9900;
        const c  = prices.concierge_cents ?? 49900;
        setAddonPrices({ verified_cents: v, sponsored_cents: s, concierge_cents: c });
        setAddonPriceInputs({
          verified:  String(v / 100),
          sponsored: String(s / 100),
          concierge: String(c / 100),
        });
      }
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
      const { nav_permissions, feature_flags } = buildPlanNavPayloadFromEditor(defaultNavPermissionsAllTrue());

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
          fortis_merchant_id: planForm.fortis_merchant_id.trim() || null,
          nav_permissions,
          feature_flags,
          trial_period_value: planForm.trial_period_unit === 'none' || planForm.trial_period_unit === 'forever'
            ? 0
            : Math.max(0, parseInt(planForm.trial_period_value, 10) || 0),
          trial_period_unit: planForm.trial_period_unit,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; trialSkipped?: boolean };
      if (!res.ok) {
        alert(j.error || 'Failed');
        return;
      }
      if (j.trialSkipped) setTrialMigrationMissing(true);
      setPlanForm({
        name: '',
        slug: '',
        description: '',
        sort_order: 0,
        price_monthly_cents: '',
        fortis_merchant_id: '',
        is_default: false,
        trial_period_value: '14',
        trial_period_unit: 'none',
      });
      setNewPlanOpen(false);
      await load();
    } finally {
      setPlanSaving(false);
    }
  }

  function startEdit(p: PlanRow) {
    setEditingId(p.id);
    setEditNav(mergeNavPermissionsForEditor(p.nav_permissions, p.feature_flags));
    const ff = p.feature_flags ?? {};
    setEditAddons({
      verified:            Boolean(ff.addon_verified_included  ?? ff.directory_addon_verified_included),
      sponsored:           Boolean(ff.addon_sponsored_included ?? ff.directory_addon_sponsored_included),
      concierge_available: Boolean(ff.addon_concierge_available),
      concierge_included:  Boolean(ff.addon_concierge_included),
    });
    const unit = (p.trial_period_unit as TrialUnit) || 'none';
    setEditMeta({
      name: p.name,
      slug: p.slug,
      description: p.description || '',
      sort_order: p.sort_order,
      price_monthly_cents: p.price_monthly_cents != null ? (p.price_monthly_cents / 100).toFixed(2) : '',
      fortis_merchant_id: p.fortis_merchant_id?.trim() || '',
      is_default: p.is_default,
      is_public: p.is_public !== false, // default true if column absent
      is_legacy: Boolean(p.is_legacy),
      highlight_label: p.highlight_label?.trim() ?? '',
      hide_header: Boolean(p.hide_header),
      trial_period_value: typeof p.trial_period_value === 'number' && p.trial_period_value > 0
        ? String(p.trial_period_value)
        : '0',
      trial_period_unit: unit,
    });
  }

  function setNavGroup(group: DirectoryNavGroup, value: boolean) {
    setEditNav((prev) => {
      const next = { ...prev };
      for (const e of DIRECTORY_NAV_REGISTRY) {
        if (e.group === group) next[e.id] = value;
      }
      return next;
    });
  }

  async function saveEdit() {
    if (!editingId) return;
    const { nav_permissions } = buildPlanNavPayloadFromEditor(editNav);
    const res = await fetch(`/api/admin/directory-plans/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editMeta.name.trim(),
        slug: editMeta.slug.trim().toLowerCase(),
        description: editMeta.description.trim() || null,
        sort_order: editMeta.sort_order,
        is_default: editMeta.is_default,
        is_public: editMeta.is_public,
        is_legacy: editMeta.is_legacy,
        hide_header: editMeta.hide_header,
        highlight_label: editMeta.highlight_label.trim() || null,
        price_monthly_cents: editMeta.price_monthly_cents
          ? Math.round(parseFloat(editMeta.price_monthly_cents) * 100)
          : null,
        fortis_merchant_id: editMeta.fortis_merchant_id.trim() || null,
        nav_permissions,
        feature_flags: {
          addon_verified_included:  editAddons.verified,
          addon_sponsored_included: editAddons.sponsored,
          addon_concierge_available: editAddons.concierge_available,
          addon_concierge_included:  editAddons.concierge_included,
        },
        trial_period_value: editMeta.trial_period_unit === 'none' || editMeta.trial_period_unit === 'forever'
          ? 0
          : Math.max(0, parseInt(editMeta.trial_period_value, 10) || 0),
        trial_period_unit: editMeta.trial_period_unit,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string; trialSkipped?: boolean };
    if (!res.ok) {
      alert(j.error || 'Save failed');
      return;
    }
    if (j.trialSkipped) setTrialMigrationMissing(true);
    setEditingId(null);
    await load();
  }

  async function deletePlan(id: string) {
    if (!confirm('Delete this plan? Venues using it will have directory_plan_id set to NULL.')) return;
    const res = await fetch(`/api/admin/directory-plans/${id}`, { method: 'DELETE' });
    if (!res.ok) alert('Delete failed');
    await load();
  }

  async function toggleVisibility(p: PlanRow) {
    setTogglingVisibility(p.id);
    try {
      const res = await fetch(`/api/admin/directory-plans/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: !p.is_public }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Could not update visibility');
        return;
      }
      await load();
    } finally {
      setTogglingVisibility(null);
    }
  }

  async function duplicatePlan(p: PlanRow) {
    setDuplicating(p.id);
    try {
      const baseName = `${p.name} (copy)`;
      const baseSlug = `${p.slug}-copy`;
      const { nav_permissions, feature_flags } = buildPlanNavPayloadFromEditor(
        mergeNavPermissionsForEditor(p.nav_permissions, p.feature_flags)
      );
      const res = await fetch('/api/admin/directory-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: baseName,
          slug: baseSlug,
          description: p.description,
          sort_order: p.sort_order + 1,
          is_default: false,
          price_monthly_cents: p.price_monthly_cents,
          fortis_merchant_id: p.fortis_merchant_id?.trim() || null,
          nav_permissions,
          feature_flags,
          trial_period_value: typeof p.trial_period_value === 'number' ? p.trial_period_value : 0,
          trial_period_unit: (p.trial_period_unit as TrialUnit) || 'none',
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Duplicate failed');
        return;
      }
      await load();
    } finally {
      setDuplicating(null);
    }
  }

  async function saveAddonPrices() {
    setAddonPriceSaving(true);
    setAddonPriceMsg('');
    try {
      const body = {
        verified_cents:  Math.round(parseFloat(addonPriceInputs.verified  || '0') * 100),
        sponsored_cents: Math.round(parseFloat(addonPriceInputs.sponsored || '0') * 100),
        concierge_cents: Math.round(parseFloat(addonPriceInputs.concierge || '0') * 100),
      };
      if (Object.values(body).some((v) => isNaN(v) || v < 0)) {
        setAddonPriceMsg('All prices must be valid positive numbers.');
        return;
      }
      const res = await fetch('/api/admin/addon-prices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; prices?: typeof addonPrices; error?: string };
      if (!res.ok) { setAddonPriceMsg(data.error || 'Save failed'); return; }
      if (data.prices) setAddonPrices(data.prices);
      setAddonPriceMsg('Prices saved — new signups and plan changes will use these amounts.');
    } catch {
      setAddonPriceMsg('Network error, please try again.');
    } finally {
      setAddonPriceSaving(false);
    }
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
          Pick each dashboard menu, submenu, and page per plan (main nav, Venue listing, Payments, Marketing, Settings).
          Plans with empty <code className="text-xs bg-gray-100 px-1 rounded">nav_permissions</code> still fall back to
          legacy feature flags until you save from this UI. Venues with no plan keep full access. Optional Fortis merchant
          id per plan overrides <code className="text-xs bg-gray-100 px-1 rounded">STORYPAY_PLATFORM_FORTIS_MERCHANT_ID</code>.
        </p>
        {!platformFortisMerchantIdConfigured ? (
          <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 max-w-3xl">
            Set <code className="text-xs">STORYPAY_PLATFORM_FORTIS_MERCHANT_ID</code> in production env so new charges use
            your StoryVenue merchant unless a plan specifies its own id.
          </p>
        ) : null}

        {/* ── Addon Pricing ── */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 max-w-2xl">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-gray-900">Add-on pricing</span>
            <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Global</span>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Changes take effect immediately for all new checkouts and plan changes.
            Existing subscribers keep their current billed amount until they upgrade, downgrade, or resubscribe.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(
              [
                { key: 'verified',  label: 'Verified Listing',  field: 'verified'  },
                { key: 'sponsored', label: 'Sponsored Listing', field: 'sponsored' },
                { key: 'concierge', label: 'Venue Concierge',   field: 'concierge' },
              ] as { key: string; label: string; field: 'verified' | 'sponsored' | 'concierge' }[]
            ).map(({ label, field }) => (
              <div key={field}>
                <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
                <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 overflow-hidden focus-within:ring-1 focus-within:ring-gray-400">
                  <span className="pl-3 pr-1 text-sm text-gray-500 select-none">$</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={addonPriceInputs[field]}
                    onChange={(e) =>
                      setAddonPriceInputs((s) => ({ ...s, [field]: e.target.value }))
                    }
                    className="flex-1 bg-transparent py-2 pr-3 text-sm text-gray-900 focus:outline-none"
                    placeholder="0"
                  />
                  <span className="pr-3 text-xs text-gray-400 select-none">/mo</span>
                </div>
                <p className="mt-1 text-[10px] text-gray-400">
                  Currently saved: ${(addonPrices[`${field}_cents` as keyof typeof addonPrices] / 100).toFixed(2)}/mo
                </p>
              </div>
            ))}
          </div>
          {addonPriceMsg && (
            <p className={`mt-3 text-xs rounded px-2 py-1 ${addonPriceMsg.includes('saved') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {addonPriceMsg}
            </p>
          )}
          <button
            type="button"
            disabled={addonPriceSaving}
            onClick={() => void saveAddonPrices()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: BRAND }}
          >
            {addonPriceSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Save addon prices
          </button>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {trialMigrationMissing && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 max-w-3xl">
            <strong>Trial periods need a one-time database migration.</strong> The{' '}
            <code className="text-xs bg-amber-100 px-1 rounded">trial_period_value</code> and{' '}
            <code className="text-xs bg-amber-100 px-1 rounded">trial_period_unit</code> columns
            don&apos;t exist yet — trial settings are being silently ignored on save.
            <br />
            <span className="mt-1 block text-xs">
              Run the SQL below in the Supabase SQL Editor, then reload this page and re-save your plans.
            </span>
            <pre className="mt-2 rounded bg-amber-100 p-2 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap">{`-- Migration 092: addon flags
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_addon_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS directory_addon_sponsored BOOLEAN NOT NULL DEFAULT FALSE;

-- Migration 093: trial periods
ALTER TABLE public.directory_plans
  ADD COLUMN IF NOT EXISTS trial_period_value INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trial_period_unit  TEXT    NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'directory_plans_trial_period_unit_check'
  ) THEN
    ALTER TABLE public.directory_plans
      ADD CONSTRAINT directory_plans_trial_period_unit_check
      CHECK (trial_period_unit IN ('none','days','weeks','months','years','forever'));
  END IF;
END $$;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS directory_trial_started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS directory_trial_ends_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS directory_trial_is_forever BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS directory_trial_plan_id    UUID NULL,
  ADD COLUMN IF NOT EXISTS directory_trial_consumed   BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'venues_directory_trial_plan_id_fkey'
  ) THEN
    ALTER TABLE public.venues
      ADD CONSTRAINT venues_directory_trial_plan_id_fkey
      FOREIGN KEY (directory_trial_plan_id) REFERENCES public.directory_plans(id)
      ON DELETE SET NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';`}</pre>
          </div>
        )}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 hidden">
        <h3 className="font-semibold text-gray-900 mb-3">Legacy feature catalog</h3>
        <p className="text-xs text-gray-500 mb-3 max-w-3xl">
          Optional registry keys for older tooling. Live gating uses <span className="font-mono">nav_permissions</span> when
          you save a plan from the editor below.
        </p>
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

      <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setNewPlanOpen(o => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-white">
              <Plus size={14} />
            </span>
            <span className="font-semibold text-gray-900">New plan</span>
          </div>
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${newPlanOpen ? 'rotate-180' : ''}`} />
        </button>
        {newPlanOpen && (
          <div className="px-6 pb-6 border-t border-gray-100">
            <p className="text-xs text-gray-500 mt-4 mb-3">
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
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Fortis merchant id (optional override)
                </label>
                <input
                  value={planForm.fortis_merchant_id}
                  onChange={(e) => setPlanForm({ ...planForm, fortis_merchant_id: e.target.value })}
                  placeholder="Leave blank for env default"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
                />
              </div>

              {/* Trial period — only applies to NEW signups when changed. */}
              <div className="md:col-span-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <label className="block text-xs font-semibold text-gray-700 mb-2">Free trial</label>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-0.5">Length</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      disabled={planForm.trial_period_unit === 'none' || planForm.trial_period_unit === 'forever'}
                      value={planForm.trial_period_value}
                      onChange={(e) => setPlanForm({ ...planForm, trial_period_value: e.target.value })}
                      className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-gray-500 uppercase mb-0.5">Unit</label>
                    <select
                      value={planForm.trial_period_unit}
                      onChange={(e) => setPlanForm({ ...planForm, trial_period_unit: e.target.value as TrialUnit })}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white"
                    >
                      {TRIAL_UNIT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  {trialDescription(planForm.trial_period_unit, parseInt(planForm.trial_period_value, 10))}
                  {' · '}
                  Changes only affect future signups. Existing trials keep their original duration.
                </p>
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
          </div>
        )}
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
                    <label className="text-xs text-gray-600 flex items-center gap-1">
                      Fortis{' '}
                      <input
                        value={editMeta.fortis_merchant_id}
                        onChange={(e) => setEditMeta({ ...editMeta, fortis_merchant_id: e.target.value })}
                        placeholder="env default"
                        className="w-44 rounded border border-gray-200 px-1 py-0.5 font-mono text-[10px]"
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
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer rounded-lg border border-gray-200 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={editMeta.is_public}
                        onChange={(e) => setEditMeta({ ...editMeta, is_public: e.target.checked })}
                      />
                      <Eye size={12} className="text-gray-500" />
                      <span>Public (visible on plan picker &amp; upgrade modals)</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer rounded-lg border border-amber-200 bg-amber-50 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={editMeta.is_legacy}
                        onChange={(e) => setEditMeta({ ...editMeta, is_legacy: e.target.checked })}
                      />
                      <Lock size={12} className="text-amber-600" />
                      <span className="text-amber-800">Legacy plan — all add-ons included, billing managed directly, no subscription required</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer rounded-lg border border-teal-200 bg-teal-50 px-2 py-1">
                      <input
                        type="checkbox"
                        checked={editMeta.hide_header}
                        onChange={(e) => setEditMeta({ ...editMeta, hide_header: e.target.checked })}
                      />
                      <EyeOff size={12} className="text-teal-600" />
                      <span className="text-teal-800">Landing page mode — hide header on plan picker so this plan displays as a standalone landing page</span>
                    </label>
                  </div>
                  {/* Highlight badge */}
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Star size={13} className="text-indigo-500 shrink-0" />
                      <span className="text-xs font-semibold text-indigo-900">Highlight badge label</span>
                    </div>
                    <input
                      type="text"
                      maxLength={40}
                      value={editMeta.highlight_label ?? ''}
                      onChange={(e) => setEditMeta({ ...editMeta, highlight_label: e.target.value })}
                      placeholder="Leave blank to hide — e.g. Recommended, Most Popular, Best Value"
                      className="w-full rounded border border-indigo-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                    />
                    <p className="mt-1.5 text-[10px] text-indigo-700">
                      Shown as a pill above the plan card on public plan pickers and billing pages. Leave blank to hide it entirely.
                    </p>
                  </div>
                  {/* Trial period editor — applies to NEW signups only */}
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <label className="block text-xs font-semibold text-gray-700 mb-2">Free trial</label>
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 uppercase mb-0.5">Length</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          disabled={editMeta.trial_period_unit === 'none' || editMeta.trial_period_unit === 'forever'}
                          value={editMeta.trial_period_value}
                          onChange={(e) => setEditMeta({ ...editMeta, trial_period_value: e.target.value })}
                          className="w-20 rounded border border-gray-200 px-2 py-1 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 uppercase mb-0.5">Unit</label>
                        <select
                          value={editMeta.trial_period_unit}
                          onChange={(e) => setEditMeta({ ...editMeta, trial_period_unit: e.target.value as TrialUnit })}
                          className="rounded border border-gray-200 px-2 py-1 text-sm bg-white"
                        >
                          {TRIAL_UNIT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">
                      {trialDescription(editMeta.trial_period_unit, parseInt(editMeta.trial_period_value, 10))}
                      {' · '}
                      Affects new signups only. Existing trials keep their original duration.
                    </p>
                  </div>

                  {/* Included add-ons — when checked, the corresponding paid
                      add-on is automatically applied to every venue on this
                      plan and cannot be toggled at checkout. */}
                  <div className="border border-gray-100 rounded-xl p-3">
                    <div className="mb-2">
                      <span className="text-xs font-semibold text-gray-800">Included add-ons</span>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Auto-include these paid add-ons in this plan. Venues on this plan won&apos;t be charged
                        the add-on fee and can&apos;t deselect them at checkout.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <label className="flex items-start gap-2 text-xs text-gray-700 rounded-lg border border-gray-100 bg-gray-50 p-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-300"
                          checked={editAddons.verified}
                          onChange={(ev) => setEditAddons((s) => ({ ...s, verified: ev.target.checked }))}
                        />
                        <span>
                          <span className="font-medium text-gray-900">Verified Listing</span>
                          <span className="block text-[11px] text-gray-500">
                            Blue verified badge ($19/mo add-on)
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-xs text-gray-700 rounded-lg border border-gray-100 bg-gray-50 p-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-300"
                          checked={editAddons.sponsored}
                          onChange={(ev) => setEditAddons((s) => ({ ...s, sponsored: ev.target.checked }))}
                        />
                        <span>
                          <span className="font-medium text-gray-900">Sponsored Listing</span>
                          <span className="block text-[11px] text-gray-500">
                            Featured top placement ($99/mo add-on)
                          </span>
                        </span>
                      </label>
                    </div>
                    {/* Venue Concierge — two flags: available (can purchase) + included (bundled free) */}
                    <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50 p-3 space-y-2">
                      <p className="text-xs font-semibold text-violet-900">Venue Concierge ($499/mo add-on)</p>
                      <p className="text-[11px] text-violet-700 leading-snug">
                        Personal + AI forever-follow-up concierge for leads. Control which plans can purchase or have it bundled.
                      </p>
                      <label className="flex items-start gap-2 text-xs text-gray-700 rounded-lg border border-violet-100 bg-white p-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-300"
                          checked={editAddons.concierge_available}
                          onChange={(ev) => setEditAddons((s) => ({ ...s, concierge_available: ev.target.checked }))}
                        />
                        <span>
                          <span className="font-medium text-gray-900">Available on this plan</span>
                          <span className="block text-[11px] text-gray-500">
                            When checked, venues on this plan can purchase Venue Concierge as an add-on.
                            Uncheck to hide it entirely from lower-tier plans.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-xs text-gray-700 rounded-lg border border-violet-100 bg-white p-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-300"
                          checked={editAddons.concierge_included}
                          onChange={(ev) => setEditAddons((s) => ({ ...s, concierge_included: ev.target.checked }))}
                        />
                        <span>
                          <span className="font-medium text-gray-900">Included in plan (bundled free)</span>
                          <span className="block text-[11px] text-gray-500">
                            Auto-applies concierge at no extra charge. Use for ultimate-tier plans where it&apos;s part of the package.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="border border-gray-100 rounded-xl p-3 space-y-4 max-h-[min(70vh,520px)] overflow-y-auto">
                    <p className="text-xs text-gray-500">
                      Toggle any screen; submenu sections only appear in the venue sidebar if at least one child is
                      allowed.
                    </p>
                    {NAV_GROUP_ORDER.map((group) => (
                      <div key={group}>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-gray-800">
                            {DIRECTORY_NAV_GROUP_LABELS[group]}
                          </span>
                          <button
                            type="button"
                            className="text-[10px] font-medium text-gray-500 hover:text-gray-800"
                            onClick={() => setNavGroup(group, true)}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            className="text-[10px] font-medium text-gray-500 hover:text-gray-800"
                            onClick={() => setNavGroup(group, false)}
                          >
                            None
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pl-1">
                          {DIRECTORY_NAV_REGISTRY.filter((e) => e.group === group).map((e) => (
                            <label key={e.id} className="flex items-start gap-2 text-xs text-gray-700">
                              <input
                                type="checkbox"
                                className="mt-0.5 rounded border-gray-300"
                                checked={editNav[e.id] === true}
                                onChange={(ev) =>
                                  setEditNav({ ...editNav, [e.id]: ev.target.checked })
                                }
                              />
                              <span>{e.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900">{p.name}</p>
                      {p.highlight_label && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          <Star size={9} /> {p.highlight_label}
                        </span>
                      )}
                      {p.is_public === false && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          <EyeOff size={9} /> Hidden
                        </span>
                      )}
                      {p.is_legacy && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                          <Lock size={9} /> Legacy
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-mono text-gray-400">{p.slug}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Fortis:{' '}
                      {p.fortis_merchant_id?.trim()
                        ? <span className="font-mono text-gray-700">{p.fortis_merchant_id.trim()}</span>
                        : <span className="text-gray-400">env default</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {p.is_default ? (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          Default
                        </span>
                      ) : null}
                      {p.trial_period_unit && p.trial_period_unit !== 'none' ? (
                        <span className="text-[10px] font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
                          {p.trial_period_unit === 'forever'
                            ? 'Free forever'
                            : `${p.trial_period_value || 0}-${(p.trial_period_unit as string).replace(/s$/, '')} trial`}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleVisibility(p)}
                      disabled={togglingVisibility === p.id}
                      className={`p-2 rounded-lg border border-gray-200 disabled:opacity-40 transition-colors ${
                        p.is_public === false
                          ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                      title={p.is_public === false ? 'Make public (show on plan picker)' : 'Hide from public plan picker'}
                      aria-label={p.is_public === false ? 'Make public' : 'Hide plan'}
                    >
                      {togglingVisibility === p.id
                        ? <Loader2 size={16} className="animate-spin" />
                        : p.is_public === false ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
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
                      onClick={() => void duplicatePlan(p)}
                      disabled={duplicating === p.id}
                      className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40"
                      aria-label="Duplicate plan"
                      title="Duplicate plan"
                    >
                      {duplicating === p.id ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
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
