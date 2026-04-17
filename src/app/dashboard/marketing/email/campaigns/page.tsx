'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Megaphone, Plus } from 'lucide-react';
import type { CampaignSegment } from '@/lib/marketing-email-schema';

interface CampaignRow {
  id: string;
  name: string;
  template_id: string;
  status: string;
  scheduled_at: string | null;
  updated_at: string;
}

interface TemplateOpt {
  id: string;
  name: string;
}

export default function CampaignsListPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [templates, setTemplates] = useState<TemplateOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, tRes] = await Promise.all([
      fetch('/api/marketing/campaigns', { cache: 'no-store' }),
      fetch('/api/marketing/email-templates', { cache: 'no-store' }),
    ]);
    if (cRes.ok) {
      const d = await cRes.json();
      setCampaigns(d.campaigns ?? []);
    } else setCampaigns([]);
    if (tRes.ok) {
      const d = await tRes.json();
      setTemplates(d.templates ?? []);
    } else setTemplates([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function createCampaign() {
    const n = name.trim();
    if (!n) {
      setErr('Name is required');
      return;
    }
    if (!templateId) {
      setErr('Pick a template');
      return;
    }
    const segment: CampaignSegment = { type: 'all_leads' };
    setCreating(true);
    setErr(null);
    const res = await fetch('/api/marketing/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, templateId, segment }),
    });
    const j = (await res.json().catch(() => ({}))) as { campaign?: { id: string }; error?: string };
    setCreating(false);
    if (!res.ok) {
      setErr(j.error || 'Could not create');
      return;
    }
    if (j.campaign?.id) {
      setModalOpen(false);
      router.push(`/dashboard/marketing/email/campaigns/${j.campaign.id}`);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard/marketing/email"
            className="mb-2 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} />
            Marketing email
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <Megaphone className="text-brand-600" size={28} />
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-gray-600">Draft, segment, schedule, or send now. Progress appears on each campaign page.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setName('');
            setTemplateId(templates[0]?.id ?? '');
            setErr(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus size={18} />
          New campaign
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-gray-600">
          No campaigns yet. Create one, then refine the audience on the detail page.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
          {campaigns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-gray-50/80">
              <div className="min-w-0">
                <Link href={`/dashboard/marketing/email/campaigns/${c.id}`} className="font-medium text-brand-700 hover:underline">
                  {c.name}
                </Link>
                <p className="text-xs text-gray-500">
                  {c.status}
                  {c.scheduled_at ? ` · scheduled ${new Date(c.scheduled_at).toLocaleString()}` : ''}
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-700">{c.status}</span>
            </li>
          ))}
        </ul>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">New campaign</h2>
            <label className="mt-4 block text-sm font-medium text-gray-700">Name</label>
            <input
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring promo"
            />
            <label className="mt-3 block text-sm font-medium text-gray-700">Template</label>
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Select…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="mt-3 text-xs text-gray-500">Audience filters can be set after creation on the campaign page.</p>
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={creating || templates.length === 0}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={() => void createCampaign()}
              >
                {creating ? <Loader2 className="animate-spin inline" size={16} /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
