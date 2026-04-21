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

export default function WorkflowsListPage() {
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
          : triggerType === 'wedding_date_followup'
            ? { days_after_wedding: 3 }
            : triggerType === 'proposal_paid'
              ? {}
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
      router.push(`/dashboard/marketing/workflows/${j.automation.id}`);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/marketing/analytics"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            Marketing
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <Workflow className="text-[#155eef]" size={28} />
            Workflows
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Visual automations for your leads: triggers, waits, email, and SMS. Built for more channels later —
            same builder, new action types over time.
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
          className="inline-flex items-center gap-2 rounded-lg bg-[#155eef] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#1249d1]"
        >
          <Plus size={18} />
          New workflow
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-slate-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : rows.length === 0 ? (
        <div
          className={`rounded-xl border border-dashed border-slate-300 py-16 text-center ${'bg-[#eef1f6] [background-image:linear-gradient(rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.04)_1px,transparent_1px)] [background-size:20px_20px]'}`}
        >
          <p className="text-sm font-medium text-slate-700">No workflows yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
            Create a workflow to enroll leads when tags, stages, links, payments, or dates match — then add steps on
            the canvas.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-slate-50/80">
              <div>
                <Link href={`/dashboard/marketing/workflows/${r.id}`} className="font-semibold text-[#155eef] hover:underline">
                  {r.name}
                </Link>
                <p className="mt-0.5 text-xs text-slate-500">
                  {r.trigger_type.replace(/_/g, ' ')} · updated {new Date(r.updated_at).toLocaleString()}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                  r.status === 'active'
                    ? 'bg-emerald-100 text-emerald-800'
                    : r.status === 'paused'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {r.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" role="dialog">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">New workflow</h2>
            <label className="mt-4 block text-sm font-medium text-slate-700">Name</label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome sequence"
            />
            <label className="mt-3 block text-sm font-medium text-slate-700">Trigger</label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
            >
              <option value="tag_added">Tag added</option>
              <option value="stage_changed">Stage changed (enters stage)</option>
              <option value="trigger_link_click">Trigger link click</option>
              <option value="wedding_date_followup">After wedding date (thank-you / review)</option>
              <option value="proposal_paid">Proposal paid (deposit or final)</option>
            </select>
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating}
                className="rounded-lg bg-[#155eef] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1249d1] disabled:opacity-50"
                onClick={() => void create()}
              >
                {creating ? <Loader2 className="inline animate-spin" size={16} /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
