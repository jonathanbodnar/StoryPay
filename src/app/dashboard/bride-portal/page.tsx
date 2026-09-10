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
} from 'lucide-react';

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
};

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

  const load = useCallback(async () => {
    const res = await fetch('/api/venue/bride-portal');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'Failed to load');
      setLoading(false);
      return;
    }
    setRequests(Array.isArray(data.requests) ? data.requests : []);
    setLinks(Array.isArray(data.links) ? data.links : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: 'approve' | 'deny') {
    setActingId(id);
    setError('');
    try {
      const res = await fetch('/api/venue/bride-portal/decide', {
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
      const res = await fetch('/api/venue/bride-portal/invite', {
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
        <h1 className="text-2xl font-semibold text-gray-900">Bride Portal</h1>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Connect your booked couples so they can see their wedding details and message you in one place — a single source of
        truth between you and every bride.
      </p>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
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
            {activeLinks.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{l.name || l.email || 'Couple'}</p>
                  {l.email && <p className="truncate text-xs text-gray-500">{l.email}</p>}
                </div>
                <div className="flex items-center gap-4 text-right">
                  <span className="text-xs text-gray-400">Wedding {fmtDate(l.wedding_date)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                </div>
              </li>
            ))}
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
