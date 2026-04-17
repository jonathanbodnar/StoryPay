'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileStack, Loader2, Plus, Pencil } from 'lucide-react';

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  created_at: string;
  updated_at: string;
}

export default function EmailTemplatesListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/marketing/email-templates', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setRows(d.templates ?? []);
    } else setRows([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function createTemplate() {
    const name = newName.trim();
    if (!name) {
      setErr('Enter a name');
      return;
    }
    setCreating(true);
    setErr(null);
    const res = await fetch('/api/marketing/email-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const j = (await res.json().catch(() => ({}))) as { template?: { id: string }; error?: string };
    setCreating(false);
    if (!res.ok) {
      setErr(j.error || 'Could not create template');
      return;
    }
    if (j.template?.id) {
      setModalOpen(false);
      setNewName('');
      router.push(`/dashboard/marketing/email/templates/${j.template.id}`);
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
            <FileStack className="text-brand-600" size={28} />
            Email templates
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Build reusable layouts with blocks and merge fields. Campaigns and automations reference these templates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNewName('');
            setErr(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus size={18} />
          New template
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 py-12 text-center text-sm text-gray-600">
          No templates yet. Create one to open the drag-and-drop editor.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50/80">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{t.name}</p>
                <p className="truncate text-xs text-gray-500">{t.subject || 'No subject'}</p>
              </div>
              <Link
                href={`/dashboard/marketing/email/templates/${t.id}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Pencil size={14} />
                Edit
              </Link>
            </li>
          ))}
        </ul>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">New email template</h2>
            <label className="mt-4 block text-sm font-medium text-gray-700">Name</label>
            <input
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Weekly newsletter"
              autoFocus
            />
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                onClick={() => void createTemplate()}
              >
                {creating ? <Loader2 className="animate-spin" size={16} /> : null}
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
