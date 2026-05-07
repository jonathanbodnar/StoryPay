'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  KeyRound,
  Trash2,
  ShieldCheck,
  X,
  Mail,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  ADMIN_TABS,
  ADMIN_TAB_CATEGORY_LABELS,
  defaultAdminTabsAllTrue,
  type AdminTabDef,
} from '@/lib/admin-tabs-registry';

interface TeamMember {
  id: string;
  email: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  role: 'support_agent' | 'support_admin';
  active: boolean;
  is_super_admin: boolean;
  admin_tabs_allowed: Record<string, boolean> | null;
  last_login_at: string | null;
  created_at: string;
}

const CATEGORIES: AdminTabDef['category'][] = ['core', 'venue', 'content', 'tools'];

function groupTabsByCategory() {
  const map: Record<string, AdminTabDef[]> = {};
  for (const t of ADMIN_TABS) {
    if (!map[t.category]) map[t.category] = [];
    map[t.category].push(t);
  }
  return map;
}

export function AdminTeamPanel() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pwResetId, setPwResetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const res = await fetch('/api/admin/team-members', { cache: 'no-store' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setErr(j.error || 'Failed to load team');
      setLoading(false);
      return;
    }
    const j = await res.json() as { members: TeamMember[] };
    setMembers(j.members);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function flash(message: string) {
    setMsg(message);
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleDeactivate(m: TeamMember) {
    if (!confirm(`Deactivate ${m.name || m.email}? They will lose access immediately.`)) return;
    const res = await fetch(`/api/admin/team-members/${m.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setErr(j.error || 'Deactivation failed');
      return;
    }
    flash('Team member deactivated');
    await load();
  }

  async function handleReactivate(m: TeamMember) {
    const res = await fetch(`/api/admin/team-members/${m.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setErr(j.error || 'Reactivation failed');
      return;
    }
    flash('Team member reactivated');
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Team management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Invite StoryVenue staff to the super admin panel and control which tabs they can access.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          <Plus size={16} />
          Invite team member
        </button>
      </div>

      {msg && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircle2 size={16} />
          {msg}
        </div>
      )}
      {err && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertCircle size={16} />
          {err}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-gray-400" size={24} />
          </div>
        ) : members.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No team members yet. Invite your first team member to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Last login</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {m.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-gray-100 text-xs font-medium text-gray-500 flex items-center justify-center">
                          {(m.first_name?.[0] ?? m.name[0] ?? '?').toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-gray-800">{m.name || '—'}</span>
                      {m.is_super_admin && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          <ShieldCheck size={10} />
                          Super Admin
                        </span>
                      )}
                      {!m.active && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">Inactive</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {m.is_super_admin ? 'All access' : `${Object.values(m.admin_tabs_allowed ?? {}).filter(Boolean).length} tabs`}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {m.last_login_at ? new Date(m.last_login_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditingId(m.id)}
                        title="Edit"
                        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPwResetId(m.id)}
                        title="Reset password"
                        className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                      >
                        <KeyRound size={14} />
                      </button>
                      {m.active ? (
                        <button
                          type="button"
                          onClick={() => void handleDeactivate(m)}
                          title="Deactivate"
                          className="rounded p-1.5 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleReactivate(m)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onSaved={() => { setInviteOpen(false); flash('Team member invited'); void load(); }}
        />
      )}
      {editingId && (
        <EditModal
          member={members.find((m) => m.id === editingId)!}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); flash('Saved'); void load(); }}
        />
      )}
      {pwResetId && (
        <PasswordResetModal
          member={members.find((m) => m.id === pwResetId)!}
          onClose={() => setPwResetId(null)}
          onSaved={() => { setPwResetId(null); flash('Password updated'); }}
        />
      )}
    </div>
  );
}

// ─── Invite modal ────────────────────────────────────────────────────────────

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [tabs, setTabs] = useState<Record<string, boolean>>(defaultAdminTabsAllTrue());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/team-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          password,
          is_super_admin: isSuperAdmin,
          admin_tabs_allowed: tabs,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setErr(j.error || 'Failed to invite');
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error — please try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Invite team member" widthClass="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Jane"
            />
          </Field>
          <Field label="Last name">
            <input
              type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Doe"
            />
          </Field>
        </div>
        <Field label="Email">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="jane@storyvenue.com"
          />
        </Field>
        <Field label="Initial password">
          <input
            type="text" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono"
            placeholder="At least 8 characters"
          />
        </Field>

        <label className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-3 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox" checked={isSuperAdmin} onChange={(e) => setIsSuperAdmin(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <span className="text-sm font-medium text-gray-800">Super admin (full access)</span>
            <p className="text-xs text-gray-500 mt-0.5">
              Grants every tab automatically and lets them manage other team members.
            </p>
          </div>
        </label>

        {!isSuperAdmin && <TabAccessEditor tabs={tabs} setTabs={setTabs} />}

        {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:underline">
            Cancel
          </button>
          <button
            type="button" disabled={busy || !firstName.trim() || !email.trim() || password.length < 8}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            Send invite
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Edit modal ──────────────────────────────────────────────────────────────

function EditModal({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: () => void }) {
  const [firstName, setFirstName] = useState(member.first_name ?? '');
  const [lastName, setLastName] = useState(member.last_name ?? '');
  const [email, setEmail] = useState(member.email);
  const [isSuperAdmin, setIsSuperAdmin] = useState(member.is_super_admin);
  const [tabs, setTabs] = useState<Record<string, boolean>>(() => {
    const base = defaultAdminTabsAllTrue();
    if (member.admin_tabs_allowed) {
      for (const t of ADMIN_TABS) base[t.key] = member.admin_tabs_allowed[t.key] === true;
    }
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/team-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email,
          is_super_admin: isSuperAdmin,
          admin_tabs_allowed: tabs,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setErr(j.error || 'Save failed');
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error — please try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Edit team member" widthClass="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Last name">
            <input
              type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <Field label="Email">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </Field>

        <label className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-3 cursor-pointer hover:bg-gray-50">
          <input
            type="checkbox" checked={isSuperAdmin} onChange={(e) => setIsSuperAdmin(e.target.checked)}
            className="mt-0.5"
          />
          <div>
            <span className="text-sm font-medium text-gray-800">Super admin (full access)</span>
            <p className="text-xs text-gray-500 mt-0.5">
              Grants every tab automatically and lets them manage other team members.
            </p>
          </div>
        </label>

        {!isSuperAdmin && <TabAccessEditor tabs={tabs} setTabs={setTabs} />}

        {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancel</button>
          <button
            type="button" disabled={busy} onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Password reset modal ────────────────────────────────────────────────────

function PasswordResetModal({ member, onClose, onSaved }: { member: TeamMember; onClose: () => void; onSaved: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/admin/team-members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string };
      setErr(j.error || 'Reset failed');
      return;
    }
    onSaved();
  }

  return (
    <ModalShell onClose={onClose} title={`Reset password — ${member.name || member.email}`} widthClass="max-w-md">
      <div className="space-y-4">
        {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        <Field label="New password">
          <input
            type="text" value={pw} onChange={(e) => setPw(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono"
            placeholder="At least 8 characters"
            autoFocus
          />
        </Field>
        <p className="text-xs text-gray-500">
          Send the new password to the team member through a secure channel. They can change it themselves
          from the My Profile page after logging in.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:underline">Cancel</button>
          <button
            type="button" disabled={busy || pw.length < 8} onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Set new password
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Reusable bits ───────────────────────────────────────────────────────────

function TabAccessEditor({ tabs, setTabs }: { tabs: Record<string, boolean>; setTabs: (t: Record<string, boolean>) => void }) {
  const grouped = groupTabsByCategory();
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-800">Tab access</span>
        <div className="flex gap-3 text-xs">
          <button
            type="button" onClick={() => setTabs(defaultAdminTabsAllTrue())}
            className="text-blue-600 hover:underline"
          >
            All on
          </button>
          <button
            type="button" onClick={() => setTabs(Object.fromEntries(ADMIN_TABS.map((t) => [t.key, false])))}
            className="text-blue-600 hover:underline"
          >
            All off
          </button>
        </div>
      </div>
      {CATEGORIES.map((cat) =>
        grouped[cat] ? (
          <div key={cat}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
              {ADMIN_TAB_CATEGORY_LABELS[cat]}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {grouped[cat].map((t) => (
                <label
                  key={t.key}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-white"
                >
                  <input
                    type="checkbox" checked={tabs[t.key] === true}
                    onChange={(e) => setTabs({ ...tabs, [t.key]: e.target.checked })}
                  />
                  <span className="text-gray-700">{t.label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

function ModalShell({ children, onClose, title, widthClass }: { children: React.ReactNode; onClose: () => void; title: string; widthClass: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" role="dialog">
      <div className={`w-full ${widthClass} rounded-xl border border-gray-200 bg-white p-6 my-8`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>
        {children}
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
