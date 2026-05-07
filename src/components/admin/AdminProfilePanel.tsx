'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Camera, ShieldCheck, AlertCircle, CheckCircle2, User } from 'lucide-react';

interface MeResponse {
  isMasterSuperAdmin: boolean;
  canManageTeam: boolean;
  allowedTabs: string[];
  member: {
    id: string;
    email: string;
    name: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    role: 'support_agent' | 'support_admin';
    is_super_admin: boolean;
  } | null;
}

export function AdminProfilePanel() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/me', { cache: 'no-store' });
    if (res.ok) {
      const j = (await res.json()) as MeResponse;
      setMe(j);
      if (j.member) {
        setFirstName(j.member.first_name ?? '');
        setLastName(j.member.last_name ?? '');
        setEmail(j.member.email);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function flash(message: string) {
    setMsg(message);
    setTimeout(() => setMsg(null), 3000);
  }

  async function saveProfile() {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/admin/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: firstName, last_name: lastName, email }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setErr(j.error || 'Save failed');
      return;
    }
    flash('Profile updated');
    void load();
  }

  async function savePassword() {
    if (!currentPw) { setErr('Enter your current password'); return; }
    if (newPw.length < 8) { setErr('New password must be at least 8 characters'); return; }
    if (newPw !== confirmPw) { setErr('New passwords do not match'); return; }
    setPwBusy(true);
    setErr(null);
    const res = await fetch('/api/admin/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
    });
    setPwBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setErr(j.error || 'Password change failed');
      return;
    }
    flash('Password updated');
    setCurrentPw(''); setNewPw(''); setConfirmPw('');
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/admin/me/avatar', { method: 'POST', body: fd });
    setAvatarBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setErr(j.error || 'Upload failed');
      return;
    }
    flash('Profile picture updated');
    void load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  if (me?.isMasterSuperAdmin) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">My profile</h1>
          <p className="text-sm text-gray-500 mt-1">You are signed in as the master super admin.</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-5 flex items-start gap-3">
          <ShieldCheck className="text-amber-600 mt-0.5" size={18} />
          <div className="flex-1 text-sm text-amber-800 space-y-1">
            <p className="font-medium">Master super admin</p>
            <p>
              Your credentials live in environment variables (<code className="font-mono">ADMIN_EMAIL</code>,
              <code className="font-mono"> ADMIN_PASSWORD</code>). Profile, password, and avatar editing are
              available only to invited team members.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!me?.member) {
    return <div className="py-12 text-center text-sm text-red-600">Unable to load profile.</div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">My profile</h1>
        <p className="text-sm text-gray-500 mt-1">Update your name, email, password, and profile picture.</p>
      </div>

      {msg && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 size={16} /> {msg}
        </div>
      )}
      {err && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertCircle size={16} /> {err}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            {me.member.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.member.avatar_url} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="h-20 w-20 rounded-full bg-gray-100 flex items-center justify-center">
                <User size={28} className="text-gray-400" />
              </div>
            )}
            <button
              type="button" onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
              className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-gray-900 text-white shadow-md flex items-center justify-center hover:bg-gray-700 disabled:opacity-50"
              title="Upload new picture"
            >
              {avatarBusy ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
            </button>
            <input
              ref={fileRef} type="file" accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                if (fileRef.current) fileRef.current.value = '';
              }}
            />
          </div>
          <div>
            <p className="font-medium text-gray-800">{me.member.name}</p>
            <p className="text-xs text-gray-500">{me.member.email}</p>
            {me.member.is_super_admin && (
              <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <ShieldCheck size={10} /> Super Admin
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Account info</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </Field>
          <Field label="Last name">
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </Field>
        </div>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </Field>
        <button
          type="button" disabled={busy} onClick={() => void saveProfile()}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Save changes
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Change password</h2>
        <Field label="Current password">
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New password">
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </Field>
          <Field label="Confirm new password">
            <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </Field>
        </div>
        <button
          type="button" disabled={pwBusy || !currentPw || newPw.length < 8 || newPw !== confirmPw}
          onClick={() => void savePassword()}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pwBusy ? <Loader2 size={14} className="animate-spin" /> : null}
          Update password
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}
