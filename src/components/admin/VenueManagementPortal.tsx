'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  Search,
  Eye,
  Copy,
  Trash2,
  AlertTriangle,
  KeyRound,
  EyeOff,
  X,
  CheckCircle2,
  CalendarClock,
  Send,
  Lock,
  CreditCard,
  Ban,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { DIRECTORY_BADGE_STATUSES, directoryBadgeLabel } from '@/lib/directory-badges';
import {
  getLunarPayAdminSummary,
  type LunarPayAdminSummary,
} from '@/lib/lunarpay-venue-admin';

const BRAND = '#1b1b1b';

export type AdminVenueRow = Record<string, unknown> & {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  slug?: string | null;
  ghl_location_id: string | null;
  onboarding_status: string;
  lunarpay_merchant_id?: number | string | null;
  setup_completed: boolean;
  created_at: string;
  login_url: string | null;
  directory_plan_id?: string | null;
  directory_verified_status?: string | null;
  directory_sponsored_status?: string | null;
  directory_subscription_status?: string | null;
  directory_trial_ends_at?: string | null;
  directory_plans?: { id: string; name: string; slug: string } | null;
  lunarpay_admin?: LunarPayAdminSummary;
  /** Protected demo venue — cannot be deleted by anyone. */
  is_demo?: boolean | null;
};

function lunarPaySummaryForRow(v: AdminVenueRow): LunarPayAdminSummary {
  const a = v.lunarpay_admin;
  if (a && typeof a === 'object' && 'payments_ready' in a) {
    return a;
  }
  return getLunarPayAdminSummary(v as Record<string, unknown>);
}

function LunarPayStatusCell({ venue, summary }: { venue: AdminVenueRow; summary: LunarPayAdminSummary }) {
  const badgeClass =
    summary.category === 'active_approved'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : summary.category === 'denied'
        ? 'border-red-200 bg-red-50 text-red-900'
        : summary.category === 'not_provisioned'
          ? 'border-gray-200 bg-gray-50 text-gray-700'
          : 'border-amber-200 bg-amber-50 text-amber-900';

  const mid = venue.lunarpay_merchant_id;

  return (
    <div className="space-y-1">
      <span
        className={`inline-flex max-w-[220px] rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-snug ${badgeClass}`}
      >
        {summary.label}
      </span>
      {mid != null && String(mid).length > 0 ? (
        <div className="text-[10px] font-mono text-gray-400">Merchant {String(mid)}</div>
      ) : null}
      {summary.payments_ready ? (
        <div className="text-[10px] text-emerald-700">Can process card payments</div>
      ) : summary.category === 'not_provisioned' ? (
        <div className="text-[10px] text-gray-500">No agency merchant on file</div>
      ) : (
        <div className="text-[10px] text-gray-500 capitalize">Status: {summary.onboarding_status}</div>
      )}
    </div>
  );
}

type PlanOpt = { id: string; name: string; slug: string; price_monthly_cents?: number | null };

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
  const [filterLunarPay, setFilterLunarPay] = useState<string>('any');

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
  // Legacy-migration friendly options
  const [createOpts, setCreateOpts] = useState({
    sendInvite:   true,
    skipLunarPay: false,
    isLegacy:     true,
  });
  const [createSuccess, setCreateSuccess] = useState<{
    venueId:     string;
    venueName:   string;
    venueEmail:  string | null;
    loginUrl:    string | null;
    inviteSent:  boolean;
    inviteError: string | null;
    lunarPayWarning: string | null;
  } | null>(null);
  const [copiedNewLink, setCopiedNewLink] = useState(false);
  const [postCreateInviting, setPostCreateInviting] = useState(false);
  const [postCreateInviteMsg, setPostCreateInviteMsg] = useState<string>('');

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [copiedGhl, setCopiedGhl] = useState(false);
  // Per-row send-invite state
  const [invitingId,    setInvitingId]   = useState<string | null>(null);
  const [inviteToastId, setInviteToastId] = useState<string | null>(null);
  const [inviteToastMsg, setInviteToastMsg] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<AdminVenueRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Set-password modal
  const [pwTarget, setPwTarget] = useState<AdminVenueRow | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);

  // Extend-trial modal
  const [trialTarget, setTrialTarget] = useState<AdminVenueRow | null>(null);
  const [trialDate, setTrialDate] = useState('');
  const [trialSaving, setTrialSaving] = useState(false);
  const [trialError, setTrialError] = useState('');
  const [trialSuccess, setTrialSuccess] = useState(false);

  // Billing-action modal
  const [billingTarget, setBillingTarget] = useState<AdminVenueRow | null>(null);
  const [billingLiveSub, setBillingLiveSub] = useState<Record<string, unknown> | null>(null);
  const [billingSubLoading, setBillingSubLoading] = useState(false);
  const [billingChargeId, setBillingChargeId] = useState('');
  const [billingRefundCents, setBillingRefundCents] = useState('');
  const [billingWorking, setBillingWorking] = useState(false);
  const [billingMsg, setBillingMsg] = useState<{ text: string; ok: boolean } | null>(null);

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
    setCreateSuccess(null);
    try {
      const res = await fetch('/api/admin/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, ...createOpts }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        venue?: { id?: string; name?: string; email?: string | null; login_url?: string | null };
        error?: string;
        inviteSent?: boolean;
        inviteError?: string | null;
        lunarPayWarning?: string | null;
      };
      if (res.ok) {
        setCreateSuccess({
          venueId:         d.venue?.id || '',
          venueName:       d.venue?.name || formData.name,
          venueEmail:      d.venue?.email ?? formData.email,
          loginUrl:        d.venue?.login_url ?? null,
          inviteSent:      Boolean(d.inviteSent),
          inviteError:     d.inviteError ?? null,
          lunarPayWarning: d.lunarPayWarning ?? null,
        });
        setPostCreateInviteMsg('');
        setFormData({ name: '', email: '', firstName: '', lastName: '', phone: '', ghlLocationId: '' });
        await onRefresh();
      } else {
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
      const lp = lunarPaySummaryForRow(v);
      if (filterLunarPay === 'ready' && !lp.payments_ready) return false;
      if (filterLunarPay === 'not_ready' && lp.payments_ready) return false;
      if (filterLunarPay === 'denied' && lp.category !== 'denied') return false;
      if (filterLunarPay === 'not_provisioned' && lp.category !== 'not_provisioned') return false;
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
  }, [venues, search, filterVerified, filterSponsored, filterPlan, filterLunarPay]);

  const lunarPayCounts = useMemo(() => {
    let ready = 0;
    for (const v of venues) {
      if (lunarPaySummaryForRow(v).payments_ready) ready++;
    }
    return { ready, total: venues.length };
  }, [venues]);

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

  async function deleteVenue(venueId: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || 'Delete failed');
        return;
      }
      setDeleteTarget(null);
      setDeleteConfirmName('');
      await onRefresh();
    } finally {
      setDeleting(false);
    }
  }

  async function copyDirectoryBillingLink(venueId: string) {
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/directory-checkout`, { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) {
        alert(d.error || 'Could not create billing link');
        return;
      }
      if (d.url) {
        await navigator.clipboard.writeText(d.url);
        alert(
          'SaaS billing link copied. The venue should log in first, then open the link (or use Venue listing → Plan & billing).',
        );
      }
    } catch {
      alert('Request failed');
    }
  }

  async function extendTrial() {
    if (!trialTarget || !trialDate) return;
    setTrialSaving(true);
    setTrialError('');
    try {
      const res = await fetch(`/api/admin/venues/${trialTarget.id}/extend-trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trial_ends_at: trialDate }),
      });
      const d = (await res.json().catch(() => ({}))) as { trialEndsAt?: string; lpSynced?: boolean; error?: string };
      if (!res.ok) { setTrialError(d.error || 'Failed to extend trial'); return; }
      setTrialSuccess(true);
      await onRefresh();
    } catch {
      setTrialError('Network error');
    } finally {
      setTrialSaving(false);
    }
  }

  async function openBillingModal(venue: AdminVenueRow) {
    setBillingTarget(venue);
    setBillingLiveSub(null);
    setBillingChargeId('');
    setBillingRefundCents('');
    setBillingMsg(null);
    setBillingSubLoading(true);
    try {
      const res = await fetch(`/api/admin/venues/${venue.id}/billing-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fetch_subscription' }),
      });
      const d = (await res.json().catch(() => ({}))) as { subscription?: Record<string, unknown> | null; error?: string };
      if (res.ok) setBillingLiveSub(d.subscription ?? null);
      else setBillingMsg({ text: d.error ?? 'Could not fetch subscription', ok: false });
    } catch {
      setBillingMsg({ text: 'Network error', ok: false });
    } finally {
      setBillingSubLoading(false);
    }
  }

  async function billingCancelSub() {
    if (!billingTarget) return;
    if (!confirm(`Cancel the LunarPay subscription for "${billingTarget.name}"? This stops future charges immediately.`)) return;
    setBillingWorking(true);
    setBillingMsg(null);
    try {
      const res = await fetch(`/api/admin/venues/${billingTarget.id}/billing-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel_subscription' }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        setBillingMsg({ text: 'Subscription canceled successfully.', ok: true });
        setBillingLiveSub(null);
        await onRefresh();
      } else {
        setBillingMsg({ text: d.error ?? 'Cancel failed', ok: false });
      }
    } catch {
      setBillingMsg({ text: 'Network error', ok: false });
    } finally {
      setBillingWorking(false);
    }
  }

  async function billingRefund() {
    if (!billingTarget || !billingChargeId.trim()) return;
    setBillingWorking(true);
    setBillingMsg(null);
    const dollars = parseFloat(billingRefundCents);
    const cents = !isNaN(dollars) && dollars > 0 ? Math.round(dollars * 100) : undefined;
    try {
      const res = await fetch(`/api/admin/venues/${billingTarget.id}/billing-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refund_charge', charge_id: billingChargeId.trim(), amount_cents: cents }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && d.ok) {
        setBillingMsg({ text: `Refund issued${cents ? ` ($${(cents / 100).toFixed(2)})` : ' (full)'} for charge ${billingChargeId.trim()}.`, ok: true });
        setBillingChargeId('');
        setBillingRefundCents('');
      } else {
        setBillingMsg({ text: d.error ?? 'Refund failed', ok: false });
      }
    } catch {
      setBillingMsg({ text: 'Network error', ok: false });
    } finally {
      setBillingWorking(false);
    }
  }

  async function sendInviteFromSuccessPanel() {
    if (!createSuccess?.venueId) return;
    setPostCreateInviting(true);
    setPostCreateInviteMsg('');
    try {
      const res = await fetch(`/api/admin/venues/${createSuccess.venueId}/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLegacy: true }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean; sentTo?: string; loginUrl?: string; error?: string;
      };
      if (res.ok && d.ok) {
        setPostCreateInviteMsg(`Invite sent to ${d.sentTo}`);
        setCreateSuccess((prev) => prev ? {
          ...prev,
          inviteSent: true,
          inviteError: null,
          loginUrl: d.loginUrl ?? prev.loginUrl,
        } : prev);
        await onRefresh();
      } else {
        setPostCreateInviteMsg(d.error || 'Invite failed');
      }
    } catch (err) {
      setPostCreateInviteMsg(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPostCreateInviting(false);
    }
  }

  async function sendInviteToVenue(venueId: string) {
    setInvitingId(venueId);
    setInviteToastId(null);
    setInviteToastMsg('');
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLegacy: true }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        sentTo?: string;
        loginUrl?: string;
        error?: string;
      };
      if (res.ok && d.ok) {
        setInviteToastId(venueId);
        setInviteToastMsg(`Invite sent to ${d.sentTo}`);
        await onRefresh();
      } else {
        setInviteToastId(venueId);
        setInviteToastMsg(d.error || 'Invite failed');
      }
    } catch (err) {
      setInviteToastId(venueId);
      setInviteToastMsg(err instanceof Error ? err.message : 'Network error');
    } finally {
      setInvitingId(null);
      setTimeout(() => { setInviteToastId(null); setInviteToastMsg(''); }, 4000);
    }
  }

  async function viewAsVenue(venueId: string) {
    const res = await fetch('/api/admin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId, returnUrl: '/admin/venues' }),
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
    <>
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl text-gray-900">Venue management</h2>
        <p className="mt-1 text-sm text-gray-500 max-w-3xl">
          All registered venues: search, assign directory plans, approve verified / sponsored badges, copy magic login
          links, or open their dashboard as they see it (exit from the amber bar). LunarPay shows onboarding approval
          and whether the venue can run card payments (active merchant + API credentials).
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
          {copiedGhl ? 'Copied Legacy login URL' : 'Copy Legacy login URL'}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="e.g. (555) 123-4567"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Legacy sub-account ID</label>
              <input
                value={formData.ghlLocationId}
                onChange={(e) => setFormData({ ...formData, ghlLocationId: e.target.value })}
                placeholder="optional — paste their GHL/legacy location ID"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none"
              />
            </div>
            <p className="md:col-span-2 -mt-1 text-xs text-gray-500">
              These details become the venue&apos;s account-holder identity — every notification,
              automation email, and SMS will be sent to/from them, not us.
            </p>
          </div>

          {/* Legacy-migration / invite options */}
          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl bg-gray-50 border border-gray-200 p-4">
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={createOpts.sendInvite}
                onChange={(e) => setCreateOpts({ ...createOpts, sendInvite: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium block">Send invite email</span>
                <span className="text-xs text-gray-500">Magic-link login goes straight to the owner&apos;s inbox.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={createOpts.skipLunarPay}
                onChange={(e) => setCreateOpts({ ...createOpts, skipLunarPay: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium block">Skip LunarPay setup</span>
                <span className="text-xs text-gray-500">Use for legacy clients on a different processor — provision later.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={createOpts.isLegacy}
                onChange={(e) => setCreateOpts({ ...createOpts, isLegacy: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium block">Legacy migration</span>
                <span className="text-xs text-gray-500">Tweaks the welcome email wording for migrating clients.</span>
              </span>
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              {createOpts.sendInvite
                ? 'The owner will receive a unique magic-link login as soon as you submit.'
                : 'No invite email will be sent. The venue is created with a magic-link you can copy and send later.'}
            </p>
            <button
              type="submit"
              disabled={creating}
              className="text-white font-medium px-5 py-2 rounded-xl hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              style={{ backgroundColor: BRAND }}
            >
              {creating
                ? 'Creating…'
                : createOpts.sendInvite ? 'Create venue & invite' : 'Create venue (no invite yet)'}
            </button>
          </div>
        </form>
      )}

      {/* Success state — shows the magic login link + invite status */}
      {createSuccess && (() => {
        // Visual style: emerald when invite went out (or was deliberately
        // skipped without error), amber when something needs attention.
        const needsAttention = Boolean(createSuccess.inviteError);
        const skipped        = !createSuccess.inviteSent && !createSuccess.inviteError;
        const tone = needsAttention
          ? { border: 'border-amber-300', bg: 'bg-amber-50', text: 'text-amber-900', sub: 'text-amber-800', btnBorder: 'border-amber-300', btnHover: 'hover:bg-amber-100' }
          : skipped
            ? { border: 'border-blue-200',    bg: 'bg-blue-50',    text: 'text-blue-900',    sub: 'text-blue-800',    btnBorder: 'border-blue-300',    btnHover: 'hover:bg-blue-100' }
            : { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-900', sub: 'text-emerald-800', btnBorder: 'border-emerald-300', btnHover: 'hover:bg-emerald-100' };

        const headline = createSuccess.inviteSent
          ? `Subaccount created and invite sent — ${createSuccess.venueName}`
          : skipped
            ? `Subaccount created (invite not sent yet) — ${createSuccess.venueName}`
            : `Subaccount created — ${createSuccess.venueName}`;

        const subtitle = createSuccess.inviteSent
          ? `Invite email sent to ${createSuccess.venueEmail || 'the owner'} with a magic-link login.`
          : createSuccess.inviteError
            ? createSuccess.inviteError
            : 'The owner has NOT been emailed yet. Copy the magic-link below to share when you\u2019re ready, or click "Send invite now."';

        return (
        <div className={`rounded-xl border ${tone.border} ${tone.bg} p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className={`font-heading text-base ${tone.text} mb-1`}>{headline}</h3>
              <p className={`text-sm ${tone.sub}`}>{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => { setCreateSuccess(null); setPostCreateInviteMsg(''); }}
              className={`${tone.text} hover:opacity-80 text-xs font-medium`}
            >
              Dismiss
            </button>
          </div>

          {createSuccess.loginUrl && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <code className={`flex-1 block bg-white ${tone.border} border rounded-lg px-3 py-2 text-xs text-gray-800 break-all`}>
                {createSuccess.loginUrl}
              </code>
              <button
                type="button"
                onClick={() => {
                  if (!createSuccess.loginUrl) return;
                  void navigator.clipboard.writeText(createSuccess.loginUrl);
                  setCopiedNewLink(true);
                  setTimeout(() => setCopiedNewLink(false), 2000);
                }}
                className={`rounded-lg ${tone.btnBorder} bg-white px-3 py-2 text-xs font-medium ${tone.text} ${tone.btnHover} whitespace-nowrap border`}
              >
                {copiedNewLink ? 'Copied!' : 'Copy login link'}
              </button>
            </div>
          )}

          {/* Send invite later — only show when no invite was sent yet */}
          {!createSuccess.inviteSent && createSuccess.venueId && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <p className={`text-xs ${tone.sub} flex-1`}>
                Ready to invite them now? This rotates the magic-link and emails it to {createSuccess.venueEmail || 'the venue'}.
              </p>
              <button
                type="button"
                disabled={postCreateInviting || !createSuccess.venueEmail}
                onClick={() => void sendInviteFromSuccessPanel()}
                className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Send size={12} />
                {postCreateInviting ? 'Sending…' : 'Send invite now'}
              </button>
            </div>
          )}

          {postCreateInviteMsg && (
            <p className={`mt-2 text-xs ${tone.sub}`}>{postCreateInviteMsg}</p>
          )}

          {createSuccess.lunarPayWarning && (
            <p className="mt-3 text-xs rounded-lg bg-amber-100 border border-amber-200 text-amber-900 px-3 py-2">
              <strong>Heads up:</strong> {createSuccess.lunarPayWarning}
            </p>
          )}
        </div>
        );
      })()}

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Venue name, email, phone, slug, Legacy ID…"
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
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">LunarPay</label>
            <select
              value={filterLunarPay}
              onChange={(e) => setFilterLunarPay(e.target.value)}
              className="w-full lg:w-48 rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="any">Any</option>
              <option value="ready">Active &amp; approved (can charge)</option>
              <option value="not_ready">Not approved / not ready</option>
              <option value="denied">Denied</option>
              <option value="not_provisioned">No merchant</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Showing {filtered.length} of {venues.length} venues · LunarPay ready: {lunarPayCounts.ready} /{' '}
          {lunarPayCounts.total}
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
              lpSummary={lunarPaySummaryForRow(venue)}
              plans={plans}
              planLabelText={planLabel(venue)}
              savingKey={savingKey}
              copiedId={copiedId}
              invitingId={invitingId}
              inviteToastId={inviteToastId}
              inviteToastMsg={inviteToastMsg}
              onPatch={patchVenue}
              onCopyLogin={(url, id) => {
                void navigator.clipboard.writeText(url);
                setCopiedId(id);
                setTimeout(() => setCopiedId(null), 2000);
              }}
              onSendInvite={() => void sendInviteToVenue(venue.id)}
              onViewAs={() => void viewAsVenue(venue.id)}
              onCopyBillingLink={() => void copyDirectoryBillingLink(venue.id)}
              onDelete={venue.is_demo ? undefined : () => { setDeleteTarget(venue); setDeleteConfirmName(''); }}
              onExtendTrial={() => {
                const current = venue.directory_trial_ends_at as string | null | undefined;
                const def = current
                  ? new Date(current).toISOString().slice(0, 10)
                  : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                setTrialTarget(venue);
                setTrialDate(def);
                setTrialError('');
                setTrialSuccess(false);
              }}
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
                <th className="px-3 py-3">LunarPay</th>
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3">Verified</th>
                <th className="px-3 py-3">Sponsored</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {venuesLoading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400 text-sm">
                    No venues match
                  </td>
                </tr>
              ) : (
                filtered.map((venue) => {
                  const vs = (venue.directory_verified_status as string) || 'none';
                  const ss = (venue.directory_sponsored_status as string) || 'none';
                  const busy = savingKey !== null;
                  const lpSum = lunarPaySummaryForRow(venue);
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
                        <LunarPayStatusCell venue={venue} summary={lpSum} />
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
                        <div className="text-[10px] text-gray-500 mt-1">
                          SaaS: {(venue.directory_subscription_status as string) || '—'}
                        </div>
                        {(plans.find((p) => p.id === venue.directory_plan_id)?.price_monthly_cents ?? 0) > 0 ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void copyDirectoryBillingLink(venue.id)}
                            className="mt-1 text-[10px] font-medium text-amber-800 hover:underline"
                          >
                            Copy SaaS billing link
                          </button>
                        ) : null}
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
                            disabled={invitingId === venue.id || !venue.email}
                            onClick={() => void sendInviteToVenue(venue.id)}
                            title={venue.email ? `Send a fresh magic-link login to ${venue.email}` : 'No email on file'}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            <Send size={12} />
                            {invitingId === venue.id
                              ? 'Sending…'
                              : inviteToastId === venue.id
                                ? 'Sent ✓'
                                : 'Send invite'}
                          </button>
                          {inviteToastId === venue.id && inviteToastMsg && (
                            <p className="text-[10px] text-emerald-700 px-1">{inviteToastMsg}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => void viewAsVenue(venue.id)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-pink-200 bg-pink-50 px-2 py-1 text-[11px] font-semibold text-pink-900 hover:bg-pink-100"
                          >
                            <Eye size={12} /> View as venue
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPwTarget(venue); setPwValue(''); setPwConfirm(''); setPwError(''); setPwSuccess(false); setShowPw(false); }}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            <KeyRound size={12} /> Set password
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const current = venue.directory_trial_ends_at as string | null | undefined;
                              const def = current
                                ? new Date(current).toISOString().slice(0, 10)
                                : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
                              setTrialTarget(venue);
                              setTrialDate(def);
                              setTrialError('');
                              setTrialSuccess(false);
                            }}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100"
                          >
                            <CalendarClock size={12} /> Extend trial
                          </button>
                          {Boolean(venue.directory_plan_id || venue.directory_subscription_external_id) && (
                            <button
                              type="button"
                              onClick={() => void openBillingModal(venue)}
                              className="inline-flex items-center justify-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100"
                            >
                              <CreditCard size={12} /> Billing
                            </button>
                          )}
                          {!venue.is_demo && (
                            <button
                              type="button"
                              onClick={() => { setDeleteTarget(venue); setDeleteConfirmName(''); }}
                              className="inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          )}
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

    {/* Set password modal */}
    {pwTarget && (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" onClick={() => !pwSaving && setPwTarget(null)}>
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-gray-900">Set Venue Password</h3>
              <p className="text-xs text-gray-500 mt-0.5">{pwTarget.name} · {pwTarget.email}</p>
            </div>
            <button onClick={() => !pwSaving && setPwTarget(null)} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          {pwSuccess ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={36} className="text-green-500" />
              <p className="text-sm font-medium text-gray-800">Password updated successfully!</p>
              <p className="text-xs text-gray-500 text-center">The venue owner can now sign in with this new password.</p>
              <button onClick={() => setPwTarget(null)} className="mt-2 text-sm text-gray-600 hover:text-gray-900 underline">Close</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pwValue}
                    onChange={(e) => setPwValue(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-9 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirm password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>
              {pwError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{pwError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setPwTarget(null)} disabled={pwSaving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
                <button
                  disabled={pwSaving}
                  onClick={async () => {
                    setPwError('');
                    if (pwValue.length < 8) { setPwError('Password must be at least 8 characters.'); return; }
                    if (pwValue !== pwConfirm) { setPwError('Passwords do not match.'); return; }
                    setPwSaving(true);
                    try {
                      const res = await fetch(`/api/admin/venues/${pwTarget.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ password: pwValue }),
                      });
                      const d = await res.json().catch(() => ({}));
                      if (!res.ok) { setPwError((d as { error?: string }).error ?? 'Failed to update password.'); return; }
                      setPwSuccess(true);
                    } catch { setPwError('Network error.'); }
                    finally { setPwSaving(false); }
                  }}
                  className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-85 disabled:opacity-60 inline-flex items-center gap-1.5"
                  style={{ backgroundColor: BRAND }}
                >
                  {pwSaving && <Loader2 size={13} className="animate-spin" />}
                  Save password
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Extend-trial modal */}
    {trialTarget && (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" onClick={() => !trialSaving && setTrialTarget(null)}>
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><CalendarClock size={16} /> Extend Trial</h3>
              <p className="text-xs text-gray-500 mt-0.5">{trialTarget.name}</p>
            </div>
            <button onClick={() => !trialSaving && setTrialTarget(null)} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          {trialSuccess ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 size={36} className="text-green-500" />
              <p className="text-sm font-medium text-gray-800">Trial extended successfully!</p>
              <p className="text-xs text-gray-500 text-center">
                The venue&apos;s trial end date and LunarPay subscription have been updated.
              </p>
              <button onClick={() => setTrialTarget(null)} className="mt-2 text-sm text-gray-600 hover:text-gray-900 underline">Close</button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-600">
                Set a new trial end date. If the venue has an active trialing LunarPay subscription,
                it will be cancelled and recreated with <code className="bg-gray-100 rounded px-1">startOn</code> set
                to this date so they are not charged early.
              </p>
              {trialTarget.directory_trial_ends_at ? (
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  Current trial end: {new Date(trialTarget.directory_trial_ends_at as string).toLocaleDateString()}
                </p>
              ) : null}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New trial end date</label>
                <input
                  type="date"
                  value={trialDate}
                  min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
                  onChange={(e) => setTrialDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>
              {trialError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{trialError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setTrialTarget(null)} disabled={trialSaving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
                <button
                  disabled={trialSaving || !trialDate}
                  onClick={() => void extendTrial()}
                  className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-85 disabled:opacity-60 inline-flex items-center gap-1.5"
                  style={{ backgroundColor: BRAND }}
                >
                  {trialSaving && <Loader2 size={13} className="animate-spin" />}
                  <CalendarClock size={13} />
                  Extend trial
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Billing-action modal */}
    {billingTarget && (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4" onClick={() => !billingWorking && setBillingTarget(null)}>
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><CreditCard size={16} /> Subscription &amp; Billing</h3>
              <p className="text-xs text-gray-500 mt-0.5">{billingTarget.name}</p>
            </div>
            <button onClick={() => !billingWorking && setBillingTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>

          {/* Live subscription info */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Live subscription</span>
              <button
                type="button"
                disabled={billingSubLoading}
                onClick={() => void openBillingModal(billingTarget)}
                className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 disabled:opacity-40"
              >
                <RefreshCw size={11} className={billingSubLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
            {billingSubLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" /> Loading from LunarPay…</div>
            ) : billingLiveSub ? (
              <div className="space-y-1 text-xs font-mono text-gray-700">
                {(['id', 'status', 'amount', 'frequency', 'startOn', 'nextPaymentOn', 'nextPaymentDate', 'customerId'] as string[]).map((k) =>
                  billingLiveSub[k] != null ? (
                    <div key={k} className="flex gap-2">
                      <span className="text-gray-400 w-32 shrink-0">{k}</span>
                      <span className="text-gray-800 break-all">{String(billingLiveSub[k])}</span>
                    </div>
                  ) : null
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No active subscription found on LunarPay.</p>
            )}
            <div className="mt-2 text-[11px] text-gray-400">
              DB status: <strong>{String(billingTarget.directory_subscription_status || '—')}</strong>
              {billingTarget.directory_subscription_external_id
                ? <> · Sub ID: <span className="font-mono">{String(billingTarget.directory_subscription_external_id)}</span></>
                : null}
            </div>
          </div>

          {/* Cancel subscription */}
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 mb-4">
            <h4 className="text-xs font-semibold text-red-800 mb-1 flex items-center gap-1.5"><Ban size={13} /> Cancel subscription</h4>
            <p className="text-xs text-red-700 mb-3">
              Cancels on LunarPay immediately — no further charges. Updates the venue&apos;s status to &ldquo;canceled&rdquo; in the DB.
            </p>
            <button
              type="button"
              disabled={billingWorking || !billingTarget.directory_subscription_external_id}
              onClick={() => void billingCancelSub()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {billingWorking ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
              Cancel subscription
            </button>
          </div>

          {/* Refund charge */}
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 mb-4">
            <h4 className="text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1.5"><RotateCcw size={13} /> Refund a charge</h4>
            <p className="text-xs text-amber-700 mb-3">
              Enter the LunarPay charge ID. Leave amount blank for a full refund.
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={billingChargeId}
                onChange={(e) => setBillingChargeId(e.target.value)}
                placeholder="Charge ID (e.g. 1234)"
                className="flex-1 min-w-0 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:border-amber-400"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={billingRefundCents}
                onChange={(e) => setBillingRefundCents(e.target.value)}
                placeholder="Amount $ (blank = full)"
                className="w-36 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                disabled={billingWorking || !billingChargeId.trim()}
                onClick={() => void billingRefund()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {billingWorking ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                Refund
              </button>
            </div>
          </div>

          {/* Result message */}
          {billingMsg && (
            <div className={`rounded-lg px-3 py-2 text-xs font-medium ${billingMsg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {billingMsg.ok ? '✓ ' : '✗ '}{billingMsg.text}
            </div>
          )}
        </div>
      </div>
    )}

    {/* Delete confirmation modal */}
    {deleteTarget && (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle size={20} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Delete Venue</h3>
              <p className="text-xs text-gray-500">This cannot be undone</p>
            </div>
          </div>
          <p className="text-sm text-gray-700 mb-1">
            You are about to permanently delete <strong>{deleteTarget.name}</strong> and all of
            their data — contacts, conversations, leads, payments, and files.
          </p>
          <p className="text-sm text-gray-700 mb-4">
            Type <strong>{deleteTarget.name}</strong> to confirm:
          </p>
          <input
            type="text"
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={deleteTarget.name}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm mb-4 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setDeleteTarget(null); setDeleteConfirmName(''); }}
              disabled={deleting}
              className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteConfirmName !== deleteTarget.name || deleting}
              onClick={() => void deleteVenue(deleteTarget.id)}
              className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {deleting ? 'Deleting…' : 'Delete Venue'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function VenueMobileCard({
  venue,
  lpSummary,
  plans,
  planLabelText,
  savingKey,
  copiedId,
  invitingId,
  inviteToastId,
  inviteToastMsg,
  onPatch,
  onCopyLogin,
  onSendInvite,
  onViewAs,
  onCopyBillingLink,
  onDelete,
  onExtendTrial,
}: {
  venue: AdminVenueRow;
  lpSummary: LunarPayAdminSummary;
  plans: PlanOpt[];
  planLabelText: string;
  savingKey: string | null;
  copiedId: string | null;
  invitingId: string | null;
  inviteToastId: string | null;
  inviteToastMsg: string;
  onPatch: (id: string, b: Record<string, unknown>) => void;
  onCopyLogin: (url: string, id: string) => void;
  onSendInvite: () => void;
  onViewAs: () => void;
  onCopyBillingLink: () => void;
  onDelete?: () => void;
  onExtendTrial: () => void;
}) {
  const vs = (venue.directory_verified_status as string) || 'none';
  const ss = (venue.directory_sponsored_status as string) || 'none';
  const busy = savingKey !== null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
      <div className="font-semibold text-gray-900">{venue.name}</div>
      <div className="text-xs text-gray-600">{venue.email}</div>
      {venue.phone ? <div className="text-xs text-gray-500">{venue.phone}</div> : null}
      <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-2 py-2">
        <LunarPayStatusCell venue={venue} summary={lpSummary} />
      </div>
      <div className="text-[11px] text-gray-400">Plan: {planLabelText}</div>
      <div className="text-[10px] text-gray-500">SaaS billing: {(venue.directory_subscription_status as string) || '—'}</div>
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
      {(plans.find((p) => p.id === venue.directory_plan_id)?.price_monthly_cents ?? 0) > 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={onCopyBillingLink}
          className="w-full rounded-lg border border-amber-200 bg-amber-50 py-2 text-[11px] font-medium text-amber-900"
        >
          Copy SaaS billing link
        </button>
      ) : null}
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
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={!venue.login_url}
          onClick={() => venue.login_url && onCopyLogin(venue.login_url, venue.id)}
          className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-medium disabled:opacity-40"
        >
          <Copy size={12} /> {copiedId === venue.id ? 'Copied' : 'Login link'}
        </button>
        <button
          type="button"
          disabled={invitingId === venue.id || !venue.email}
          onClick={onSendInvite}
          className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 py-2 text-xs font-semibold text-emerald-700 disabled:opacity-50"
        >
          <Send size={12} />
          {invitingId === venue.id ? 'Sending…' : inviteToastId === venue.id ? 'Sent ✓' : 'Send invite'}
        </button>
        <button
          type="button"
          onClick={onViewAs}
          className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 rounded-lg border border-pink-200 bg-pink-50 py-2 text-xs font-semibold text-pink-900"
        >
          <Eye size={12} /> View as
        </button>
        <button
          type="button"
          onClick={onExtendTrial}
          className="flex-1 min-w-[100px] inline-flex items-center justify-center gap-1 rounded-lg border border-violet-200 bg-violet-50 py-2 text-xs font-semibold text-violet-700"
        >
          <CalendarClock size={12} /> Trial
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-700"
          >
            <Trash2 size={12} /> Delete
          </button>
        )}
        {!onDelete && (
          <span className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 py-2 text-xs font-semibold text-gray-400 cursor-not-allowed select-none" title="Demo venue — protected from deletion">
            <Lock size={12} /> Protected
          </span>
        )}
      </div>
      {inviteToastId === venue.id && inviteToastMsg && (
        <p className="text-[11px] text-emerald-700 mt-1">{inviteToastMsg}</p>
      )}
    </div>
  );
}
