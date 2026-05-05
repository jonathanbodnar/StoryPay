'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';

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
  const [deletingId, setDeletingId] = useState<string | null>(null);
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

  async function deleteCampaign(camp: CampaignRow) {
    if (deletingId) return;
    if (typeof window === 'undefined') return;
    const ok = window.confirm(
      `Delete "${camp.name}"? This permanently removes the email and its send history. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(camp.id);
    try {
      const res = await fetch(`/api/marketing/campaigns/${camp.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error || 'Failed to delete email. Please try again.');
        return;
      }
      setCampaigns((prev) => prev.filter((row) => row.id !== camp.id));
      void load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Failed to delete email.');
    } finally {
      setDeletingId(null);
    }
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
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header — mirrors the Lead Capture Forms list page so the two
          marketing sub-pages feel like siblings. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard/marketing/analytics"
            className="mb-2 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} />
            Marketing
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <Megaphone className="text-brand-600" size={28} />
            Emails
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Create an email, pick your audience, preview, and send. Drafts can be edited and
            re-sent any time before they go out.
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
        >
          <Plus size={18} />
          New email
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center text-gray-600">
          <Megaphone size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="mb-4">No emails yet.</p>
          <button
            type="button"
            onClick={openModal}
            className="text-brand-600 hover:underline"
          >
            Create your first email
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => {
            const isDeleting = deletingId === c.id;
            return (
              <li key={c.id}>
                <div className="group flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:border-brand-200 hover:bg-brand-50/40">
                  <Link
                    href={`/dashboard/marketing/email/campaigns/${c.id}/design`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{c.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        Updated {new Date(c.updated_at).toLocaleDateString()}
                        {c.scheduled_at
                          ? ` · Scheduled ${new Date(c.scheduled_at).toLocaleString()}`
                          : ''}
                      </p>
                    </div>
                    <span
                      className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                        STATUS_STYLES[c.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {c.status}
                    </span>
                  </Link>
                  <Link
                    href={`/dashboard/marketing/email/campaigns/${c.id}/design`}
                    title="Edit email"
                    className="flex flex-shrink-0 items-center justify-center border-l border-gray-100 px-4 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
                  >
                    <Pencil size={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void deleteCampaign(c)}
                    disabled={isDeleting}
                    title="Delete email"
                    aria-label={`Delete ${c.name}`}
                    className="flex flex-shrink-0 items-center justify-center border-l border-gray-100 px-4 text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    {isDeleting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
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
            <h2 className="mb-1 text-lg font-bold text-gray-900">New Email</h2>
            <p className="mb-5 text-sm text-gray-500">Give it a name and subject — you&apos;ll design it on the next screen.</p>

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
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                {creating ? 'Creating…' : 'Design Email →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
