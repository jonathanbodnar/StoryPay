'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  Search,
  Eye,
  Copy,
} from 'lucide-react';
import { DIRECTORY_BADGE_STATUSES, directoryBadgeLabel } from '@/lib/directory-badges';

const BRAND = '#1b1b1b';

export type AdminVenueRow = Record<string, unknown> & {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  slug?: string | null;
  ghl_location_id: string | null;
  onboarding_status: string;
  setup_completed: boolean;
  created_at: string;
  login_url: string | null;
  directory_plan_id?: string | null;
  directory_verified_status?: string | null;
  directory_sponsored_status?: string | null;
  directory_plans?: { id: string; name: string; slug: string } | null;
};

type PlanOpt = { id: string; name: string; slug: string };

export function VenueManagementPortal({
  venues,
  venuesLoading,
  onRefresh,
}: {
  venues: AdminVenueRow[];
  venuesLoading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterVerified, setFilterVerified] = useState<string>('any');
  const [filterSponsored, setFilterSponsored] = useState<string>('any');
  const [filterPlan, setFilterPlan] = useState<string>('any');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [serverError, setServerError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    firstName: '',
    lastName: '',
    phone: '',
    ghlLocationId: '',
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [copiedGhl, setCopiedGhl] = useState(false);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await fetch('/api/admin/directory-plans');
      if (res.ok) {
        const d = (await res.json()) as { plans?: PlanOpt[] };
        setPlans(d.plans || []);
      }
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setServerError('');
    try {
      const res = await fetch('/api/admin/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setFormData({ name: '', email: '', firstName: '', lastName: '', phone: '', ghlLocationId: '' });
        setShowCreateForm(false);
        await onRefresh();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setServerError(d.error || 'Create failed');
      }
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Request failed');
    }
    setCreating(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return venues.filter((v) => {
      if (q) {
        const blob = [v.name, v.email, v.phone, v.slug, v.ghl_location_id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!blob.includes(q)) return false;
      }
      if (filterVerified !== 'any') {
        const vs = (v.directory_verified_status as string) || 'none';
        if (vs !== filterVerified) return false;
      }
      if (filterSponsored !== 'any') {
        const ss = (v.directory_sponsored_status as string) || 'none';
        if (ss !== filterSponsored) return false;
      }
      if (filterPlan !== 'any') {
        const pid = v.directory_plan_id || '';
        if (filterPlan === 'none' && pid) return false;
        if (filterPlan !== 'none' && pid !== filterPlan) return false;
      }
      return true;
    });
  }, [venues, search, filterVerified, filterSponsored, filterPlan]);

  async function patchVenue(
    venueId: string,
    body: Record<string, unknown>,
  ) {
    const key = JSON.stringify({ venueId, ...body });
    setSavingKey(key);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Save failed');
        return;
      }
      await onRefresh();
    } finally {
      setSavingKey(null);
    }
  }

  async function viewAsVenue(venueId: string) {
    const res = await fetch('/api/admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      alert(j.error || 'Could not start preview');
      return;
    }
    window.location.href = '/dashboard';
  }

  function planLabel(v: AdminVenueRow) {
    const p = v.directory_plans;
    if (p && typeof p === 'object' && 'name' in p) return String((p as PlanOpt).name);
    return v.directory_plan_id ? '—' : 'Full (no plan)';
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl text-gray-900">Venue management</h2>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          All registered venues: search, assign directory plans, approve verified / sponsored badges, copy magic login
          links, or open their dashboard as they see it (exit from the amber bar).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setShowCreateForm((s) => !s)}
          className="text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors hover:opacity-90"
          style={{ backgroundColor: BRAND }}
        >
          {showCreateForm ? 'Cancel' : '+ Create venue'}
        </button>
        <button
          type="button"
          onClick={() => {
            const url =
              (venues[0]?.login_url as string | null)?.split('/login/')[0] ||
              (typeof window !== 'undefined' ? window.location.origin : '');
            void navigator.clipboard.writeText(`${url}/login/ghl`);
            setCopiedGhl(true);
            setTimeout(() => setCopiedGhl(false), 2000);
          }}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          {copiedGhl ? 'Copied GHL login URL' : 'Copy universal GHL login URL'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-heading text-lg text-gray-900 mb-4">New venue</h3>
          {serverError && (
            <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{serverError}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Business name *</label>
              <input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name *</label>
              <input
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name *</label>
              <input
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">GHL location ID</label>
              <input
                value={formData.ghlLocationId}
                onChange={(e) => setFormData({ ...formData, ghlLocationId: e.target.value })}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={creating}
              className="text-white font-medium px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {creating ? 'Creating…' : 'Create venue'}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Venue name, email, phone, slug, GHL ID…"
                className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Verified</label>
            <select
              value={filterVerified}
              onChange={(e) => setFilterVerified(e.target.value)}
              className="w-full lg:w-40 rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="any">Any</option>
              {DIRECTORY_BADGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {directoryBadgeLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Sponsored</label>
            <select
              value={filterSponsored}
              onChange={(e) => setFilterSponsored(e.target.value)}
              className="w-full lg:w-40 rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="any">Any</option>
              {DIRECTORY_BADGE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {directoryBadgeLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Plan</label>
            <select
              value={filterPlan}
              onChange={(e) => setFilterPlan(e.target.value)}
              className="w-full lg:w-44 rounded-xl border border-gray-200 px-3 py-2 text-sm"
              disabled={plansLoading}
            >
              <option value="any">Any</option>
              <option value="none">No plan (full legacy)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Showing {filtered.length} of {venues.length} venues
        </p>
      </div>

      <div className="sm:hidden space-y-3">
        {venuesLoading ? (
          <div className="text-center py-8 text-gray-400">
            <Loader2 size={20} className="animate-spin inline" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">No venues match</p>
        ) : (
          filtered.map((venue) => (
            <VenueMobileCard
              key={venue.id}
              venue={venue}
              plans={plans}
              planLabelText={planLabel(venue)}
              savingKey={savingKey}
              copiedId={copiedId}
              onPatch={patchVenue}
              onCopyLogin={(url, id) => {
                void navigator.clipboard.writeText(url);
                setCopiedId(id);
                setTimeout(() => setCopiedId(null), 2000);
              }}
              onViewAs={() => void viewAsVenue(venue.id)}
            />
          ))
        )}
      </div>

      <div className="hidden sm:block rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">Venue</th>
                <th className="px-3 py-3">Contact</th>
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3">Verified</th>
                <th className="px-3 py-3">Sponsored</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {venuesLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400 text-sm">
                    No venues match
                  </td>
                </tr>
              ) : (
                filtered.map((venue) => {
                  const vs = (venue.directory_verified_status as string) || 'none';
                  const ss = (venue.directory_sponsored_status as string) || 'none';
                  const busy = savingKey !== null;
                  return (
                    <tr key={venue.id} className="hover:bg-gray-50/80">
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-gray-900">{venue.name}</div>
                        {venue.slug ? (
                          <div className="text-[11px] text-gray-400 font-mono">{venue.slug}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-gray-600">
                        <div>{venue.email || '—'}</div>
                        {venue.phone ? <div className="text-gray-500">{venue.phone}</div> : null}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <select
                          value={venue.directory_plan_id || ''}
                          disabled={busy}
                          onChange={(e) => {
                            const v = e.target.value;
                            void patchVenue(venue.id, {
                              directory_plan_id: v === '' ? null : v,
                            });
                          }}
                          className="w-full min-w-[140px] max-w-[200px] rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                        >
                          <option value="">Full (no plan)</option>
                          {plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <select
                          value={vs}
                          disabled={busy}
                          onChange={(e) =>
                            void patchVenue(venue.id, { directory_verified_status: e.target.value })
                          }
                          className="w-full min-w-[120px] max-w-[190px] rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                        >
                          {DIRECTORY_BADGE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {directoryBadgeLabel(s)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <select
                          value={ss}
                          disabled={busy}
                          onChange={(e) =>
                            void patchVenue(venue.id, { directory_sponsored_status: e.target.value })
                          }
                          className="w-full min-w-[120px] max-w-[190px] rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                        >
                          {DIRECTORY_BADGE_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {directoryBadgeLabel(s)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-col gap-1.5">
                          <button
                            type="button"
                            disabled={!venue.login_url}
                            onClick={() => {
                              if (!venue.login_url) return;
                              void navigator.clipboard.writeText(venue.login_url);
                              setCopiedId(venue.id);
                              setTimeout(() => setCopiedId(null), 2000);
                            }}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium hover:bg-gray-50 disabled:opacity-40"
                          >
                            <Copy size={12} />
                            {copiedId === venue.id ? 'Copied' : 'Copy login'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void viewAsVenue(venue.id)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-pink-200 bg-pink-50 px-2 py-1 text-[11px] font-semibold text-pink-900 hover:bg-pink-100"
                          >
                            <Eye size={12} /> View as venue
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function VenueMobileCard({
  venue,
  plans,
  planLabelText,
  savingKey,
  copiedId,
  onPatch,
  onCopyLogin,
  onViewAs,
}: {
  venue: AdminVenueRow;
  plans: PlanOpt[];
  planLabelText: string;
  savingKey: string | null;
  copiedId: string | null;
  onPatch: (id: string, b: Record<string, unknown>) => void;
  onCopyLogin: (url: string, id: string) => void;
  onViewAs: () => void;
}) {
  const vs = (venue.directory_verified_status as string) || 'none';
  const ss = (venue.directory_sponsored_status as string) || 'none';
  const busy = savingKey !== null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <div className="font-semibold text-gray-900">{venue.name}</div>
      <div className="text-xs text-gray-600">{venue.email}</div>
      {venue.phone ? <div className="text-xs text-gray-500">{venue.phone}</div> : null}
      <div className="text-[11px] text-gray-400">Plan: {planLabelText}</div>
      <select
        value={venue.directory_plan_id || ''}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          onPatch(venue.id, { directory_plan_id: v === '' ? null : v });
        }}
        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
      >
        <option value="">Full (no plan)</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="text-[10px] font-semibold text-gray-400">Verified</span>
          <select
            value={vs}
            disabled={busy}
            onChange={(e) => onPatch(venue.id, { directory_verified_status: e.target.value })}
            className="w-full mt-0.5 rounded-lg border border-gray-200 px-2 py-1 text-xs"
          >
            {DIRECTORY_BADGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {directoryBadgeLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-gray-400">Sponsored</span>
          <select
            value={ss}
            disabled={busy}
            onChange={(e) => onPatch(venue.id, { directory_sponsored_status: e.target.value })}
            className="w-full mt-0.5 rounded-lg border border-gray-200 px-2 py-1 text-xs"
          >
            {DIRECTORY_BADGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {directoryBadgeLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={!venue.login_url}
          onClick={() => venue.login_url && onCopyLogin(venue.login_url, venue.id)}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-medium disabled:opacity-40"
        >
          <Copy size={12} /> {copiedId === venue.id ? 'Copied' : 'Login link'}
        </button>
        <button
          type="button"
          onClick={onViewAs}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-pink-200 bg-pink-50 py-2 text-xs font-semibold text-pink-900"
        >
          <Eye size={12} /> View as
        </button>
      </div>
    </div>
  );
}
