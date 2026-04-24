'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Megaphone, Pen, Plus, Send } from 'lucide-react';

interface CampaignRow {
  id: string;
  name: string;
  template_id: string;
  status: string;
  scheduled_at: string | null;
  updated_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-50 text-blue-700',
  sending:   'bg-amber-50 text-amber-700',
  sent:      'bg-emerald-50 text-emerald-700',
  failed:    'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

export default function CampaignsListPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/marketing/campaigns', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setCampaigns(d.campaigns ?? []);
    } else setCampaigns([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  function openModal() {
    setName(''); setSubject(''); setErr(null);
    setModalOpen(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  async function createCampaign() {
    const n = name.trim();
    if (!n) { setErr('Campaign name is required'); return; }
    setCreating(true); setErr(null);
    const res = await fetch('/api/marketing/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, subject: subject.trim() || n, segment: { type: 'all_leads' } }),
    });
    const j = (await res.json().catch(() => ({}))) as { campaign?: { id: string }; error?: string };
    setCreating(false);
    if (!res.ok) { setErr(j.error || 'Could not create campaign'); return; }
    if (j.campaign?.id) {
      setModalOpen(false);
      // Navigate directly to the Flodesk-style design page
      router.push(`/dashboard/marketing/email/campaigns/${j.campaign.id}/design`);
    }
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Email Campaigns</h1>
          <p className="mt-1 text-sm text-gray-500">One-off email blasts to your leads and contacts.</p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
        >
          <Plus size={16} /> New Campaign
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <Megaphone size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No campaigns yet</p>
          <p className="mt-1 text-xs text-gray-400">Create your first campaign to send an email to your leads</p>
          <button
            type="button"
            onClick={openModal}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Plus size={15} /> New Campaign
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 hover:border-gray-300 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-900">{c.name}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Updated {new Date(c.updated_at).toLocaleDateString()}
                  {c.scheduled_at ? ` · Scheduled ${new Date(c.scheduled_at).toLocaleString()}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                {c.status}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {c.status === 'draft' && (
                  <Link
                    href={`/dashboard/marketing/email/campaigns/${c.id}/design`}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Pen size={12} /> Edit
                  </Link>
                )}
                <Link
                  href={`/dashboard/marketing/email/campaigns/${c.id}`}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Send size={12} /> {c.status === 'draft' ? 'Send' : 'View'}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Campaign Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-gray-900">New Campaign</h2>
            <p className="mb-5 text-sm text-gray-500">You&apos;ll design the email on the next screen.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Campaign Name <span className="text-red-400">*</span>
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Spring offer, Venue tour invite…"
                  onKeyDown={(e) => { if (e.key === 'Enter') void createCampaign(); }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Subject Line
                </label>
                <input
                  type="text"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Defaults to campaign name if blank"
                  onKeyDown={(e) => { if (e.key === 'Enter') void createCampaign(); }}
                />
              </div>
            </div>

            {err && <p className="mt-3 text-sm text-red-500">{err}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void createCampaign()}
                className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60 transition-colors"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Pen size={14} />}
                {creating ? 'Creating…' : 'Design Email →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
