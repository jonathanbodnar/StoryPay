'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2, Save, CheckCircle2, User, CreditCard,
  ShieldCheck, Phone, ArrowRight,
  BadgeCheck, AlertCircle, Download, Trash2, AlertTriangle,
  KeyRound, Eye, EyeOff, AtSign,
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
  first_name: string;
  last_name: string;
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
  const [ownerForm, setOwnerForm] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  // Member form state
  const [memberForm, setMemberForm] = useState({ first_name: '', last_name: '', email: '' });

  // Email change state
  const [emailForm, setEmailForm]           = useState({ new_email: '', current_password_for_email: '' });
  const [emailSaving, setEmailSaving]       = useState(false);
  const [emailSaved, setEmailSaved]         = useState(false);
  const [emailError, setEmailError]         = useState('');
  const [showEmailPass, setShowEmailPass]   = useState(false);

  // Password change state
  const [passForm, setPassForm]             = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [passSaving, setPassSaving]         = useState(false);
  const [passSaved, setPassSaved]           = useState(false);
  const [passError, setPassError]           = useState('');
  const [showCurPass, setShowCurPass]       = useState(false);
  const [showNewPass, setShowNewPass]       = useState(false);
  const [showConfPass, setShowConfPass]     = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm]     = useState('');
  const [deleting, setDeleting]               = useState(false);
  const [deleteError, setDeleteError]         = useState('');
  const [exporting, setExporting]             = useState(false);
  const router = useRouter();

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
            setOwnerForm({ first_name: data.first_name, last_name: data.last_name, email: data.email, phone: data.phone });
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
    if (!ownerForm.first_name.trim()) { setError('First name is required.'); return; }
    if (!ownerForm.email.trim())      { setError('Email is required.'); return; }
    if (!ownerForm.phone.trim())      { setError('Phone is required.'); return; }
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

  async function updateEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailSaving(true); setEmailError(''); setEmailSaved(false);
    try {
      const res = await fetch('/api/profile/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'email', ...emailForm }),
      });
      const data = await res.json() as { ok?: boolean; email?: string; error?: string };
      if (!res.ok) { setEmailError(data.error ?? 'Failed to update email'); return; }
      // Update local state so the header reflects the new email
      setOwnerForm((f) => ({ ...f, email: data.email ?? f.email }));
      setProfile((p) => p ? { ...p, email: data.email ?? (p as OwnerProfile).email } as Profile : p);
      setEmailForm({ new_email: '', current_password_for_email: '' });
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 4000);
    } catch { setEmailError('Network error — please try again'); }
    finally { setEmailSaving(false); }
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setPassSaving(true); setPassError(''); setPassSaved(false);
    try {
      const res = await fetch('/api/profile/credentials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'password', ...passForm }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { setPassError(data.error ?? 'Failed to update password'); return; }
      setPassForm({ current_password: '', new_password: '', confirm_password: '' });
      setPassSaved(true);
      setTimeout(() => setPassSaved(false), 4000);
    } catch { setPassError('Network error — please try again'); }
    finally { setPassSaving(false); }
  }

  async function exportClients() {
    setExporting(true);
    try {
      const res = await fetch('/api/venues/me/export-clients');
      if (!res.ok) { alert('Export failed. Please try again.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clients_export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (!profile || profile.type !== 'owner') return;
    setDeleting(true); setDeleteError('');
    try {
      const res = await fetch('/api/venues/me/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: deleteConfirm }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setDeleteError(data.error || 'Deletion failed'); return; }
      router.push('/');
    } catch { setDeleteError('Network error — please try again'); }
    finally { setDeleting(false); }
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
    ? (profile.first_name || profile.venue_name || '?').charAt(0).toUpperCase()
    : (profile.first_name || '?').charAt(0).toUpperCase();

  const displayName = profile.type === 'owner'
    ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.venue_name || 'Account Owner'
    : [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Team Member';

  const roleLabel = profile.role === 'owner' ? 'Account Owner'
    : profile.role === 'admin' ? 'Admin'
    : 'Team Member';

  // ── Owner UI ────────────────────────────────────────────────────────────────
  if (profile.type === 'owner') {
    const venueName = profile.venue_name; // capture for use in JSX closures
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>First Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  required
                  value={ownerForm.first_name}
                  onChange={e => setOwnerForm(p => ({ ...p, first_name: e.target.value }))}
                  placeholder="First name"
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Last Name</label>
                <input
                  type="text"
                  value={ownerForm.last_name}
                  onChange={e => setOwnerForm(p => ({ ...p, last_name: e.target.value }))}
                  placeholder="Last name"
                  className={INPUT}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>
                  <span className="flex items-center gap-1"><Mail size={11} /> Login Email <span className="text-red-400">*</span></span>
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
                  <span className="flex items-center gap-1"><Phone size={11} /> Phone <span className="text-red-400">*</span></span>
                </label>
                <input
                  type="tel"
                  required
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
                disabled={saving || !ownerForm.first_name.trim() || !ownerForm.email.trim() || !ownerForm.phone.trim()}
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
            <h2 className="text-sm font-semibold text-gray-900">Login & Security</h2>
          </div>

          {/* Change Email */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <AtSign size={14} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-800">Change Email</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Current email: <span className="font-medium text-gray-700">{ownerForm.email || profile.email}</span>
            </p>
            <form onSubmit={(e) => void updateEmail(e)} className="space-y-3 max-w-md">
              <div>
                <label className={LABEL}>New Email Address</label>
                <input
                  type="email"
                  value={emailForm.new_email}
                  onChange={(e) => setEmailForm((f) => ({ ...f, new_email: e.target.value }))}
                  placeholder="new@email.com"
                  className={INPUT}
                  required
                />
              </div>
              <div>
                <label className={LABEL}>Confirm with Current Password</label>
                <div className="relative">
                  <input
                    type={showEmailPass ? 'text' : 'password'}
                    value={emailForm.current_password_for_email}
                    onChange={(e) => setEmailForm((f) => ({ ...f, current_password_for_email: e.target.value }))}
                    placeholder="Your current password"
                    className={INPUT + ' pr-10'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmailPass((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showEmailPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {emailError && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={13} /> {emailError}
                </div>
              )}
              {emailSaved && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 font-medium">
                  <CheckCircle2 size={13} /> Email updated successfully.
                </div>
              )}
              <button
                type="submit"
                disabled={emailSaving || !emailForm.new_email}
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {emailSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {emailSaving ? 'Saving…' : 'Update Email'}
              </button>
            </form>
          </div>

          {/* Change Password */}
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound size={14} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-800">Change Password</h3>
            </div>
            <form onSubmit={(e) => void updatePassword(e)} className="space-y-3 max-w-md">
              <div>
                <label className={LABEL}>Current Password</label>
                <div className="relative">
                  <input
                    type={showCurPass ? 'text' : 'password'}
                    value={passForm.current_password}
                    onChange={(e) => setPassForm((f) => ({ ...f, current_password: e.target.value }))}
                    placeholder="Enter current password"
                    className={INPUT + ' pr-10'}
                  />
                  <button type="button" onClick={() => setShowCurPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showCurPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className={LABEL}>New Password</label>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    value={passForm.new_password}
                    onChange={(e) => setPassForm((f) => ({ ...f, new_password: e.target.value }))}
                    placeholder="At least 8 characters"
                    className={INPUT + ' pr-10'}
                    minLength={8}
                  />
                  <button type="button" onClick={() => setShowNewPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showNewPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfPass ? 'text' : 'password'}
                    value={passForm.confirm_password}
                    onChange={(e) => setPassForm((f) => ({ ...f, confirm_password: e.target.value }))}
                    placeholder="Repeat new password"
                    className={INPUT + ' pr-10'}
                  />
                  <button type="button" onClick={() => setShowConfPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showConfPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {passForm.new_password && passForm.confirm_password && passForm.new_password !== passForm.confirm_password && (
                  <p className="mt-1 text-xs text-red-500">Passwords do not match.</p>
                )}
              </div>
              {passError && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  <AlertCircle size={13} /> {passError}
                </div>
              )}
              {passSaved && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 font-medium">
                  <CheckCircle2 size={13} /> Password updated successfully.
                </div>
              )}
              <button
                type="submit"
                disabled={
                  passSaving ||
                  !passForm.new_password ||
                  passForm.new_password.length < 8 ||
                  passForm.new_password !== passForm.confirm_password
                }
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {passSaving ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                {passSaving ? 'Saving…' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>

        {/* ── Danger Zone ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-red-200 bg-white overflow-hidden mb-5">
          <div className="px-6 py-4 border-b border-red-100 flex items-center gap-2.5">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="text-sm font-semibold text-red-700">Account Data</h2>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Export Client Data</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Download all your contacts and clients as a CSV file.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void exportClients()}
                disabled={exporting}
                className="shrink-0 flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {exporting ? 'Exporting…' : 'Download CSV'}
              </button>
            </div>
            <div className="border-t border-red-100 pt-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-red-700">Delete Account</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Permanently delete your venue and all data. This cannot be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowDeleteModal(true); setDeleteConfirm(''); setDeleteError(''); }}
                className="shrink-0 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 transition-colors"
              >
                <Trash2 size={14} /> Delete Account
              </button>
            </div>
          </div>
        </div>

        {/* Delete confirmation modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                  <AlertTriangle size={20} className="text-red-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">Delete Your Account</h3>
                  <p className="text-xs text-gray-500">Permanent — cannot be undone</p>
                </div>
              </div>
              <p className="text-sm text-gray-700 mb-1">
                This will permanently delete <strong>{venueName}</strong> and all associated
                data — contacts, conversations, leads, payments, and files.
              </p>
              <p className="text-sm text-gray-700 mb-4">
                Type <strong>{venueName}</strong> to confirm:
              </p>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={venueName}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm mb-3 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-200"
              />
              {deleteError && (
                <p className="mb-3 text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle size={13} /> {deleteError}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleting}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteConfirm !== venueName || deleting}
                  onClick={() => void deleteAccount()}
                  className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {deleting ? 'Deleting…' : 'Delete Forever'}
                </button>
              </div>
            </div>
          </div>
        )}
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
