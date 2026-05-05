'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, Workflow } from 'lucide-react';

interface AutoRow {
  id: string;
  name: string;
  status: string;
  trigger_type: string;
  updated_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft:  'bg-gray-100 text-gray-600',
  active: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-amber-50 text-amber-700',
};

const TRIGGER_LABELS: Record<string, string> = {
  form_submitted:        'Form submitted',
  tag_added:             'Tag added',
  stage_changed:         'Stage changed',
  trigger_link_click:    'Trigger link click',
  wedding_date_followup: 'After wedding date',
  proposal_paid:         'Proposal paid',
  '':                    'No trigger',
};

export default function WorkflowsListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<AutoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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

  function openModal() {
    setName('');
    setErr(null);
    setModalOpen(true);
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  async function deleteWorkflow(row: AutoRow) {
    if (deletingId) return;
    if (typeof window === 'undefined') return;
    const ok = window.confirm(
      `Delete "${row.name}"? This permanently removes the workflow and all its enrollments. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/marketing/automations/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error || 'Failed to delete. Please try again.');
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      void load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Failed to delete workflow.');
    } finally {
      setDeletingId(null);
    }
  }

  async function create() {
    const n = name.trim();
    if (!n) { setErr('Name is required'); return; }
    setCreating(true);
    setErr(null);
    // No trigger pre-selected — the canvas starts completely blank.
    // Users add triggers by clicking "Add New Trigger" on the canvas.
    const res = await fetch('/api/marketing/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, steps: [] }),
    });
    const j = (await res.json().catch(() => ({}))) as { automation?: { id: string }; error?: string };
    setCreating(false);
    if (!res.ok) { setErr(j.error || 'Could not create'); return; }
    if (j.automation?.id) {
      setModalOpen(false);
      router.push(`/dashboard/marketing/workflows/${j.automation.id}`);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/dashboard/marketing/analytics"
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Marketing
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
          <Workflow className="text-brand-600" size={28} />
          Workflows
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Visual automations for your leads — triggers, waits, emails. Set it once and let it run.
        </p>
        <button
          type="button"
          onClick={openModal}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
        >
          <Plus size={18} />
          New workflow
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center text-gray-600">
          <Workflow size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="mb-4">No workflows yet.</p>
          <button
            type="button"
            onClick={openModal}
            className="text-brand-600 hover:underline"
          >
            Create your first workflow
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const isDeleting = deletingId === r.id;
            return (
              <li key={r.id}>
                <div className="group flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:border-brand-200 hover:bg-brand-50/40">
                  <Link
                    href={`/dashboard/marketing/workflows/${r.id}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{r.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {r.trigger_type
                          ? (TRIGGER_LABELS[r.trigger_type] ?? r.trigger_type.replace(/_/g, ' '))
                          : 'No trigger'}
                        {' · updated '}
                        {new Date(r.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                        STATUS_STYLES[r.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {r.status}
                    </span>
                  </Link>
                  <Link
                    href={`/dashboard/marketing/workflows/${r.id}`}
                    title="Edit workflow"
                    className="flex flex-shrink-0 items-center justify-center border-l border-gray-100 px-4 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
                  >
                    <Pencil size={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void deleteWorkflow(r)}
                    disabled={isDeleting}
                    title="Delete workflow"
                    aria-label={`Delete ${r.name}`}
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

      {/* New Workflow Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-bold text-gray-900">New workflow</h2>
            <p className="mb-5 text-sm text-gray-500">
              Give it a name — you&apos;ll pick triggers and add steps on the canvas.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Workflow Name <span className="text-red-400">*</span>
                </label>
                <input
                  ref={nameRef}
                  type="text"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none transition-colors"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Speed to Lead — Inquiry Form"
                  onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
                />
              </div>
            </div>

            {err ? <p className="mt-3 text-sm text-red-500">{err}</p> : null}

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
                onClick={() => void create()}
                className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60 transition-colors"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {creating ? 'Creating…' : 'Build Workflow →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
