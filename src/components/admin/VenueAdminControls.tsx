'use client';

/**
 * Full venue-management controls for a single venue, reused inside the Projects
 * board card modal so a venue can be managed from either place against the same
 * data + endpoints (single source of truth).
 *
 * It self-fetches the enriched venue row + plans from GET /api/admin/venues/[id]
 * and drives every mutation through the exact same endpoints the Venue
 * Management page uses. The addon checkboxes are the literal component exported
 * from VenueManagementPortal, so toggle behavior can never drift.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Copy, Send, Eye, KeyRound, CalendarClock, CreditCard, Lock,
  RotateCcw, Trash2, X, RefreshCw, User, Phone, Mail, MapPin, Check,
} from 'lucide-react';
import { DIRECTORY_BADGE_STATUSES, directoryBadgeLabel } from '@/lib/directory-badges';
import { AddonCheckboxes, type AdminVenueRow, type PlanOpt } from '@/components/admin/VenueManagementPortal';

async function impersonate(venueId: string) {
  const res = await fetch('/api/admin/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ venueId, returnUrl: '/admin/projects' }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    alert(j.error || 'Could not start venue preview');
    return;
  }
  window.location.href = '/dashboard';
}

/** Copy-to-clipboard chip used by the contact card. */
function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      title="Copy"
      className="shrink-0 rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function ContactRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
      <span className="w-24 shrink-0 text-[11px] font-semibold text-gray-400">{label}</span>
      <div className="min-w-0 flex-1 text-[12px] text-gray-800">{children}</div>
    </div>
  );
}

/**
 * Venue + account-holder contact card — name, phone, email, address and the
 * primary profile owner, so the team can reach a client fast from the Projects
 * board (or Venue Management, wherever these controls render).
 */
function VenueContactCard({ venue }: { venue: AdminVenueRow }) {
  const str = (k: string): string => {
    const v = (venue as Record<string, unknown>)[k];
    return typeof v === 'string' && v.trim() ? v.trim() : '';
  };
  const name = str('name');
  const phone = str('phone') || str('notification_phone');
  const email = str('email') || str('notification_email');
  const owner = str('owner_full_name') || [str('owner_first_name'), str('owner_last_name')].filter(Boolean).join(' ');
  const cityState = [str('city'), str('state')].filter(Boolean).join(', ');
  const addrLine2 = [cityState, str('zip')].filter(Boolean).join(' ').trim();
  const addressParts = [str('address'), addrLine2].filter(Boolean);
  const mapQuery = [str('address'), cityState, str('zip')].filter(Boolean).join(', ');

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        <User className="h-3.5 w-3.5" /> Contact
      </div>
      <div className="divide-y divide-gray-50">
        <ContactRow icon={User} label="Venue">
          <span className="font-medium text-gray-900">{name || '—'}</span>
        </ContactRow>
        <ContactRow icon={User} label="Account holder">
          {owner || <span className="text-gray-400">Not set</span>}
        </ContactRow>
        <ContactRow icon={Phone} label="Phone">
          {phone ? (
            <span className="flex items-center gap-1">
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="text-gray-800 hover:underline">{phone}</a>
              <CopyChip value={phone} />
            </span>
          ) : <span className="text-gray-400">Not set</span>}
        </ContactRow>
        <ContactRow icon={Mail} label="Email">
          {email ? (
            <span className="flex items-center gap-1 min-w-0">
              <a href={`mailto:${email}`} className="truncate text-gray-800 hover:underline">{email}</a>
              <CopyChip value={email} />
            </span>
          ) : <span className="text-gray-400">Not set</span>}
        </ContactRow>
        <ContactRow icon={MapPin} label="Address">
          {addressParts.length ? (
            <span className="flex items-start gap-1 min-w-0">
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 text-gray-800 hover:underline"
              >
                {addressParts.join(', ')}
              </a>
              <CopyChip value={addressParts.join(', ')} />
            </span>
          ) : <span className="text-gray-400">Not set</span>}
        </ContactRow>
      </div>
    </div>
  );
}

export function VenueAdminControls({ venueId, onChanged, onDeleted }: { venueId: string; onChanged?: () => void; onDeleted?: () => void }) {
  const [venue, setVenue] = useState<AdminVenueRow | null>(null);
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [trialOpen, setTrialOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load venue');
      setVenue(json.venue as AdminVenueRow);
      setPlans((json.plans || []) as PlanOpt[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
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
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }, [venueId, load, onChanged]);

  const sendInvite = useCallback(async () => {
    setInviting(true);
    setInviteMsg(null);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLegacy: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; sentTo?: string; error?: string };
      setInviteMsg(res.ok && d.ok ? `Invite sent to ${d.sentTo}` : (d.error || 'Invite failed'));
    } catch {
      setInviteMsg('Network error');
    } finally {
      setInviting(false);
      setTimeout(() => setInviteMsg(null), 4000);
    }
  }, [venueId]);

  const suspend = useCallback(async (action: 'suspend' | 'unsuspend') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        alert(j.error || `${action} failed`);
        return;
      }
      setSuspendOpen(false);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }, [venueId, load, onChanged]);

  const copyBillingLink = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/directory-checkout`, { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !d.url) { alert(d.error || 'Could not create billing link'); return; }
      await navigator.clipboard.writeText(d.url);
      alert('SaaS billing link copied. The venue should log in first, then open the link.');
    } catch {
      alert('Request failed');
    }
  }, [venueId]);

  if (loading) {
    return <div className="flex items-center gap-2 py-6 text-xs text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading venue controls…</div>;
  }
  if (error || !venue) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {error || 'Venue not found'}
        <button onClick={load} className="ml-2 inline-flex items-center gap-1 underline"><RefreshCw className="h-3 w-3" /> Retry</button>
      </div>
    );
  }

  const vs = (venue.directory_verified_status as string) || 'none';
  const ss = (venue.directory_sponsored_status as string) || 'none';
  const loginUrl = venue.login_url as string | null;
  const isSuspended = venue.is_suspended === true;
  const isDemo = venue.is_demo === true;
  const hasBilling = Boolean(venue.directory_plan_id || (venue as Record<string, unknown>).directory_subscription_external_id);
  const saasStatus = venue.directory_subscription_status as string | null;

  return (
    <div className="space-y-3">
      {/* Contact — venue + account holder details for fast outreach */}
      <VenueContactCard venue={venue} />

      {/* Plan + badges + toggles */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-gray-400">Plan</span>
          <select
            value={(venue.directory_plan_id as string) || ''}
            disabled={busy}
            onChange={(e) => patch({ directory_plan_id: e.target.value === '' ? null : e.target.value })}
            className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px]"
          >
            <option value="">Full (no plan)</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {saasStatus && <span className="text-[10px] text-gray-400">SaaS: <span className="text-gray-600">{saasStatus}</span></span>}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-gray-400">Verified</span>
          <select value={vs} disabled={busy} onChange={(e) => patch({ directory_verified_status: e.target.value })}
            className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px]">
            {DIRECTORY_BADGE_STATUSES.map((s) => <option key={s} value={s}>{directoryBadgeLabel(s)}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-gray-400">Sponsored</span>
          <select value={ss} disabled={busy} onChange={(e) => patch({ directory_sponsored_status: e.target.value })}
            className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[11px]">
            {DIRECTORY_BADGE_STATUSES.map((s) => <option key={s} value={s}>{directoryBadgeLabel(s)}</option>)}
          </select>
        </div>
        <span className="mx-1 h-4 w-px bg-gray-200" />
        <AddonCheckboxes venue={venue} plans={plans} busy={busy} onPatch={(_, body) => patch(body)} />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={!loginUrl}
          onClick={() => { if (loginUrl) { void navigator.clipboard.writeText(loginUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium hover:bg-gray-50 disabled:opacity-40">
          <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy login'}
        </button>
        <button type="button" disabled={inviting || !venue.email} onClick={sendInvite}
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
          <Send className="h-3 w-3" /> {inviting ? 'Sending…' : inviteMsg ? 'Sent ✓' : 'Send invite'}
        </button>
        <button type="button" onClick={() => impersonate(venueId)}
          className="inline-flex items-center gap-1 rounded-lg border border-pink-200 bg-pink-50 px-2 py-1 text-[11px] font-semibold text-pink-900 hover:bg-pink-100">
          <Eye className="h-3 w-3" /> View as venue
        </button>
        <button type="button" onClick={() => setPwOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100">
          <KeyRound className="h-3 w-3" /> Set password
        </button>
        <button type="button" onClick={() => setTrialOpen(true)}
          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 hover:bg-violet-100">
          <CalendarClock className="h-3 w-3" /> Extend trial
        </button>
        {hasBilling && (
          <button type="button" onClick={() => setBillingOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100">
            <CreditCard className="h-3 w-3" /> Billing
          </button>
        )}
        {isSuspended ? (
          <button type="button" disabled={busy} onClick={() => suspend('unsuspend')}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
            <RotateCcw className="h-3 w-3" /> Restore access
          </button>
        ) : !isDemo && (
          <button type="button" disabled={busy} onClick={() => setSuspendOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50">
            <Lock className="h-3 w-3" /> Suspend
          </button>
        )}
        {!isDemo && (
          <button type="button" onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        )}
      </div>
      {inviteMsg && <p className="text-[11px] text-gray-500">{inviteMsg}</p>}

      {pwOpen && <SetPasswordModal venueId={venueId} venueName={String(venue.name)} onClose={() => setPwOpen(false)} />}
      {trialOpen && (
        <ExtendTrialModal
          venueId={venueId}
          current={(venue.directory_trial_ends_at as string | null) ?? null}
          onClose={() => setTrialOpen(false)}
          onDone={() => { setTrialOpen(false); load(); onChanged?.(); }}
        />
      )}
      {billingOpen && <BillingModal venueId={venueId} venueName={String(venue.name)} onClose={() => setBillingOpen(false)} onChanged={() => { load(); onChanged?.(); }} />}
      {suspendOpen && (
        <ConfirmModal
          title={`Suspend ${venue.name}?`}
          body="The owner will be locked out of their dashboard until you restore access. Their data is untouched."
          confirmLabel="Suspend access"
          danger
          busy={busy}
          onCancel={() => setSuspendOpen(false)}
          onConfirm={() => suspend('suspend')}
        />
      )}
      {deleteOpen && (
        <DeleteVenueModal
          venueId={venueId}
          venueName={String(venue.name)}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => { setDeleteOpen(false); (onDeleted ?? onChanged)?.(); }}
        />
      )}
    </div>
  );
}

// ── Sub-modals ────────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({
  title, body, confirmLabel, danger, busy, onCancel, onConfirm,
}: {
  title: string; body: string; confirmLabel: string; danger?: boolean; busy?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onCancel}>
      <div className="p-5">
        <p className="text-sm text-gray-600">{body}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">Cancel</button>
        <button onClick={onConfirm} disabled={busy}
          className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-900 hover:bg-gray-700'}`}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function SetPasswordModal({ venueId, venueName, onClose }: { venueId: string; venueName: string; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  const save = async () => {
    setErr('');
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (pw !== confirm) { setErr('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/venues/${venueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setErr(j.error || 'Failed'); return; }
      setOk(true);
      setTimeout(onClose, 1200);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Set password — ${venueName}`} onClose={onClose}>
      <div className="space-y-3 p-5">
        {ok ? (
          <p className="text-sm text-emerald-600">Password updated.</p>
        ) : (
          <>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 chars)" autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none" />
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none" />
            {err && <p className="text-xs text-red-600">{err}</p>}
          </>
        )}
      </div>
      {!ok && (
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save password
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function ExtendTrialModal({ venueId, current, onClose, onDone }: { venueId: string; current: string | null; onClose: () => void; onDone: () => void }) {
  const def = current ? new Date(current).toISOString().slice(0, 10) : new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const [date, setDate] = useState(def);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/venues/${venueId}/extend-trial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trial_ends_at: date }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setErr(j.error || 'Failed to extend trial'); return; }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Extend trial" onClose={onClose}>
      <div className="space-y-3 p-5">
        <label className="block text-xs font-medium text-gray-500">Trial ends</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none" />
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">Cancel</button>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </button>
      </div>
    </ModalShell>
  );
}

function DeleteVenueModal({ venueId, venueName, onClose, onDeleted }: { venueId: string; venueName: string; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');

  const del = async () => {
    setDeleting(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/venues/${venueId}`, { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setErr(j.error || 'Delete failed'); return; }
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ModalShell title={`Delete ${venueName}?`} onClose={onClose}>
      <div className="space-y-3 p-5">
        <p className="text-sm text-gray-600">
          This permanently deletes the venue, its owner login, and all related data. This cannot be undone. Type the venue
          name to confirm.
        </p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={venueName} autoFocus
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-800">Cancel</button>
        <button onClick={del} disabled={deleting || name.trim() !== venueName.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40">
          {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Delete permanently
        </button>
      </div>
    </ModalShell>
  );
}

function BillingModal({ venueId, venueName, onClose, onChanged }: { venueId: string; venueName: string; onClose: () => void; onChanged: () => void }) {
  const [sub, setSub] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [chargeId, setChargeId] = useState('');
  const [refund, setRefund] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const action = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/venues/${venueId}/billing-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => ({}));
  }, [venueId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const d = await action({ action: 'fetch_subscription' }) as { subscription?: Record<string, unknown> | null; error?: string };
      setSub(d.subscription ?? null);
      if (d.error) setMsg({ text: d.error, ok: false });
      setLoading(false);
    })();
  }, [action]);

  const cancelSub = async () => {
    if (!confirm(`Cancel the subscription for "${venueName}"? Future charges stop immediately.`)) return;
    setWorking(true);
    const d = await action({ action: 'cancel_subscription' }) as { ok?: boolean; error?: string };
    setMsg(d.ok ? { text: 'Subscription canceled.', ok: true } : { text: d.error || 'Cancel failed', ok: false });
    if (d.ok) { setSub(null); onChanged(); }
    setWorking(false);
  };

  const doRefund = async () => {
    if (!chargeId.trim()) return;
    setWorking(true);
    const dollars = parseFloat(refund);
    const cents = !isNaN(dollars) && dollars > 0 ? Math.round(dollars * 100) : undefined;
    const d = await action({ action: 'refund_charge', charge_id: chargeId.trim(), amount_cents: cents }) as { ok?: boolean; error?: string };
    setMsg(d.ok ? { text: `Refund issued${cents ? ` ($${(cents / 100).toFixed(2)})` : ' (full)'}.`, ok: true } : { text: d.error || 'Refund failed', ok: false });
    if (d.ok) { setChargeId(''); setRefund(''); }
    setWorking(false);
  };

  return (
    <ModalShell title={`Billing — ${venueName}`} onClose={onClose}>
      <div className="space-y-4 p-5">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading subscription…</div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            {sub ? (
              <div className="space-y-0.5">
                <div>Status: <span className="font-medium text-gray-800">{String(sub.status ?? 'unknown')}</span></div>
                {sub.id != null && <div>Sub ID: <span className="font-mono">{String(sub.id)}</span></div>}
              </div>
            ) : <span>No live subscription on file.</span>}
          </div>
        )}

        {sub && (
          <button onClick={cancelSub} disabled={working}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
            {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Cancel subscription
          </button>
        )}

        <div className="space-y-2 border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500">Refund a charge</p>
          <input value={chargeId} onChange={(e) => setChargeId(e.target.value)} placeholder="Charge ID"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none" />
          <input value={refund} onChange={(e) => setRefund(e.target.value)} placeholder="Amount (blank = full refund)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none" />
          <button onClick={doRefund} disabled={working || !chargeId.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
            {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Issue refund
          </button>
        </div>

        {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
      </div>
    </ModalShell>
  );
}
