'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LayoutTemplate, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

interface FormRow {
  id: string;
  name: string;
  embed_token: string;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export default function FormBuilderListPage() {
  const router = useRouter();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/marketing/forms', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      setForms(d.forms ?? []);
    } else setForms([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function deleteForm(form: FormRow) {
    if (deletingId) return;
    if (typeof window === 'undefined') return;
    const ok = window.confirm(
      `Delete "${form.name}"? This permanently removes the form, its embed URL, and all submissions. This cannot be undone.`,
    );
    if (!ok) return;
    setDeletingId(form.id);
    try {
      const res = await fetch(`/api/marketing/forms/${form.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        window.alert(j.error || 'Failed to delete form. Please try again.');
        return;
      }
      // Optimistically drop the row, then refresh in the background to stay
      // in sync if anything else changed server-side.
      setForms((prev) => prev.filter((row) => row.id !== form.id));
      void load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Failed to delete form.');
    } finally {
      setDeletingId(null);
    }
  }

  async function createForm() {
    const name = newName.trim();
    if (!name) {
      setErr('Enter a name');
      return;
    }
    setCreating(true);
    setErr(null);
    const res = await fetch('/api/marketing/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const j = (await res.json().catch(() => ({}))) as { form?: { id: string }; error?: string };
    setCreating(false);
    if (!res.ok) {
      setErr(j.error || 'Could not create form');
      return;
    }
    if (j.form?.id) {
      setModalOpen(false);
      setNewName('');
      router.push(`/dashboard/marketing/form-builder/${j.form.id}`);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
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
            <LayoutTemplate className="text-brand-600" size={28} />
            Lead Capture Forms
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Build embeddable lead capture forms for your venue site. Drag blocks to reorder; copy the iframe when you are ready to go live.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNewName('');
            setErr(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
        >
          <Plus size={18} />
          New form
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-gray-500">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : forms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center text-gray-600">
          <p className="mb-4">No forms yet.</p>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="text-brand-600 hover:underline"
          >
            Create your first form
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {forms.map((f) => {
            const isDeleting = deletingId === f.id;
            return (
              <li key={f.id}>
                <div className="group flex items-stretch overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:border-brand-200 hover:bg-brand-50/40">
                  <Link
                    href={`/dashboard/marketing/form-builder/${f.id}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{f.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {f.published ? 'Published' : 'Draft'} · updated{' '}
                        {new Date(f.updated_at).toLocaleString()}
                      </p>
                    </div>
                  </Link>
                  <Link
                    href={`/dashboard/marketing/form-builder/${f.id}`}
                    title="Edit form"
                    className="flex flex-shrink-0 items-center justify-center border-l border-gray-100 px-4 text-gray-400 transition hover:bg-gray-50 hover:text-gray-700"
                  >
                    <Pencil size={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void deleteForm(f)}
                    disabled={isDeleting}
                    title="Delete form"
                    aria-label={`Delete ${f.name}`}
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

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">New form</h2>
            <p className="mt-1 text-sm text-gray-600">Choose a name you will recognize in the dashboard.</p>
            <input
              className="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="e.g. Wedding inquiry"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
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
                className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800 disabled:opacity-50"
                onClick={() => void createForm()}
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : null}
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
