'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';

const BRAND = '#1b1b1b';

// ── Types mirror /src/lib/admin-contacts.ts ──────────────────────────────────

type ContactType =
  | 'venue_owner'
  | 'couple'
  | 'venue_team'
  | 'admin_team'
  | 'lead'
  | 'waitlist';

const CONTACT_TYPES: ContactType[] = [
  'venue_owner', 'couple', 'venue_team', 'admin_team', 'lead', 'waitlist',
];

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  venue_owner: 'Venue owner',
  couple:      'Couple',
  venue_team:  'Venue team',
  admin_team:  'Admin team',
  lead:        'Lead',
  waitlist:    'Waitlist',
};

const CONTACT_TYPE_SHORT: Record<ContactType, string> = {
  venue_owner: 'Owner',
  couple:      'Couple',
  venue_team:  'Team',
  admin_team:  'Admin',
  lead:        'Lead',
  waitlist:    'Waitlist',
};

const CONTACT_TYPE_PILL: Record<ContactType, string> = {
  venue_owner: 'bg-violet-100 text-violet-700 border border-violet-200',
  couple:      'bg-rose-100 text-rose-700 border border-rose-200',
  venue_team:  'bg-amber-100 text-amber-700 border border-amber-200',
  admin_team:  'bg-gray-200 text-gray-800 border border-gray-300',
  lead:        'bg-sky-100 text-sky-700 border border-sky-200',
  waitlist:    'bg-emerald-100 text-emerald-700 border border-emerald-200',
};

interface AdminContact {
  type: ContactType;
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  role: string | null;
  status: string | null;
  blocked: boolean;
  blocked_until: string | null;
  created_at: string | null;
  last_active_at: string | null;
  venue_id: string | null;
  venue_name: string | null;
  can_impersonate: boolean;
  can_reset_password: boolean;
}

interface ContactsResponse {
  contacts: AdminContact[];
  errors: { type: ContactType; message: string }[];
  total: number;
}

function fullName(c: AdminContact): string {
  const f = (c.first_name ?? '').trim();
  const l = (c.last_name ?? '').trim();
  const combined = `${f} ${l}`.trim();
  return combined || (c.display_name ?? '').trim();
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return s; }
}

function fmtRelative(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
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

const INPUT_CLS =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300 transition-colors';
const LABEL_CLS = 'block text-xs font-medium text-gray-600 mb-1';

// ─────────────────────────────────────────────────────────────────────────────

export function ContactsPortal() {
  const [contacts, setContacts] = useState<AdminContact[]>([]);
  const [errors, setErrors] = useState<{ type: ContactType; message: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [reqError, setReqError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<ContactType>>(new Set(CONTACT_TYPES));
  const [onlyBlocked, setOnlyBlocked] = useState(false);

  const [editing, setEditing] = useState<AdminContact | null>(null);
  const [blocking, setBlocking] = useState<AdminContact | null>(null);
  const [resetting, setResetting] = useState<AdminContact | null>(null);
  const [deleting, setDeleting] = useState<AdminContact | null>(null);
  const [actionState, setActionState] = useState<{ id: string; action: string } | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setReqError('');
    try {
      const res = await fetch('/api/admin/contacts', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReqError(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as ContactsResponse;
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      setErrors(data.errors ?? []);
    } catch (e) {
      setReqError(e instanceof Error ? e.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadContacts(); }, [loadContacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!typeFilter.has(c.type)) return false;
      if (onlyBlocked && !c.blocked) return false;
      if (!q) return true;
      const hay = [
        c.first_name, c.last_name, c.display_name, c.email, c.phone,
        c.city, c.state, c.role, c.status, c.venue_name, CONTACT_TYPE_LABELS[c.type],
      ].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [contacts, search, typeFilter, onlyBlocked]);

  const countsByType = useMemo(() => {
    const m = new Map<ContactType, number>();
    for (const c of contacts) m.set(c.type, (m.get(c.type) ?? 0) + 1);
    return m;
  }, [contacts]);

  const blockedCount = useMemo(() => contacts.filter((c) => c.blocked).length, [contacts]);

  function toggleType(t: ContactType) {
    setTypeFilter((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      if (next.size === 0) return new Set(CONTACT_TYPES);
      return next;
    });
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (typeFilter.size > 0 && typeFilter.size < CONTACT_TYPES.length) {
      params.set('type', Array.from(typeFilter).join(','));
    }
    if (search.trim()) params.set('search', search.trim());
    if (onlyBlocked) params.set('blocked', 'true');
    const qs = params.toString();
    window.location.href = '/api/admin/contacts/export' + (qs ? `?${qs}` : '');
  }

  async function impersonate(c: AdminContact) {
    if (!c.can_impersonate) return;
    setActionState({ id: c.id, action: 'impersonate' });
    try {
      const res = await fetch(`/api/admin/contacts/${c.type}/${c.id}/impersonate`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(typeof data.error === 'string' ? data.error : 'Could not start session.');
        return;
      }
      if (data.mode === 'link' && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else if (data.mode === 'cookie') {
        window.location.href = '/dashboard';
      }
    } finally {
      setActionState(null);
    }
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Users size={20} style={{ color: BRAND }} />
              Contacts
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Every person on the platform — venue owners, couples, team members, admin staff,
              leads, and waitlist signups. {contacts.length} total
              {blockedCount > 0 && (
                <> · <span className="text-red-600 font-medium">{blockedCount} blocked</span></>
              )}.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Download size={14} />
              Export CSV
            </button>
            <button
              onClick={() => void loadContacts()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Type filter pills */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold mr-1">Type:</span>
          {CONTACT_TYPES.map((t) => {
            const active = typeFilter.has(t);
            const count = countsByType.get(t) ?? 0;
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? CONTACT_TYPE_PILL[t]
                    : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                <span>{CONTACT_TYPE_LABELS[t]}</span>
                <span className={`tabular-nums ${active ? 'opacity-70' : 'text-gray-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
          <label className="inline-flex items-center gap-1.5 ml-3 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyBlocked}
              onChange={(e) => setOnlyBlocked(e.target.checked)}
              className="rounded border-gray-300 text-gray-900 focus:ring-gray-400"
            />
            Only blocked
          </label>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, city, role, venue…"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-300"
          />
        </div>

        {reqError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {reqError}
          </div>
        )}
        {errors.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Some contact sources failed to load:
            <ul className="mt-1 ml-4 list-disc">
              {errors.map((e) => (
                <li key={e.type}>
                  <strong>{CONTACT_TYPE_LABELS[e.type]}</strong>: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Contact</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 text-left font-semibold">Phone</th>
                  <th className="px-4 py-3 text-left font-semibold">Venue / Role</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Joined</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400">
                      <Loader2 className="inline animate-spin" size={18} /> Loading contacts…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400">
                      No contacts match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => {
                    const name = fullName(c) || '—';
                    return (
                      <tr
                        key={`${c.type}:${c.id}`}
                        className={`hover:bg-gray-50/60 transition-colors ${c.blocked ? 'bg-red-50/40' : ''}`}
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-gray-900">{name}</div>
                          {(c.city || c.state) && (
                            <div className="text-xs text-gray-400">
                              {[c.city, c.state].filter(Boolean).join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold leading-snug ${CONTACT_TYPE_PILL[c.type]}`}
                            title={CONTACT_TYPE_LABELS[c.type]}
                          >
                            {CONTACT_TYPE_SHORT[c.type]}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-gray-700 break-all">{c.email || '—'}</td>
                        <td className="px-4 py-3 align-top text-gray-700">{c.phone || '—'}</td>
                        <td className="px-4 py-3 align-top">
                          {c.venue_name && (
                            <div className="text-gray-700 text-sm">{c.venue_name}</div>
                          )}
                          {c.role && (
                            <div className="text-xs text-gray-400">{c.role}</div>
                          )}
                          {!c.venue_name && !c.role && '—'}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {c.blocked ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              <Ban size={11} /> Blocked
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500 capitalize">{c.status ?? 'active'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-gray-500 text-xs">
                          <div>{fmtDate(c.created_at)}</div>
                          {c.last_active_at && (
                            <div className="text-[11px] text-gray-400">Active {fmtRelative(c.last_active_at)}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex justify-end items-center gap-1.5 flex-wrap">
                            {c.can_impersonate && (
                              <button
                                onClick={() => void impersonate(c)}
                                disabled={
                                  (actionState?.id === c.id && actionState.action === 'impersonate')
                                  || c.blocked
                                }
                                title={c.blocked ? 'Unblock first to log in as them' : 'Log in as this contact'}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                              >
                                {actionState?.id === c.id && actionState.action === 'impersonate' ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <LogIn size={12} />
                                )}
                                Login
                              </button>
                            )}
                            <button
                              onClick={() => setEditing(c)}
                              title="Edit profile"
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50"
                            >
                              <Pencil size={12} /> Edit
                            </button>
                            {(c.type === 'venue_owner' || c.type === 'couple' || c.type === 'venue_team' || c.type === 'admin_team') && (
                              <button
                                onClick={() => setBlocking(c)}
                                title={c.blocked ? 'Unblock' : 'Temporary or permanent block'}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-xs border rounded-md hover:bg-gray-50 ${
                                  c.blocked ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'
                                }`}
                              >
                                {c.blocked ? <ShieldCheck size={12} /> : <Ban size={12} />}
                                {c.blocked ? 'Unblock' : 'Block'}
                              </button>
                            )}
                            {c.can_reset_password && (
                              <button
                                onClick={() => setResetting(c)}
                                title="Reset password / send login link"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50"
                              >
                                <KeyRound size={12} /> Reset
                              </button>
                            )}
                            <button
                              onClick={() => setDeleting(c)}
                              title="Delete contact permanently"
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-red-200 text-red-600 rounded-md hover:bg-red-50"
                            >
                              <Trash2 size={12} /> Delete
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

      {/* ── Edit modal ──────────────────────────────────────────────────── */}
      {editing && (
        <ContactEditModal
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void loadContacts(); }}
        />
      )}

      {/* ── Block modal ─────────────────────────────────────────────────── */}
      {blocking && (
        <BlockModal
          contact={blocking}
          onClose={() => setBlocking(null)}
          onDone={() => { setBlocking(null); void loadContacts(); }}
        />
      )}

      {/* ── Reset password modal ────────────────────────────────────────── */}
      {resetting && (
        <ResetPasswordModal
          contact={resetting}
          onClose={() => setResetting(null)}
        />
      )}

      {/* ── Delete confirmation ─────────────────────────────────────────── */}
      {deleting && (
        <DeleteModal
          contact={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); void loadContacts(); }}
        />
      )}
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface FullProfile extends Partial<Record<string, unknown>> {
  id?: string;
}

function ContactEditModal({
  contact, onClose, onSaved,
}: { contact: AdminContact; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<'profile' | 'email' | 'password' | 'notes'>('profile');
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [flash, setFlash] = useState('');

  // Editable state — generic bag covering every contact type's fields
  const [form, setForm] = useState<Record<string, string>>({});
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    setLoading(true);
    setErrorMsg('');
    setFlash('');
    fetch(`/api/admin/contacts/${contact.type}/${contact.id}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        const c = (data?.contact ?? {}) as FullProfile;
        setProfile(c);
        hydrateForm(c, contact);
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : 'Failed to load');
        hydrateForm({}, contact);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, contact.type]);

  function hydrateForm(c: FullProfile, base: AdminContact) {
    const sl = (c.social_links ?? {}) as Record<string, unknown>;
    setForm({
      first_name:   String(c.first_name      ?? c.owner_first_name ?? base.first_name   ?? '' ),
      last_name:    String(c.last_name       ?? c.owner_last_name  ?? base.last_name    ?? '' ),
      display_name: String(c.display_name    ?? c.name             ?? base.display_name ?? '' ),
      name:         String(c.name            ?? base.display_name  ?? ''),
      phone:        String(c.phone           ?? c.notification_phone ?? base.phone      ?? '' ),
      address_line1:String(c.address_line1   ?? ''),
      address_line2:String(c.address_line2   ?? ''),
      city:         String(c.city            ?? c.location_city    ?? base.city        ?? '' ),
      state:        String(c.state           ?? c.location_state   ?? base.state       ?? '' ),
      postal_code:  String(c.postal_code     ?? ''),
      country:      String(c.country         ?? 'US'),
      instagram_url:String(c.instagram_url   ?? sl.instagram       ?? ''),
      facebook_url: String(c.facebook_url    ?? sl.facebook        ?? ''),
      tiktok_url:   String(c.tiktok_url      ?? sl.tiktok          ?? ''),
      pinterest_url:String(c.pinterest_url   ?? sl.pinterest       ?? ''),
      website_url:  String(sl.website        ?? ''),
      wedding_date: String(c.wedding_date    ?? ''),
      role:         String(c.role            ?? base.role          ?? ''),
      status:       String(c.status          ?? base.status        ?? ''),
      admin_notes:  String(c.admin_notes     ?? ''),
      venue_name:   String(c.venue_name      ?? base.venue_name    ?? ''),
      notes:        String(c.notes           ?? ''),
    });
    setNewEmail(String(c.email ?? base.email ?? ''));
    setNewPassword('');
    setConfirmPassword('');
  }

  function update(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setErrorMsg('');
    setFlash('');
    try {
      const body: Record<string, unknown> = {};
      if (tab === 'profile') {
        for (const k of [
          'first_name','last_name','display_name','name','phone',
          'address_line1','address_line2','city','state','postal_code','country',
          'wedding_date','role','status','venue_name','notes',
        ]) {
          if (form[k] !== undefined) body[k] = form[k];
        }
        // Social links
        if (contact.type === 'venue_owner') {
          body.instagram = form.instagram_url;
          body.facebook  = form.facebook_url;
          body.tiktok    = form.tiktok_url;
          body.pinterest = form.pinterest_url;
          body.website   = form.website_url;
        } else if (contact.type === 'couple') {
          body.instagram_url = form.instagram_url;
          body.facebook_url  = form.facebook_url;
          body.tiktok_url    = form.tiktok_url;
          body.pinterest_url = form.pinterest_url;
        }
      } else if (tab === 'email') {
        if (!newEmail.trim() || !newEmail.includes('@')) {
          setErrorMsg('Enter a valid email');
          setSaving(false);
          return;
        }
        body.email = newEmail.trim();
      } else if (tab === 'password') {
        if (newPassword.length < 8) { setErrorMsg('Password must be at least 8 characters'); setSaving(false); return; }
        if (newPassword !== confirmPassword) { setErrorMsg('Passwords do not match'); setSaving(false); return; }
        body.password = newPassword;
      } else if (tab === 'notes') {
        body.admin_notes = form.admin_notes;
      }

      const res = await fetch(`/api/admin/contacts/${contact.type}/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(typeof data.error === 'string' ? data.error : 'Save failed');
        return;
      }
      setFlash(
        tab === 'password' ? 'Password updated' :
        tab === 'email' ? 'Email updated' :
        tab === 'notes' ? 'Notes saved' : 'Profile updated',
      );
      if (tab === 'password') { setNewPassword(''); setConfirmPassword(''); }
      // Trigger parent refetch
      setTimeout(onSaved, 600);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const isAuthBacked = contact.type === 'couple';
  const hasEmail = contact.type === 'couple' || contact.type === 'venue_owner' || contact.type === 'venue_team' || contact.type === 'admin_team';
  const hasPassword = contact.type === 'couple' || contact.type === 'admin_team' || contact.type === 'venue_owner';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-white p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => !saving && onClose()}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-1">
          <h3 className="text-lg font-bold text-gray-900">{fullName(contact) || 'Contact'}</h3>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold leading-snug ${CONTACT_TYPE_PILL[contact.type]}`}
          >
            {CONTACT_TYPE_LABELS[contact.type]}
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-5">{contact.email || '—'}{contact.venue_name ? ` · ${contact.venue_name}` : ''}</p>

        <div className="flex gap-1 mb-5 border-b border-gray-100 flex-wrap">
          {(['profile', hasEmail ? 'email' : null, hasPassword ? 'password' : null, 'notes'].filter(Boolean) as ('profile'|'email'|'password'|'notes')[]).map((key) => {
            const Icon =
              key === 'profile' ? Pencil :
              key === 'email' ? Mail :
              key === 'password' ? KeyRound : ShieldCheck;
            const label =
              key === 'profile' ? 'Profile' :
              key === 'email' ? 'Email' :
              key === 'password' ? 'Password' : 'Admin notes';
            return (
              <button
                key={key}
                onClick={() => { setTab(key); setErrorMsg(''); setFlash(''); }}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === key
                    ? 'border-gray-900 text-gray-900'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>

        {flash && (
          <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-sm text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={14} />
            {flash}
          </div>
        )}
        {errorMsg && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {tab === 'profile' && (
          <div className="space-y-4">
            {loading && (
              <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" /> Loading full profile…
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>First name</label>
                <input value={form.first_name ?? ''} onChange={(e) => update('first_name', e.target.value)} className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>Last name</label>
                <input value={form.last_name ?? ''} onChange={(e) => update('last_name', e.target.value)} className={INPUT_CLS} />
              </div>
            </div>

            {contact.type === 'venue_owner' && (
              <div>
                <label className={LABEL_CLS}>Venue name</label>
                <input value={form.display_name ?? ''} onChange={(e) => update('display_name', e.target.value)} className={INPUT_CLS} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>Phone</label>
                <input value={form.phone ?? ''} onChange={(e) => update('phone', e.target.value)} className={INPUT_CLS} />
              </div>
              {contact.type === 'couple' && (
                <div>
                  <label className={LABEL_CLS}>Wedding date</label>
                  <input type="date" value={form.wedding_date ?? ''} onChange={(e) => update('wedding_date', e.target.value)} className={INPUT_CLS} />
                </div>
              )}
              {contact.type !== 'couple' && (
                <div>
                  <label className={LABEL_CLS}>Role / Title</label>
                  <input value={form.role ?? ''} onChange={(e) => update('role', e.target.value)} className={INPUT_CLS} />
                </div>
              )}
            </div>

            {(contact.type === 'venue_owner' || contact.type === 'couple') && (
              <>
                <div className="pt-1">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-2">Address</p>
                  <div className="space-y-3">
                    <input placeholder="Address line 1" value={form.address_line1 ?? ''} onChange={(e) => update('address_line1', e.target.value)} className={INPUT_CLS} />
                    <input placeholder="Address line 2" value={form.address_line2 ?? ''} onChange={(e) => update('address_line2', e.target.value)} className={INPUT_CLS} />
                    <div className="grid grid-cols-2 gap-3">
                      <input placeholder="City" value={form.city ?? ''} onChange={(e) => update('city', e.target.value)} className={INPUT_CLS} />
                      <input placeholder="State" value={form.state ?? ''} onChange={(e) => update('state', e.target.value)} className={INPUT_CLS} />
                      <input placeholder="Postal code" value={form.postal_code ?? ''} onChange={(e) => update('postal_code', e.target.value)} className={INPUT_CLS} />
                      <input placeholder="Country" value={form.country ?? ''} onChange={(e) => update('country', e.target.value)} className={INPUT_CLS} />
                    </div>
                  </div>
                </div>

                <div className="pt-1">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 mb-2">Social (https://)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <input type="url" placeholder="Instagram" value={form.instagram_url ?? ''} onChange={(e) => update('instagram_url', e.target.value)} className={INPUT_CLS} />
                    <input type="url" placeholder="Facebook"  value={form.facebook_url ?? ''}  onChange={(e) => update('facebook_url', e.target.value)}  className={INPUT_CLS} />
                    <input type="url" placeholder="TikTok"    value={form.tiktok_url ?? ''}    onChange={(e) => update('tiktok_url', e.target.value)}    className={INPUT_CLS} />
                    <input type="url" placeholder="Pinterest" value={form.pinterest_url ?? ''} onChange={(e) => update('pinterest_url', e.target.value)} className={INPUT_CLS} />
                    {contact.type === 'venue_owner' && (
                      <input type="url" placeholder="Website" value={form.website_url ?? ''} onChange={(e) => update('website_url', e.target.value)} className={`${INPUT_CLS} col-span-2`} />
                    )}
                  </div>
                </div>
              </>
            )}

            {contact.type === 'venue_team' && (
              <div>
                <label className={LABEL_CLS}>Member status</label>
                <select value={form.status ?? ''} onChange={(e) => update('status', e.target.value)} className={INPUT_CLS}>
                  <option value="active">Active</option>
                  <option value="invited">Invited</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
            )}
            {contact.type === 'lead' && (
              <div>
                <label className={LABEL_CLS}>Lead notes</label>
                <textarea value={form.notes ?? ''} onChange={(e) => update('notes', e.target.value)} rows={4} className={INPUT_CLS} />
              </div>
            )}
          </div>
        )}

        {tab === 'email' && hasEmail && (
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS}>New email address</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={INPUT_CLS} />
              <p className="mt-1 text-[11px] text-gray-400">
                {isAuthBacked
                  ? 'The contact will use this email for sign-in going forward.'
                  : 'This updates the contact email on file.'}
              </p>
            </div>
          </div>
        )}

        {tab === 'password' && hasPassword && (
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS}>New password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className={`${INPUT_CLS} pr-9`}
                />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className={LABEL_CLS}>Confirm password</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter"
                className={INPUT_CLS}
              />
            </div>
            <p className="text-[11px] text-gray-400">
              The contact will need to use this new password the next time they sign in.
            </p>
          </div>
        )}

        {tab === 'notes' && (
          <div>
            <label className={LABEL_CLS}>Admin-only notes</label>
            <textarea
              value={form.admin_notes ?? ''}
              onChange={(e) => update('admin_notes', e.target.value)}
              rows={6}
              placeholder="VIP, refunded on X, prone to fraud, etc. Only visible to the StoryVenue super-admin team."
              className={INPUT_CLS}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Close
          </button>
          {(tab === 'profile' || tab === 'email' || tab === 'password' || tab === 'notes') && (
            <button
              onClick={() => void save()}
              disabled={saving}
              className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-85 disabled:opacity-60 inline-flex items-center gap-1.5"
              style={{ backgroundColor: BRAND }}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save
            </button>
          )}
        </div>
        {profile === null && !loading && (
          <p className="mt-3 text-[11px] text-amber-700">Profile could not be fully loaded — saving will still work.</p>
        )}
      </div>
    </div>
  );
}

function BlockModal({
  contact, onClose, onDone,
}: { contact: AdminContact; onClose: () => void; onDone: () => void }) {
  const isUnblocking = contact.blocked;
  const [duration, setDuration] = useState<string>('permanent');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  async function submit() {
    setWorking(true);
    setErrorMsg('');
    try {
      const body = isUnblocking
        ? { action: 'unblock' }
        : { action: 'block', duration, reason };
      const res = await fetch(`/api/admin/contacts/${contact.type}/${contact.id}/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(typeof data.error === 'string' ? data.error : 'Action failed');
        return;
      }
      onDone();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !working && onClose()}>
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => !working && onClose()} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isUnblocking ? 'bg-emerald-100' : 'bg-amber-100'}`}>
            {isUnblocking ? <ShieldCheck size={18} className="text-emerald-700" /> : <Ban size={18} className="text-amber-700" />}
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {isUnblocking ? 'Unblock contact?' : 'Block contact'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {isUnblocking
                ? <>This restores normal access for <strong>{fullName(contact) || contact.email}</strong>.</>
                : <>This blocks <strong>{fullName(contact) || contact.email}</strong> from signing in. They&rsquo;ll see a generic &ldquo;account suspended&rdquo; message.</>}
            </p>
          </div>
        </div>

        {!isUnblocking && (
          <div className="space-y-3 mt-4">
            <div>
              <label className={LABEL_CLS}>Block duration</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value)} className={INPUT_CLS}>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="permanent">Permanent</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Reason (internal notes)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. abuse, chargebacks, security incident"
                className={INPUT_CLS}
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={working}
            className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5 ${
              isUnblocking ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {working && <Loader2 size={14} className="animate-spin" />}
            {isUnblocking ? 'Unblock' : 'Block contact'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({
  contact, onClose,
}: { contact: AdminContact; onClose: () => void }) {
  const [mode, setMode] = useState<'email' | 'set'>('email');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [done, setDone] = useState('');

  async function submit() {
    setWorking(true);
    setErrorMsg('');
    setDone('');
    try {
      if (mode === 'set') {
        if (pw.length < 8) { setErrorMsg('Password must be at least 8 characters'); setWorking(false); return; }
        if (pw !== confirm) { setErrorMsg('Passwords do not match'); setWorking(false); return; }
      }
      const res = await fetch(`/api/admin/contacts/${contact.type}/${contact.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'set' ? { mode, newPassword: pw } : { mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(typeof data.error === 'string' ? data.error : 'Reset failed');
        return;
      }
      setDone(
        mode === 'email'
          ? data.sentTo ? `Recovery email sent to ${data.sentTo}.` : 'Recovery link generated.'
          : 'Password set.',
      );
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !working && onClose()}>
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => !working && onClose()} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
            <KeyRound size={18} className="text-gray-700" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Reset password</h3>
            <p className="text-sm text-gray-500 mt-1">
              {contact.type === 'venue_owner'
                ? <>Rotate the magic login token for <strong>{contact.display_name || contact.email}</strong>.</>
                : <>Reset the password for <strong>{fullName(contact) || contact.email}</strong>.</>}
            </p>
          </div>
        </div>

        <div className="flex gap-1 mb-4 border-b border-gray-100">
          {(['email','set'] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setMode(k); setErrorMsg(''); setDone(''); }}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                mode === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {k === 'email' ? <><Send size={13} /> Email link</> : <><KeyRound size={13} /> Set password</>}
            </button>
          ))}
        </div>

        {mode === 'set' && (
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS}>New password</label>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className={INPUT_CLS} placeholder="At least 8 characters" />
            </div>
            <div>
              <label className={LABEL_CLS}>Confirm</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={INPUT_CLS} />
            </div>
          </div>
        )}
        {mode === 'email' && (
          <p className="text-sm text-gray-600">
            We&rsquo;ll generate a one-time secure link and email it to{' '}
            <strong>{contact.email || 'their email on file'}</strong>.
            {contact.type === 'admin_team' && ' We will reset their password and email them the new one.'}
          </p>
        )}

        {errorMsg && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        {done && (
          <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-sm text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {done}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Close
          </button>
          <button
            onClick={() => void submit()}
            disabled={working || !!done}
            className="px-4 py-2 text-sm text-white rounded-lg hover:opacity-85 disabled:opacity-60 inline-flex items-center gap-1.5"
            style={{ backgroundColor: BRAND }}
          >
            {working && <Loader2 size={14} className="animate-spin" />}
            {mode === 'email' ? 'Send link' : 'Set password'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({
  contact, onClose, onDeleted,
}: { contact: AdminContact; onClose: () => void; onDeleted: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const needToType = (contact.email || fullName(contact) || contact.id);

  async function submit() {
    setWorking(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/admin/contacts/${contact.type}/${contact.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(typeof data.error === 'string' ? data.error : 'Delete failed');
        return;
      }
      onDeleted();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !working && onClose()}>
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => !working && onClose()} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Delete contact?</h3>
            <p className="text-sm text-gray-500 mt-1">
              This permanently removes <strong>{fullName(contact) || contact.email || contact.id}</strong>
              {' '}({CONTACT_TYPE_LABELS[contact.type]}). For accounts with logins, the email is freed for re-registration. This cannot be undone.
            </p>
          </div>
        </div>

        <div className="mt-3">
          <label className={LABEL_CLS}>
            Type <span className="font-mono text-gray-900">{needToType}</span> to confirm
          </label>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className={INPUT_CLS}
            placeholder={needToType ?? ''}
          />
        </div>

        {errorMsg && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} disabled={working} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={working || confirmText.trim().toLowerCase() !== String(needToType ?? '').toLowerCase()}
            className="px-4 py-2 text-sm text-white rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {working && <Loader2 size={14} className="animate-spin" />}
            Delete contact
          </button>
        </div>
      </div>
    </div>
  );
}
