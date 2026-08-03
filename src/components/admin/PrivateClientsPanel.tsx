'use client';

/**
 * Support Inbox → Private Clients.
 *
 * A watch list of white-glove venues (tagged `is_private_client` from the
 * Venue Management card) with their primary owner and active team members,
 * so the concierge team can reach any of them by email or SMS without ever
 * leaving the Support Inbox.
 *
 * SMS is owner-only: it rides the venue's own GHL/A2P connection and only
 * the owner's phone (venues.notification_phone) is on file today —
 * venue_team_members has no phone column yet.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, Search, RefreshCw, Loader2, AlertCircle, Mail, MessageSquare,
  Send, ChevronDown, ChevronRight, Users, Crown, CheckCircle2, ShieldAlert, Eye,
} from 'lucide-react';

interface SupportMe {
  authed: boolean;
  superAdmin: boolean;
  member: { id: string; email: string; name: string; role: 'support_agent' | 'support_admin' } | null;
}

interface OwnerInfo {
  name: string | null;
  email: string | null;
  phone: string | null;
  smsAvailable: boolean;
}

interface TeamMemberInfo {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  status: string | null;
}

interface PrivateClientVenue {
  id: string;
  name: string;
  slug: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
  ghlConnected: boolean;
  owner: OwnerInfo;
  teamMembers: TeamMemberInfo[];
}

interface HistoryMessage {
  id: string;
  recipient_type: string;
  recipient_label: string;
  channel: string;
  body: string;
  external_sent: boolean;
  send_error: string | null;
  sentByName: string;
  created_at: string;
}

function relativeTime(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    if (!Number.isFinite(d)) return '';
    const diff = Date.now() - d;
    const min = Math.round(diff / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return ''; }
}

function initials(name: string): string {
  return (name.match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase() || '?';
}

export function PrivateClientsPanel({
  me,
  actAsId,
}: {
  me: SupportMe | null;
  actAsId: string;
}) {
  const [venues, setVenues] = useState<PrivateClientVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch('/api/admin/support/private-clients', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
      const list = (d.venues ?? []) as PrivateClientVenue[];
      setVenues(list);
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter((v) =>
      v.name.toLowerCase().includes(q) ||
      (v.owner.name ?? '').toLowerCase().includes(q) ||
      (v.owner.email ?? '').toLowerCase().includes(q) ||
      v.teamMembers.some((m) => m.name.toLowerCase().includes(q) || (m.email ?? '').toLowerCase().includes(q)),
    );
  }, [venues, search]);

  const selected = venues.find((v) => v.id === selectedId) ?? null;

  const supportUserId = me?.superAdmin ? (actAsId || me?.member?.id) : undefined;

  return (
    <div className="flex-1 min-h-[500px] lg:min-h-0 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-w-0 overflow-hidden">
      {/* Venue list */}
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 overflow-hidden">
        <div className="p-3 border-b border-gray-200 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-sm text-gray-900 inline-flex items-center gap-1.5">
              <ShieldAlert size={14} className="text-amber-600" />
              Private Clients
            </h3>
            <button
              type="button"
              onClick={load}
              className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-gray-500 hover:bg-gray-50"
              title="Refresh"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search venue, owner, team…"
              className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle size={12} /> {error}
            </div>
          )}
          {loading && venues.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-8 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 px-4">
              <ShieldAlert size={26} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-semibold text-gray-700">No private clients yet</p>
              <p className="text-xs text-gray-500 mt-1">
                Check &quot;Private Client&quot; on a venue&apos;s card in Venue Management to add it here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 hover:bg-gray-50 ${selectedId === v.id ? 'bg-amber-50' : ''}`}
                >
                  <div className="mt-0.5 w-8 h-8 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-semibold">
                    {initials(v.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{v.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">
                      {v.planName || 'No plan'}
                      {v.teamMembers.length > 0 && <> · {v.teamMembers.length} team member{v.teamMembers.length === 1 ? '' : 's'}</>}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail: owner + team + quick contact */}
      <div className="rounded-2xl border border-gray-200 bg-white flex flex-col min-h-0 min-w-0 overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Select a private client to see contacts.
          </div>
        ) : (
          <VenueDetail key={selected.id} venue={selected} supportUserId={supportUserId} />
        )}
      </div>
    </div>
  );
}

function VenueDetail({ venue, supportUserId }: { venue: PrivateClientVenue; supportUserId?: string }) {
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Open by default per venue; once the user collapses it, it stays
  // collapsed until they click it open again (no auto re-expand on refresh).
  const [historyOpen, setHistoryOpen] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/admin/support/private-clients/${venue.id}/messages`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setHistory((d.messages ?? []) as HistoryMessage[]);
    } catch {
      // best-effort
    } finally {
      setHistoryLoading(false);
    }
  }, [venue.id]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const contacts: Array<{ key: string; label: string; role: string; email: string | null; phone: string | null; smsAvailable: boolean; recipientType: 'owner' | 'team_member'; teamMemberId?: string }> = [
    {
      key: 'owner',
      label: venue.owner.name || 'Account owner',
      role: 'Owner',
      email: venue.owner.email,
      phone: venue.owner.phone,
      smsAvailable: venue.owner.smsAvailable,
      recipientType: 'owner',
    },
    ...venue.teamMembers.map((m) => ({
      key: m.id,
      label: m.name,
      role: m.role || 'Team',
      email: m.email,
      phone: null,
      smsAvailable: false,
      recipientType: 'team_member' as const,
      teamMemberId: m.id,
    })),
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 flex-wrap">
          <Building2 size={16} className="text-gray-400" />
          <h3 className="font-heading text-base text-gray-900">{venue.name}</h3>
          {venue.planName && (
            <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 text-[10px] font-semibold">{venue.planName}</span>
          )}
          {!venue.ghlConnected && (
            <span className="rounded-full bg-gray-50 border border-gray-200 text-gray-500 px-2 py-0.5 text-[10px] font-medium">No GHL connection · SMS unavailable</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <Users size={12} /> Contacts
        </p>
        {contacts.map((c) => (
          <ContactRow key={c.key} venueId={venue.id} contact={c} supportUserId={supportUserId} onSent={loadHistory} />
        ))}

        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="w-full flex items-center justify-between pt-3 mt-2 border-t border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wide"
        >
          <span className="flex items-center gap-1.5">
            {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Recent messages {history.length > 0 && `(${history.length})`}
          </span>
        </button>
        {historyOpen && (
          <div className="space-y-1.5">
            {historyLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-500 py-4 justify-center">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : history.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">No messages sent yet.</p>
            ) : (
              history.map((h) => (
                <div key={h.id} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    {h.channel === 'email' ? <Mail size={11} className="text-gray-400" /> : <MessageSquare size={11} className="text-gray-400" />}
                    <span className="font-semibold text-gray-700">{h.recipient_label}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">{h.sentByName}</span>
                    <span className="text-gray-400 ml-auto">{relativeTime(h.created_at)}</span>
                  </div>
                  <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap">{h.body}</p>
                  {!h.external_sent && h.send_error && (
                    <p className="text-[10px] text-red-600 mt-1">Failed: {h.send_error}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContactRow({
  venueId,
  contact,
  supportUserId,
  onSent,
}: {
  venueId: string;
  contact: { label: string; role: string; email: string | null; phone: string | null; smsAvailable: boolean; recipientType: 'owner' | 'team_member'; teamMemberId?: string };
  supportUserId?: string;
  onSent: () => void;
}) {
  const [composeChannel, setComposeChannel] = useState<'email' | 'sms' | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<'ok' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [viewingAs, setViewingAs] = useState(false);
  const [viewAsError, setViewAsError] = useState<string | null>(null);

  const openCompose = (channel: 'email' | 'sms') => {
    setResult(null);
    setErrorMsg(null);
    setComposeChannel((cur) => (cur === channel ? null : channel));
  };

  async function viewAsVenue() {
    if (viewingAs) return;
    setViewingAs(true);
    setViewAsError(null);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, returnUrl: '/admin/support?tab=private-clients' }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || 'Could not start preview');
      }
      window.location.href = '/dashboard';
    } catch (e) {
      setViewAsError(e instanceof Error ? e.message : 'Could not start preview');
      setViewingAs(false);
    }
  }

  async function send() {
    if (!composeChannel || !body.trim() || sending) return;
    setSending(true);
    setResult(null);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/admin/support/private-clients/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId,
          recipientType: contact.recipientType,
          teamMemberId: contact.teamMemberId,
          channel: composeChannel,
          body: body.trim(),
          supportUserId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      setResult('ok');
      setBody('');
      onSent();
      setTimeout(() => setComposeChannel(null), 1200);
    } catch (e) {
      setResult('error');
      setErrorMsg(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div className="w-7 h-7 shrink-0 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-semibold">
          {contact.recipientType === 'owner' ? <Crown size={12} /> : initials(contact.label)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{contact.label}</p>
          <p className="text-[11px] text-gray-500 truncate">{contact.role}{contact.email ? ` · ${contact.email}` : ' · no email on file'}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => openCompose('email')}
            disabled={!contact.email}
            title={contact.email ? 'Email' : 'No email on file'}
            className={`rounded-md border px-2 py-1 text-[11px] font-medium flex items-center gap-1 ${
              composeChannel === 'email' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <Mail size={11} /> Email
          </button>
          <button
            type="button"
            onClick={() => openCompose('sms')}
            disabled={!contact.smsAvailable}
            title={contact.smsAvailable ? 'SMS' : 'SMS unavailable for this contact'}
            className={`rounded-md border px-2 py-1 text-[11px] font-medium flex items-center gap-1 ${
              composeChannel === 'sms' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <MessageSquare size={11} /> SMS
          </button>
          {contact.recipientType === 'owner' && (
            <button
              type="button"
              onClick={() => void viewAsVenue()}
              disabled={viewingAs}
              title="Log in as this venue's dashboard"
              className="rounded-md border border-pink-200 bg-pink-50 px-2 py-1 text-[11px] font-semibold text-pink-900 hover:bg-pink-100 flex items-center gap-1 disabled:opacity-50"
            >
              {viewingAs ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />}
              View as venue
            </button>
          )}
        </div>
      </div>
      {viewAsError && (
        <p className="px-3 pb-2 -mt-1 text-[11px] text-red-600">{viewAsError}</p>
      )}

      {composeChannel && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 bg-gray-50/60 space-y-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={composeChannel === 'email' ? `Email ${contact.label}…` : `Text ${contact.label}…`}
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
          <div className="flex items-center justify-between gap-2">
            {result === 'ok' ? (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 size={13} /> Sent</span>
            ) : result === 'error' ? (
              <span className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertCircle size={13} /> {errorMsg}</span>
            ) : <span />}
            <button
              type="button"
              onClick={send}
              disabled={sending || !body.trim()}
              className="rounded-lg bg-gray-900 text-white px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
