'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Save, CheckCircle2, User, CreditCard,
  ShieldCheck, Mail, Phone, ArrowRight, RefreshCw,
  BadgeCheck, AlertCircle,
} from 'lucide-react';

// ── Styles ────────────────────────────────────────────────────────────────────
const INPUT = 'w-full rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';
const INPUT_READONLY = 'w-full rounded-2xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-sm text-gray-500 cursor-not-allowed';
const LABEL = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide';
const SECTION = 'rounded-2xl border border-gray-200 bg-white overflow-hidden mb-5';
const SECTION_HEAD = 'px-6 py-4 border-b border-gray-100 flex items-center gap-2.5';

// ── Types ─────────────────────────────────────────────────────────────────────
type OwnerProfile = {
  type: 'owner';
  id: string;
  full_name: string;
  email: string;
  phone: string;
  venue_name: string;
  owner_id: string | null;
  role: 'owner';
};

type MemberProfile = {
  type: 'member';
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
};

type Profile = OwnerProfile | MemberProfile;

type Plan = {
  id: string;
  name: string;
  slug: string;
  price_monthly_cents: number | null;
  is_default: boolean;
};

type Subscription = {
  id: string;
  status: string;
  amount_cents: number;
  frequency: string;
  next_payment_on: string | null;
} | null;

type BillingSummary = {
  current_plan: Plan | null;
  subscription: Subscription;
  subscription_status: string;
  billing_configured: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCents(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusColor(status: string) {
  if (status === 'active')   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'past_due') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'cancelled' || status === 'canceled') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');

  // Owner form state
  const [ownerForm, setOwnerForm] = useState({ full_name: '', email: '', phone: '' });
  // Member form state
  const [memberForm, setMemberForm] = useState({ first_name: '', last_name: '', email: '' });

  // Send-login-link state
  const [sendingLink, setSendingLink]   = useState(false);
  const [linkSent, setLinkSent]         = useState(false);
  const [linkError, setLinkError]       = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [profRes, billRes] = await Promise.all([
          fetch('/api/profile', { cache: 'no-store' }),
          fetch('/api/venue-billing', { cache: 'no-store' }),
        ]);

        if (profRes.ok) {
          const data = await profRes.json() as Profile;
          setProfile(data);
          if (data.type === 'owner') {
            setOwnerForm({ full_name: data.full_name, email: data.email, phone: data.phone });
          } else {
            setMemberForm({ first_name: data.first_name, last_name: data.last_name, email: data.email });
          }
        }

        if (billRes.ok) {
          setBilling(await billRes.json() as BillingSummary);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function saveOwner(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ownerForm),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError('Network error — please try again'); }
    finally { setSaving(false); }
  }

  async function saveMember(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(memberForm),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError('Network error — please try again'); }
    finally { setSaving(false); }
  }

  async function sendLoginLink() {
    if (!profile || profile.type !== 'owner') return;
    setSendingLink(true); setLinkError('');
    try {
      const res = await fetch('/api/auth/request-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ownerForm.email || profile.email }),
      });
      if (res.ok) { setLinkSent(true); setTimeout(() => setLinkSent(false), 6000); }
      else { setLinkError('Could not send link. Try again.'); }
    } catch { setLinkError('Network error — please try again'); }
    finally { setSendingLink(false); }
  }

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="py-24 text-center text-gray-500">
        Could not load profile. <a href="/dashboard" className="underline">Go home</a>
      </div>
    );
  }

  const initials = profile.type === 'owner'
    ? (profile.full_name || profile.venue_name || '?').charAt(0).toUpperCase()
    : (profile.first_name || '?').charAt(0).toUpperCase();

  const displayName = profile.type === 'owner'
    ? profile.full_name || profile.venue_name || 'Account Owner'
    : [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Team Member';

  const roleLabel = profile.role === 'owner' ? 'Account Owner'
    : profile.role === 'admin' ? 'Admin'
    : 'Team Member';

  // ── Owner UI ────────────────────────────────────────────────────────────────
  if (profile.type === 'owner') {
    const sub = billing?.subscription;
    const plan = billing?.current_plan;
    const subStatus = billing?.subscription_status ?? 'none';

    return (
      <div className="max-w-2xl">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-white text-xl font-bold flex-shrink-0"
            style={{ backgroundColor: '#1b1b1b' }}>
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{roleLabel} · {profile.email}</p>
          </div>
        </div>

        {/* ── Personal Information ──────────────────────────────────────────── */}
        <div className={SECTION}>
          <div className={SECTION_HEAD}>
            <User size={16} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Personal Information</h2>
          </div>
          <form onSubmit={saveOwner} className="px-6 py-5 space-y-4">
            <div>
              <label className={LABEL}>Full Name</label>
              <input
                type="text"
                value={ownerForm.full_name}
                onChange={e => setOwnerForm(p => ({ ...p, full_name: e.target.value }))}
                placeholder="Your full name"
                className={INPUT}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>
                  <span className="flex items-center gap-1"><Mail size={11} /> Login Email</span>
                </label>
                <input
                  type="email"
                  required
                  value={ownerForm.email}
                  onChange={e => setOwnerForm(p => ({ ...p, email: e.target.value }))}
                  className={INPUT}
                />
                <p className="mt-1 text-[11px] text-gray-400">This email is used to sign in</p>
              </div>
              <div>
                <label className={LABEL}>
                  <span className="flex items-center gap-1"><Phone size={11} /> Phone</span>
                </label>
                <input
                  type="tel"
                  value={ownerForm.phone}
                  onChange={e => setOwnerForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+1 (555) 000-0000"
                  className={INPUT}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              {saved && (
                <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                  <CheckCircle2 size={15} /> Saved!
                </div>
              )}
              <button
                type="submit"
                disabled={saving}
                className="ml-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* ── Subscription & Billing ────────────────────────────────────────── */}
        <div className={SECTION}>
          <div className={SECTION_HEAD}>
            <CreditCard size={16} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Subscription &amp; Billing</h2>
          </div>
          <div className="px-6 py-5">
            {plan ? (
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                      <BadgeCheck size={15} className="text-gray-600" />
                      {plan.name}
                    </span>
                    {subStatus !== 'none' && (
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${statusColor(subStatus)}`}>
                        {subStatus.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  {sub && (
                    <div className="space-y-0.5 text-xs text-gray-500">
                      {sub.amount_cents > 0 && (
                        <p>{formatCents(sub.amount_cents)}/{sub.frequency}</p>
                      )}
                      {sub.next_payment_on && (
                        <p>Next payment: {formatDate(sub.next_payment_on)}</p>
                      )}
                    </div>
                  )}
                  {subStatus === 'none' && plan.is_default && (
                    <p className="text-xs text-gray-400">Free tier — no payment required</p>
                  )}
                </div>
                <Link
                  href="/dashboard/directory-billing"
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors whitespace-nowrap flex-shrink-0"
                >
                  Manage Billing <ArrowRight size={12} />
                </Link>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-gray-500">No active plan</p>
                <Link
                  href="/dashboard/directory-billing"
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  View Plans <ArrowRight size={12} />
                </Link>
              </div>
            )}
          </div>
          <div className="px-6 pb-5">
            <Link
              href="/dashboard/directory-billing"
              className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 transition-colors group"
            >
              <span className="font-medium">Payment methods &amp; billing history</span>
              <ArrowRight size={14} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
            </Link>
          </div>
        </div>

        {/* ── Account Security ──────────────────────────────────────────────── */}
        <div className={SECTION}>
          <div className={SECTION_HEAD}>
            <ShieldCheck size={16} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900">Account Security</h2>
          </div>
          <div className="px-6 py-5 space-y-3">
            <p className="text-sm text-gray-500">
              StoryVenue uses secure magic-link sign-in — there&apos;s no password to remember.
              Request a new sign-in link at any time and it will be emailed to you.
            </p>
            {linkSent ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 font-medium">
                <CheckCircle2 size={15} /> Sign-in link sent — check your inbox.
              </div>
            ) : (
              <button
                type="button"
                onClick={sendLoginLink}
                disabled={sendingLink}
                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors"
              >
                {sendingLink ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {sendingLink ? 'Sending…' : 'Send new sign-in link'}
              </button>
            )}
            {linkError && (
              <p className="text-xs text-red-500">{linkError}</p>
            )}
            <p className="text-xs text-gray-400">
              Link will be sent to <strong>{ownerForm.email || profile.email}</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Team Member UI ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-white text-xl font-bold flex-shrink-0"
          style={{ backgroundColor: '#1b1b1b' }}>
          {initials}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{roleLabel}</p>
        </div>
      </div>

      <div className={SECTION}>
        <div className={SECTION_HEAD}>
          <User size={16} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Personal Information</h2>
        </div>
        <form onSubmit={saveMember} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={LABEL}>First Name <span className="text-red-400">*</span></label>
              <input
                type="text"
                required
                value={memberForm.first_name}
                onChange={e => setMemberForm(p => ({ ...p, first_name: e.target.value }))}
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>Last Name</label>
              <input
                type="text"
                value={memberForm.last_name}
                onChange={e => setMemberForm(p => ({ ...p, last_name: e.target.value }))}
                className={INPUT}
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>
              <span className="flex items-center gap-1"><Mail size={11} /> Email</span>
            </label>
            <input
              type="email"
              required
              value={memberForm.email}
              onChange={e => setMemberForm(p => ({ ...p, email: e.target.value }))}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Role</label>
            <div className={INPUT_READONLY}>{roleLabel}</div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
              <AlertCircle size={13} /> {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            {saved && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
                <CheckCircle2 size={15} /> Saved!
              </div>
            )}
            <button
              type="submit"
              disabled={saving}
              className="ml-auto flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
