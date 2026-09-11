'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Heart,
  Check,
  X,
  Send,
  Mail,
  Clock,
  CheckCircle2,
  Inbox,
  Eye,
  Users,
  ChevronDown,
  ChevronRight,
  UtensilsCrossed,
  Armchair,
} from 'lucide-react';

type GuestSummary = {
  total: number;
  attending: number;
  declined: number;
  pending: number;
  headcount: number;
  mealCounts: Record<string, number>;
};

type RequestItem = {
  id: string;
  name: string | null;
  email: string | null;
  message: string | null;
  wedding_date: string | null;
  matched: boolean;
  requested_at: string;
};

type LinkItem = {
  id: string;
  status: 'pending' | 'linked' | 'declined' | 'revoked';
  initiated_by: 'venue' | 'bride';
  name: string | null;
  email: string | null;
  wedding_date: string | null;
  created_at: string;
  linked_at: string | null;
  pending_kind: 'invite_sent' | 'request' | null;
  guests: GuestSummary | null;
};

type Visibility = {
  wedding_date: boolean;
  guest_count: boolean;
  space: boolean;
  coordinator: boolean;
};

type GuestDetailRow = {
  id: string;
  full_name: string;
  party_size: number;
  rsvp_status: 'pending' | 'attending' | 'declined';
  meal_choice: string | null;
  dietary_notes: string | null;
  guest_group: string | null;
};

type TableRow = {
  id: string;
  name: string;
  capacity: number;
  seated: number;
  parties: number;
};

const VISIBILITY_LABELS: { key: keyof Visibility; label: string }[] = [
  { key: 'wedding_date', label: 'Wedding date' },
  { key: 'guest_count', label: 'Guest count' },
  { key: 'space', label: 'Space / room' },
  { key: 'coordinator', label: 'Coordinator' },
];

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const parsed = new Date(d.length <= 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BridePortalPage() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteFlash, setInviteFlash] = useState('');

  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [savingVis, setSavingVis] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [guestDetail, setGuestDetail] = useState<Record<string, GuestDetailRow[]>>({});
  const [tableDetail, setTableDetail] = useState<Record<string, TableRow[]>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/venue/wedding-hub');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'Failed to load');
      setLoading(false);
      return;
    }
    setRequests(Array.isArray(data.requests) ? data.requests : []);
    setLinks(Array.isArray(data.links) ? data.links : []);
    if (data.visibility && typeof data.visibility === 'object') setVisibility(data.visibility as Visibility);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleVisibility(key: keyof Visibility) {
    if (!visibility) return;
    const next = { ...visibility, [key]: !visibility[key] };
    setVisibility(next);
    setSavingVis(true);
    try {
      const res = await fetch('/api/venue/wedding-hub/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.visibility) setVisibility(data.visibility as Visibility);
    } finally {
      setSavingVis(false);
    }
  }

  async function toggleGuests(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!guestDetail[id]) {
      setLoadingDetailId(id);
      try {
        const res = await fetch(`/api/venue/wedding-hub/${id}/guests`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setGuestDetail((prev) => ({ ...prev, [id]: Array.isArray(data.guests) ? data.guests : [] }));
          setTableDetail((prev) => ({ ...prev, [id]: Array.isArray(data.tables) ? data.tables : [] }));
        }
      } finally {
        setLoadingDetailId(null);
      }
    }
  }

  async function decide(id: string, action: 'approve' | 'deny') {
    setActingId(id);
    setError('');
    try {
      const res = await fetch('/api/venue/wedding-hub/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Action failed');
        return;
      }
      await load();
    } finally {
      setActingId(null);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError('');
    setInviteFlash('');
    try {
      const res = await fetch('/api/venue/wedding-hub/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not send invite');
        return;
      }
      setInviteFlash(data.already === 'linked' ? 'That couple is already connected.' : 'Invite sent.');
      setInviteEmail('');
      setInviteName('');
      await load();
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const activeLinks = links.filter((l) => l.status === 'linked');
  const pendingInvites = links.filter((l) => l.pending_kind === 'invite_sent');

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center gap-2">
        <Heart className="h-6 w-6 text-rose-500" />
        <h1 className="text-2xl font-semibold text-gray-900">Wedding Hub</h1>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Connect your booked couples so they can see their wedding details and message you in one place — a single source of
        truth between you and every couple.
      </p>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* What couples can see — venue-controlled visibility */}
      {visibility && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">What your couples can see</h2>
            {savingVis && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-300" />}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Choose which wedding details are shared with your connected couples. Their guest list is always private to them.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {VISIBILITY_LABELS.map(({ key, label }) => {
              const on = visibility[key];
              return (
                <button
                  key={key}
                  type="button"
                  disabled={savingVis}
                  onClick={() => void toggleVisibility(key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                    on
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-gray-200 bg-white text-gray-400'
                  }`}
                >
                  {on ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Pending requests */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Connection requests {requests.length > 0 && <span className="text-rose-500">({requests.length})</span>}
          </h2>
        </div>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No pending requests.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{r.name || r.email || 'A couple'}</p>
                    {r.email && <p className="text-sm text-gray-500">{r.email}</p>}
                    {!r.matched && (
                      <p className="mt-1 text-[11px] font-medium text-amber-600">
                        No matching contact — a new contact will be created on approval.
                      </p>
                    )}
                    {r.message && <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">“{r.message}”</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={actingId === r.id}
                      onClick={() => void decide(r.id, 'approve')}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
                    >
                      {actingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                    </button>
                    <button
                      type="button"
                      disabled={actingId === r.id}
                      onClick={() => void decide(r.id, 'deny')}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                    >
                      <X className="h-4 w-4" /> Deny
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Invite a couple */}
      <section className="mt-10">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Invite a couple</h2>
        </div>
        <form onSubmit={sendInvite} className="mt-3 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Email</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="bride@email.com"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Name (optional)</label>
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Jordan Smith"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-200"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1b1b1b] px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send invite
            </button>
            {inviteFlash && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> {inviteFlash}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            We&apos;ll email them a secure link to connect. They confirm before any wedding details are shared.
          </p>
        </form>
      </section>

      {/* Connected couples */}
      <section className="mt-10">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Connected couples</h2>
        </div>
        {activeLinks.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No connected couples yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
            {activeLinks.map((l) => {
              const g = l.guests;
              const open = expandedId === l.id;
              const rows = guestDetail[l.id];
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => void toggleGuests(l.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900">{l.name || l.email || 'Couple'}</p>
                        {l.email && <p className="truncate text-xs text-gray-500">{l.email}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      {g && g.total > 0 && (
                        <span className="hidden items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 sm:inline-flex">
                          <Users className="h-3 w-3" /> {g.headcount} attending · {g.total} invited
                        </span>
                      )}
                      <span className="hidden text-xs text-gray-400 sm:inline">Wedding {fmtDate(l.wedding_date)}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> Connected
                      </span>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-4">
                      {loadingDetailId === l.id && !rows ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading guest list…
                        </div>
                      ) : !rows || rows.length === 0 ? (
                        <p className="text-sm text-gray-400">The couple hasn&apos;t added any guests yet.</p>
                      ) : (
                        <>
                          {/* RSVP + headcount summary */}
                          <div className="flex flex-wrap gap-2">
                            <Stat label="Attending" value={g?.attending ?? 0} tone="emerald" />
                            <Stat label="Declined" value={g?.declined ?? 0} tone="gray" />
                            <Stat label="Awaiting" value={g?.pending ?? 0} tone="amber" />
                            <Stat label="Headcount" value={g?.headcount ?? 0} tone="rose" />
                          </div>

                          {/* Meal tallies */}
                          {g && Object.keys(g.mealCounts).length > 0 && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                              <UtensilsCrossed className="h-3.5 w-3.5 text-gray-400" />
                              {Object.entries(g.mealCounts).map(([meal, count]) => (
                                <span key={meal} className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
                                  {meal}: <strong>{count}</strong>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Seating layout (aggregate only — day-of room setup) */}
                          {tableDetail[l.id] && tableDetail[l.id].length > 0 && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                              <Armchair className="h-3.5 w-3.5 text-gray-400" />
                              {tableDetail[l.id].map((t) => (
                                <span
                                  key={t.id}
                                  className={`rounded-full border px-2 py-0.5 ${
                                    t.seated > t.capacity ? 'border-red-200 bg-red-50 text-red-600' : 'border-gray-200 bg-white'
                                  }`}
                                >
                                  {t.name}: <strong>{t.seated}</strong>/{t.capacity}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Planning list (no contact PII — bride-owned) */}
                          <div className="mt-3 overflow-hidden rounded-xl border border-gray-200 bg-white">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-400">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Guest</th>
                                  <th className="px-3 py-2 font-semibold">Party</th>
                                  <th className="px-3 py-2 font-semibold">RSVP</th>
                                  <th className="px-3 py-2 font-semibold">Meal</th>
                                  <th className="px-3 py-2 font-semibold">Dietary</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {rows.map((r) => (
                                  <tr key={r.id}>
                                    <td className="px-3 py-2">
                                      <span className="font-medium text-gray-900">{r.full_name}</span>
                                      {r.guest_group && <span className="ml-1 text-xs text-gray-400">· {r.guest_group}</span>}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600">{r.party_size}</td>
                                    <td className="px-3 py-2"><RsvpBadge status={r.rsvp_status} /></td>
                                    <td className="px-3 py-2 text-gray-600">{r.meal_choice || '—'}</td>
                                    <td className="px-3 py-2 text-gray-600">{r.dietary_notes || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <p className="mt-2 text-[11px] text-gray-400">
                            The couple owns and manages this list. Guest contact details stay private to them.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Outstanding invites */}
      {pendingInvites.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Invites awaiting acceptance</h2>
          </div>
          <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
            {pendingInvites.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{l.name || l.email || 'Couple'}</p>
                  {l.email && <p className="truncate text-xs text-gray-500">{l.email}</p>}
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                  <Clock className="h-3 w-3" /> Invite sent
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'gray' | 'rose' }) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    gray: 'border-gray-200 bg-white text-gray-600',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
  };
  return (
    <div className={`rounded-xl border px-3 py-2 ${tones[tone]}`}>
      <p className="text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}

function RsvpBadge({ status }: { status: 'pending' | 'attending' | 'declined' }) {
  const map = {
    attending: 'bg-emerald-50 text-emerald-700',
    declined: 'bg-gray-100 text-gray-500',
    pending: 'bg-amber-50 text-amber-700',
  } as const;
  const label = status === 'attending' ? 'Attending' : status === 'declined' ? 'Declined' : 'Awaiting';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${map[status]}`}>{label}</span>;
}
