'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Inbox, Loader2, Search, Mail, Phone, Calendar, Users, MessageSquare,
  CheckCircle2, Archive, Trash2, ExternalLink,
} from 'lucide-react';

interface Lead {
  id: string;
  venue_id: string;
  listing_slug: string | null;
  listing_name: string | null;
  name: string;
  email: string;
  phone: string | null;
  wedding_date: string | null;
  guest_count: number | null;
  booking_timeline: string | null;
  message: string | null;
  notes: string | null;
  status: LeadStatus;
  source: string;
  created_at: string;
  updated_at: string | null;
}

type LeadStatus =
  | 'new'
  | 'contacted'
  | 'tour_booked'
  | 'proposal_sent'
  | 'booked_wedding'
  | 'not_interested';

type StatusFilter = 'all' | LeadStatus;

const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'https://storyvenue.com';

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'all',             label: 'All' },
  { id: 'new',             label: 'New' },
  { id: 'contacted',       label: 'Contacted' },
  { id: 'tour_booked',     label: 'Tour booked' },
  { id: 'proposal_sent',   label: 'Proposal sent' },
  { id: 'booked_wedding',  label: 'Booked' },
  { id: 'not_interested',  label: 'Not interested' },
];

const STATUS_LABELS: Record<LeadStatus, string> = {
  new:            'New',
  contacted:      'Contacted',
  tour_booked:    'Tour booked',
  proposal_sent:  'Proposal sent',
  booked_wedding: 'Booked',
  not_interested: 'Not interested',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusPillClasses(status: string): string {
  switch (status) {
    case 'new':            return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'contacted':      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'tour_booked':    return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'proposal_sent':  return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'booked_wedding': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'not_interested': return 'bg-gray-100 text-gray-500 border-gray-200';
    default:               return 'bg-gray-100 text-gray-700 border-gray-200';
  }
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (query.trim()) params.set('q', query.trim());
    const res = await fetch(`/api/leads?${params.toString()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setLeads(data.leads ?? []);
    }
    setLoading(false);
  }, [statusFilter, query]);

  useEffect(() => { load(); }, [load]);

  async function updateLead(id: string, patch: Partial<Pick<Lead, 'status' | 'notes'>>) {
    const res = await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setLeads((prev) => prev.map(l => l.id === id ? { ...l, ...data.lead } : l));
    }
  }

  async function deleteLead(id: string) {
    if (!confirm('Delete this lead?')) return;
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (res.ok) setLeads((prev) => prev.filter(l => l.id !== id));
  }

  const counts = useMemo(() => {
    const by: Record<string, number> = { all: leads.length };
    for (const l of leads) by[l.status] = (by[l.status] ?? 0) + 1;
    return by;
  }, [leads]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
          <Inbox className="w-6 h-6" /> Leads
        </h1>
        <p className="text-sm text-gray-500 mt-1">Inquiries from your StoryVenue directory listing.</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((tab) => {
            const active = statusFilter === tab.id;
            const n = counts[tab.id] ?? 0;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active ? 'text-white border-transparent' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                style={active ? { backgroundColor: '#1b1b1b' } : undefined}
              >
                {tab.label}
                {statusFilter === 'all' && n > 0 && (
                  <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20' : 'bg-gray-100'}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full sm:w-72 rounded-2xl border border-gray-200 bg-white pl-9 pr-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-gray-400">
            <Inbox className="w-10 h-10 mb-3" />
            <p className="text-sm">No leads match your filter yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {leads.map((lead) => {
              const isOpen = expanded === lead.id;
              return (
                <li key={lead.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : lead.id)}
                    className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">{lead.name}</span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${statusPillClasses(lead.status)}`}>
                          {STATUS_LABELS[lead.status] ?? lead.status}
                        </span>
                        {lead.listing_name && (
                          <span className="text-xs text-gray-400">· {lead.listing_name}</span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" /> {lead.email}</span>
                        {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {lead.phone}</span>}
                        {lead.wedding_date && <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {formatDate(lead.wedding_date)}</span>}
                        {lead.guest_count != null && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {lead.guest_count} guests</span>}
                      </div>
                      {lead.message && !isOpen && (
                        <p className="mt-1 text-xs text-gray-500 line-clamp-1">{lead.message}</p>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-400 whitespace-nowrap pt-1">
                      {formatDate(lead.created_at)}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-5 -mt-1 space-y-4">
                      {lead.message && (
                        <div className="rounded-2xl bg-gray-50 p-4">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                            <MessageSquare className="w-3.5 h-3.5" /> Message
                          </div>
                          <p className="text-sm text-gray-800 whitespace-pre-wrap">{lead.message}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600">
                        {lead.booking_timeline && <div><span className="text-gray-400">Timeline: </span>{lead.booking_timeline}</div>}
                        <div><span className="text-gray-400">Source: </span>{lead.source}</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={`mailto:${lead.email}`}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          <Mail className="w-3.5 h-3.5" /> Reply
                        </a>
                        {lead.phone && (
                          <a
                            href={`tel:${lead.phone}`}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <Phone className="w-3.5 h-3.5" /> Call
                          </a>
                        )}
                        {lead.listing_slug && (
                          <a
                            href={`${DIRECTORY_URL}/venue/${lead.listing_slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> Listing
                          </a>
                        )}
                        <div className="ml-auto flex flex-wrap items-center gap-1.5">
                          {lead.status !== 'contacted' && (
                            <button
                              onClick={() => updateLead(lead.id, { status: 'contacted' })}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" /> Mark contacted
                            </button>
                          )}
                          {lead.status !== 'tour_booked' && (
                            <button
                              onClick={() => updateLead(lead.id, { status: 'tour_booked' })}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Tour booked
                            </button>
                          )}
                          {lead.status !== 'proposal_sent' && (
                            <button
                              onClick={() => updateLead(lead.id, { status: 'proposal_sent' })}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Proposal sent
                            </button>
                          )}
                          {lead.status !== 'booked_wedding' && (
                            <button
                              onClick={() => updateLead(lead.id, { status: 'booked_wedding' })}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                            >
                              Booked
                            </button>
                          )}
                          {lead.status !== 'not_interested' && (
                            <button
                              onClick={() => updateLead(lead.id, { status: 'not_interested' })}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              <Archive className="w-3.5 h-3.5" /> Not interested
                            </button>
                          )}
                          <button
                            onClick={() => deleteLead(lead.id)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
