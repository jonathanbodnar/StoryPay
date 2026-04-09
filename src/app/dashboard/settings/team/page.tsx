'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Users, Mail, Shield, ChevronDown, CheckCircle2 } from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'invited' | 'inactive';
  created_at: string;
}

const ROLES = [
  { value: 'owner', label: 'Owner', desc: 'Full access to everything' },
  { value: 'admin', label: 'Admin', desc: 'Manage proposals, customers, settings' },
  { value: 'member', label: 'Member', desc: 'View and manage proposals and customers' },
];

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  member: 'bg-gray-100 text-gray-600',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  invited: 'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-500',
};

const INPUT = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:bg-white transition-colors';

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getAvatarColor(name: string) {
  const colors = ['#1b1b1b','#2d2d2d','#555555','#888888','#333333','#444444'];
  let hash = 0;
  for (const c of name) hash = (hash << 5) - hash + c.charCodeAt(0);
  return colors[Math.abs(hash) % colors.length];
}

export default function TeamPage() {
  const [members, setMembers]   = useState<TeamMember[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', email: '', role: 'member' });

  useEffect(() => {
    fetch('/api/team').then(r => r.json()).then(d => setMembers(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to add member'); return; }
      setMembers(prev => [...prev, data]);
      setForm({ name: '', email: '', role: 'member' });
      setShowForm(false);
      setSaved('Member added');
      setTimeout(() => setSaved(''), 3000);
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  async function changeRole(id: string, role: string) {
    const res = await fetch(`/api/team/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (res.ok) setMembers(prev => prev.map(m => m.id === id ? { ...m, role: role as TeamMember['role'] } : m));
  }

  async function removeMember(id: string) {
    if (!confirm('Remove this team member?')) return;
    setDeletingId(id);
    await fetch(`/api/team/${id}`, { method: 'DELETE' });
    setMembers(prev => prev.filter(m => m.id !== id));
    setDeletingId(null);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-heading text-2xl text-gray-900">Team</h1>
          <p className="mt-1 text-sm text-gray-500">Manage who has access to your StoryPay account</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <CheckCircle2 size={15} /> {saved}
            </div>
          )}
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-all shadow-sm"
            style={{ backgroundColor: '#1b1b1b' }}
          >
            <Plus size={15} />
            Add Team Member
          </button>
        </div>
      </div>

      {/* Add member form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Add Team Member</h2>
            <p className="text-xs text-gray-400 mt-0.5">They will receive an invitation to join your account</p>
          </div>
          <form onSubmit={addMember} className="px-6 py-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                  Full Name <span className="text-red-400">*</span>
                </label>
                <input type="text" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Jane Smith" className={INPUT} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                  Email <span className="text-red-400">*</span>
                </label>
                <input type="email" required value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="jane@yourvenue.com" className={INPUT} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Role</label>
                <div className="relative">
                  <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                    className={`${INPUT} appearance-none pr-8`}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
            {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowForm(false)}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                style={{ backgroundColor: '#1b1b1b' }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {saving ? 'Adding...' : 'Add Member'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Role descriptions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {ROLES.map(r => (
          <div key={r.value} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Shield size={14} className="text-gray-400" />
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[r.value]}`}>{r.label}</span>
            </div>
            <p className="text-xs text-gray-500">{r.desc}</p>
          </div>
        ))}
      </div>

      {/* Members list */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Team Members</h2>
          <span className="ml-auto text-xs text-gray-400">{members.length} member{members.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-gray-400" /></div>
        ) : members.length === 0 ? (
          <div className="py-14 text-center">
            <Users size={36} className="mx-auto mb-3 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">No team members yet</p>
            <p className="text-xs text-gray-400 mt-1">Add your first team member to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                {/* Avatar */}
                <div className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
                  style={{ backgroundColor: getAvatarColor(m.name) }}>
                  {getInitials(m.name)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Mail size={11} className="text-gray-400" />
                    <p className="text-xs text-gray-500 truncate">{m.email}</p>
                  </div>
                </div>

                {/* Status badge */}
                <span className={`hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[m.status]}`}>
                  {m.status}
                </span>

                {/* Role selector */}
                <div className="relative flex-shrink-0">
                  <select
                    value={m.role}
                    onChange={e => changeRole(m.id, e.target.value)}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white appearance-none pr-6 focus:outline-none focus:border-gray-400 transition-colors ${ROLE_COLORS[m.role]}`}
                  >
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-current opacity-50 pointer-events-none" />
                </div>

                {/* Remove */}
                <button onClick={() => removeMember(m.id)} disabled={deletingId === m.id}
                  className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40">
                  {deletingId === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
