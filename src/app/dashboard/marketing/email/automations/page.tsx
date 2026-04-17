'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Plus, Workflow } from 'lucide-react';
import type { AutomationTriggerType } from '@/lib/marketing-email-schema';

interface AutoRow {
  id: string;
  name: string;
  status: string;
  trigger_type: string;
  updated_at: string;
}

export default function AutomationsListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AutoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('tag_added');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/marketing/automations', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setRows(d.automations ?? []);
    } else setRows([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function create() {
    const n = name.trim();
    if (!n) {
      setErr('Name is required');
      return;
    }
    setCreating(true);
    setErr(null);
    const triggerConfig =
      triggerType === 'tag_added'
        ? { tag_ids: [] as string[] }
        : triggerType === 'stage_changed'
          ? { to_stage_ids: [] as string[] }
          : { trigger_link_ids: [] as string[] };
    const res = await fetch('/api/marketing/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, triggerType, triggerConfig, steps: [] }),
    });
    const j = (await res.json().catch(() => ({}))) as { automation?: { id: string }; error?: string };
    setCreating(false);
    if (!res.ok) {
      setErr(j.error || 'Could not create');
      return;
    }
    if (j.automation?.id) {
      setModalOpen(false);
      router.push(`/dashboard/marketing/email/automations/${j.automation.id}`);
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
            <Workflow className="text-brand-600" size={28} />
            Automations
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Active automations enroll leads when tags, stages, or trigger-link clicks match. Steps run on the marketing
            email cron.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setName('');
            setTriggerType('tag_added');
            setErr(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus size={18} />
          New automation
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-gray-600">
          No automations yet. Create one to add delays and template sends.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-gray-50/80">
              <div>
                <Link href={`/dashboard/marketing/email/automations/${r.id}`} className="font-medium text-brand-700 hover:underline">
                  {r.name}
                </Link>
                <p className="text-xs text-gray-500">
                  {r.trigger_type.replace(/_/g, ' ')} · {r.status}
                </p>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize">{r.status}</span>
            </li>
          ))}
        </ul>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">New automation</h2>
            <label className="mt-4 block text-sm font-medium text-gray-700">Name</label>
            <input
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome sequence"
            />
            <label className="mt-3 block text-sm font-medium text-gray-700">Trigger</label>
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
            >
              <option value="tag_added">Tag added</option>
              <option value="stage_changed">Stage changed (enters stage)</option>
              <option value="trigger_link_click">Trigger link click</option>
            </select>
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={creating}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={() => void create()}
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
