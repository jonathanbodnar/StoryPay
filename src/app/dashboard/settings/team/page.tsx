'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, Loader2, Users, Mail, Shield, ChevronDown,
  CheckCircle2, Pencil, Send, MoreHorizontal, X,
} from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'invited' | 'inactive';
  created_at: string;
  invited_at: string | null;
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

function getInitials(first: string, last: string) {
  const f = first?.[0] || '';
  const l = last?.[0] || '';
  return (f + l).toUpperCase() || '??';
}

function getAvatarColor(name: string) {
  const colors = ['#1b1b1b', '#2d2d2d', '#555555', '#888888', '#333333', '#444444'];
  let hash = 0;
  for (const c of name) hash = (hash << 5) - hash + c.charCodeAt(0);
  return colors[Math.abs(hash) % colors.length];
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', role: 'member' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', role: 'member' });

  const fetchMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/team');
      const d = await res.json();
      setMembers(Array.isArray(d) ? d : []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-menu]')) setMenuOpenId(null);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  function showSaved(msg: string) {
    setSaved(msg);
    setTimeout(() => setSaved(''), 3000);
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to add member'); return; }
      setMembers(prev => [...prev, data]);
      setForm({ first_name: '', last_name: '', email: '', role: 'member' });
      setShowForm(false);
      showSaved('Member invited successfully');
    } catch { setError('Network error — please try again'); }
    finally { setSaving(false); }
  }

  async function changeRole(id: string, role: string) {
    const prev = members;
    setMembers(m => m.map(x => x.id === id ? { ...x, role: role as TeamMember['role'] } : x));
    try {
      const res = await fetch(`/api/team/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(m => m.map(x => x.id === id ? data : x));
        showSaved('Role updated');
      } else {
        setMembers(prev);
      }
    } catch { setMembers(prev); }
  }

  async function removeMember(id: string) {
    if (!confirm('Remove this team member? This action cannot be undone.')) return;
    setDeletingId(id);
    setMenuOpenId(null);
    try {
      const res = await fetch(`/api/team/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMembers(prev => prev.filter(m => m.id !== id));
        showSaved('Member removed');
      }
    } catch { /* swallow */ }
    finally { setDeletingId(null); }
  }

  async function resendInvite(id: string) {
    setResendingId(id);
    setMenuOpenId(null);
    try {
      const res = await fetch(`/api/team/${id}/resend-invite`, { method: 'POST' });
      if (res.ok) {
        setMembers(m => m.map(x =>
          x.id === id ? { ...x, status: 'invited' as const, invited_at: new Date().toISOString() } : x
        ));
        showSaved('Invite resent');
      }
    } catch { /* swallow */ }
    finally { setResendingId(null); }
  }

  function startEdit(m: TeamMember) {
    setEditingId(m.id);
    setEditForm({ first_name: m.first_name || '', last_name: m.last_name || '', email: m.email, role: m.role });
    setEditError('');
    setMenuOpenId(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditSaving(true);
    setEditError('');
    try {
      const res = await fetch(`/api/team/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) { setEditError(data.error || 'Failed to update'); return; }
      setMembers(m => m.map(x => x.id === editingId ? data : x));
      setEditingId(null);
      showSaved('Member updated');
    } catch { setEditError('Network error'); }
    finally { setEditSaving(false); }
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
            <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium animate-fade-in">
              <CheckCircle2 size={15} /> {saved}
            </div>
          )}
          <button
            onClick={() => { setShowForm(v => !v); setError(''); }}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                  First Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.first_name}
                  onChange={e => setForm(p => ({ ...p, first_name: e.target.value }))}
                  placeholder="Jane"
                  className={INPUT}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                  Last Name
                </label>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={e => setForm(p => ({ ...p, last_name: e.target.value }))}
                  placeholder="Smith"
                  className={INPUT}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="jane@yourvenue.com"
                  className={INPUT}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Role</label>
                <div className="relative">
                  <select
                    value={form.role}
                    onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                    className={`${INPUT} appearance-none pr-8`}
                  >
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
            {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                style={{ backgroundColor: '#1b1b1b' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {saving ? 'Adding...' : 'Add Member'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit member modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Edit Team Member</h2>
                <p className="text-xs text-gray-400 mt-0.5">Update member details and access level</p>
              </div>
              <button onClick={() => setEditingId(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={saveEdit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                    First Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editForm.first_name}
                    onChange={e => setEditForm(p => ({ ...p, first_name: e.target.value }))}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={editForm.last_name}
                    onChange={e => setEditForm(p => ({ ...p, last_name: e.target.value }))}
                    className={INPUT}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={editForm.email}
                  onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))}
                  className={INPUT}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Role</label>
                <div className="relative">
                  <select
                    value={editForm.role}
                    onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}
                    className={`${INPUT} appearance-none pr-8`}
                  >
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              {editError && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{editError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 transition-all"
                  style={{ backgroundColor: '#1b1b1b' }}
                >
                  {editSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
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

      {/* Fixed-position actions menu — renders outside any overflow:hidden container */}
      {menuOpenId && (() => {
        const m = members.find(x => x.id === menuOpenId);
        if (!m) return null;
        return (
          <div
            data-menu
            className="fixed z-50 w-52 rounded-xl border border-gray-200 bg-white shadow-xl py-1"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button
              onClick={() => startEdit(m)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Pencil size={14} className="text-gray-400" /> Edit Member
            </button>
            {(m.status === 'invited' || m.status === 'inactive') && (
              <button
                onClick={() => resendInvite(m.id)}
                disabled={resendingId === m.id}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {resendingId === m.id ? <Loader2 size={14} className="animate-spin text-gray-400" /> : <Send size={14} className="text-gray-400" />}
                Resend Invite
              </button>
            )}
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => removeMember(m.id)}
              disabled={deletingId === m.id}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deletingId === m.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Remove Member
            </button>
          </div>
        );
      })()}

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
                <div
                  className="flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
                  style={{ backgroundColor: getAvatarColor(m.name || m.first_name || '') }}
                >
                  {getInitials(m.first_name || m.name?.split(' ')[0] || '', m.last_name || m.name?.split(' ')[1] || '')}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {m.first_name || m.last_name
                      ? [m.first_name, m.last_name].filter(Boolean).join(' ')
                      : m.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Mail size={11} className="text-gray-400" />
                    <p className="text-xs text-gray-500 truncate">{m.email}</p>
                  </div>
                </div>

                {/* Status badge */}
                <span className={`hidden sm:inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[m.status] || STATUS_COLORS.active}`}>
                  {m.status || 'active'}
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

                {/* Actions menu trigger */}
                <div className="flex-shrink-0" data-menu>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (menuOpenId === m.id) { setMenuOpenId(null); return; }
                      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      setMenuPos({ top: rect.bottom + window.scrollY + 4, right: window.innerWidth - rect.right });
                      setMenuOpenId(m.id);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
