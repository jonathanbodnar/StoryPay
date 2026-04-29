'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Search,
  Trash2,
  AlertTriangle,
  RefreshCw,
  LogIn,
  Mail,
  KeyRound,
  Pencil,
  X,
  Heart,
  Eye,
  EyeOff,
  CheckCircle2,
} from 'lucide-react';

const BRAND = '#1b1b1b';

interface AdminCoupleRow {
  id: string;
  email: string | null;
  display_name: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  wedding_date: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  saved_venue_count: number;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

function fmtRelative(s: string | null): string {
  if (!s) return 'Never';
  const d = new Date(s);
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(s);
}

export function CoupleManagementPortal() {
  const [couples, setCouples] = useState<AdminCoupleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [actionState, setActionState] = useState<{ id: string; action: string } | null>(null);

  // Edit modal state
  const [editing, setEditing] = useState<AdminCoupleRow | null>(null);
  const [editTab, setEditTab] = useState<'profile' | 'email' | 'password'>('profile');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWeddingDate, setEditWeddingDate] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editConfirmPass, setEditConfirmPass] = useState('');
  const [showEditPass, setShowEditPass] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSavedFlash, setEditSavedFlash] = useState('');

  // Delete confirmation
  const [deleting, setDeleting] = useState<AdminCoupleRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteWorking, setDeleteWorking] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadCouples = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/couples', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setCouples(Array.isArray(data.couples) ? data.couples : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load couples');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCouples(); }, [loadCouples]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return couples;
    return couples.filter((c) => {
      const hay = [c.email, c.display_name, c.phone, c.city, c.state]
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }, [couples, search]);

  function openEdit(c: AdminCoupleRow) {
    setEditing(c);
    setEditTab('profile');
    setEditName(c.display_name ?? '');
    setEditPhone(c.phone ?? '');
    setEditWeddingDate(c.wedding_date ?? '');
    setEditEmail(c.email ?? '');
    setEditPassword('');
    setEditConfirmPass('');
    setEditError('');
    setEditSavedFlash('');
  }

  async function saveEdit() {
    if (!editing) return;
    setEditSaving(true);
    setEditError('');
    setEditSavedFlash('');
    try {
      const body: Record<string, string | null> = {};
      if (editTab === 'profile') {
        body.display_name = editName.trim() || null;
        body.phone = editPhone.trim() || null;
        body.wedding_date = editWeddingDate || null;
      } else if (editTab === 'email') {
        if (!editEmail.trim() || !editEmail.includes('@')) {
          setEditError('Enter a valid email');
          setEditSaving(false);
          return;
        }
        body.email = editEmail.trim().toLowerCase();
      } else if (editTab === 'password') {
        if (editPassword.length < 8) {
          setEditError('Password must be at least 8 characters');
          setEditSaving(false);
          return;
        }
        if (editPassword !== editConfirmPass) {
          setEditError('Passwords do not match');
          setEditSaving(false);
          return;
        }
        body.password = editPassword;
      }
      const res = await fetch(`/api/admin/couples/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(typeof data.error === 'string' ? data.error : 'Save failed');
        return;
      }
      setEditSavedFlash(
        editTab === 'password' ? 'Password updated' :
        editTab === 'email' ? 'Email updated' : 'Profile updated',
      );
      if (editTab === 'password') { setEditPassword(''); setEditConfirmPass(''); }
      await loadCouples();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }

  async function impersonate(c: AdminCoupleRow) {
    setActionState({ id: c.id, action: 'impersonate' });
    try {
      const res = await fetch(`/api/admin/couples/${c.id}/impersonate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        alert(typeof data.error === 'string' ? data.error : 'Could not generate login link');
        return;
      }
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } finally {
      setActionState(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteWorking(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/admin/couples/${deleting.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(typeof data.error === 'string' ? data.error : 'Delete failed');
        return;
      }
      setDeleting(null);
      setDeleteConfirm('');
      await loadCouples();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleteWorking(false);
    }
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Heart size={20} style={{ color: BRAND }} />
              Couple Accounts
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Manage all wedding-couple accounts. {couples.length} total.
            </p>
          </div>
          <button
            onClick={() => void loadCouples()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, city…"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Couple</th>
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 text-left font-semibold">Phone</th>
                  <th className="px-4 py-3 text-left font-semibold">Wedding</th>
                  <th className="px-4 py-3 text-left font-semibold">Saves</th>
                  <th className="px-4 py-3 text-left font-semibold">Last sign-in</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      <Loader2 className="inline animate-spin" size={18} /> Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-400">
                      {search ? 'No couples match your search.' : 'No couple accounts yet.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-900">{c.display_name || '—'}</div>
                        <div className="text-xs text-gray-400">
                          Joined {fmtDate(c.created_at)}
                          {!c.email_confirmed_at && (
                            <span className="ml-2 text-amber-600 font-medium">Unconfirmed</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-gray-700 break-all">{c.email || '—'}</div>
                        {(c.city || c.state) && (
                          <div className="text-xs text-gray-400">{[c.city, c.state].filter(Boolean).join(', ')}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-700">{c.phone || '—'}</td>
                      <td className="px-4 py-3 align-top text-gray-700">{fmtDate(c.wedding_date)}</td>
                      <td className="px-4 py-3 align-top text-gray-700">{c.saved_venue_count}</td>
                      <td className="px-4 py-3 align-top text-gray-500 text-xs">{fmtRelative(c.last_sign_in_at)}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex justify-end items-center gap-1.5">
                          <button
                            onClick={() => void impersonate(c)}
                            disabled={!!actionState && actionState.id === c.id}
                            title="Login as this couple in a new tab"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                          >
                            {actionState?.id === c.id && actionState.action === 'impersonate' ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <LogIn size={12} />
                            )}
                            Login
                          </button>
                          <button
                            onClick={() => openEdit(c)}
                            title="Edit profile / email / password"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50"
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                          <button
                            onClick={() => { setDeleting(c); setDeleteConfirm(''); setDeleteError(''); }}
                            title="Delete account"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-red-200 text-red-600 rounded-md hover:bg-red-50"
                          >
                            <Trash2 size={12} />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Edit modal ───────────────────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !editSaving && setEditing(null)}>
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => !editSaving && setEditing(null)}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
            >
              <X size={20} />
            </button>
            <h3 className="text-lg font-bold text-gray-900 mb-1">{editing.display_name || 'Couple'}</h3>
            <p className="text-sm text-gray-500 mb-5">{editing.email}</p>

            <div className="flex gap-1 mb-5 border-b border-gray-100">
              {([
                { key: 'profile', label: 'Profile', Icon: Pencil },
                { key: 'email', label: 'Email', Icon: Mail },
                { key: 'password', label: 'Password', Icon: KeyRound },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => { setEditTab(key); setEditError(''); setEditSavedFlash(''); }}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                    editTab === key
                      ? 'border-gray-900 text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {editSavedFlash && (
              <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-sm text-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                {editSavedFlash}
              </div>
            )}
            {editError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">
                {editError}
              </div>
            )}

            {editTab === 'profile' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Display name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className={INPUT} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className={INPUT} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Wedding date</label>
                  <input type="date" value={editWeddingDate} onChange={(e) => setEditWeddingDate(e.target.value)} className={INPUT} />
                </div>
              </div>
            )}

            {editTab === 'email' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">New email address</label>
                  <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className={INPUT} />
                  <p className="mt-1 text-[11px] text-gray-400">
                    The couple will use this email to log in going forward.
                  </p>
                </div>
              </div>
            )}

            {editTab === 'password' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">New password</label>
                  <div className="relative">
                    <input
                      type={showEditPass ? 'text' : 'password'}
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className={`${INPUT} pr-9`}
                    />
                    <button type="button" onClick={() => setShowEditPass((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showEditPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Confirm password</label>
                  <input
                    type={showEditPass ? 'text' : 'password'}
                    value={editConfirmPass}
                    onChange={(e) => setEditConfirmPass(e.target.value)}
                    placeholder="Re-enter"
                    className={INPUT}
                  />
                </div>
                <p className="text-[11px] text-gray-400">
                  The couple will need to use this new password the next time they log in.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              <button
                onClick={() => setEditing(null)}
                disabled={editSaving}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={() => void saveEdit()}
                disabled={editSaving}
                className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-85 disabled:opacity-60 inline-flex items-center gap-1.5"
                style={{ backgroundColor: BRAND }}
              >
                {editSaving && <Loader2 size={14} className="animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ────────────────────────────────────── */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !deleteWorking && setDeleting(null)}>
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => !deleteWorking && setDeleting(null)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Delete couple account?</h3>
                <p className="text-sm text-gray-500 mt-1">
                  This permanently removes <strong>{deleting.email}</strong> and all their saved venues and
                  profile data. The email will be free for re-registration. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Type <span className="font-mono text-gray-900">{deleting.email}</span> to confirm
              </label>
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className={INPUT}
                placeholder={deleting.email ?? ''}
              />
            </div>

            {deleteError && (
              <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setDeleting(null)}
                disabled={deleteWorking}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={deleteWorking || deleteConfirm.trim().toLowerCase() !== (deleting.email ?? '').toLowerCase()}
                className="px-4 py-2 text-sm text-white rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {deleteWorking && <Loader2 size={14} className="animate-spin" />}
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const INPUT =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-colors';
