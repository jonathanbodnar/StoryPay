'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Users, Pencil, Trash2, X } from 'lucide-react';
import {
  AudiencePicker,
  type AudiencePickerStage,
  type AudiencePickerTag,
  type AudiencePickerTriggerLink,
} from '@/components/marketing/AudiencePicker';
import {
  parseSavedSegmentDefinition,
  type CampaignSegment,
  type SavedSegmentDefinition,
} from '@/lib/marketing-email-schema';

interface SegmentRow {
  id: string;
  name: string;
  description: string;
  definition_json: unknown;
  created_at: string;
  updated_at: string;
}

interface PipelineRow {
  id: string;
  name: string;
  stages: { id: string; name: string; pipeline_id: string; kind?: string }[];
}

interface TriggerLinkOpt {
  id: string;
  name: string;
}

const EMPTY_DEF: SavedSegmentDefinition = { type: 'all_leads' };

export default function AudiencesPage() {
  const [audiences, setAudiences] = useState<SegmentRow[]>([]);
  const [tags, setTags] = useState<AudiencePickerTag[]>([]);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [triggerLinks, setTriggerLinks] = useState<TriggerLinkOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SegmentRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  const stages: AudiencePickerStage[] = useMemo(
    () =>
      pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipelineName: p.name }))),
    [pipelines],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, tagRes, pipeRes, tlRes] = await Promise.all([
      fetch('/api/marketing/segments', { cache: 'no-store' }),
      fetch('/api/marketing/tags', { cache: 'no-store' }),
      fetch('/api/pipelines', { cache: 'no-store' }),
      fetch('/api/marketing/trigger-links', { cache: 'no-store' }),
    ]);
    if (sRes.ok) {
      const d = (await sRes.json()) as { segments?: SegmentRow[] };
      setAudiences(d.segments ?? []);
    }
    if (tagRes.ok) {
      const d = (await tagRes.json()) as { tags?: AudiencePickerTag[] };
      setTags(d.tags ?? []);
    }
    if (pipeRes.ok) {
      const d = (await pipeRes.json()) as { pipelines?: PipelineRow[] };
      setPipelines(d.pipelines ?? []);
    }
    if (tlRes.ok) {
      const d = (await tlRes.json()) as { links?: TriggerLinkOpt[] };
      setTriggerLinks((d.links ?? []).map((x) => ({ id: x.id, name: x.name })));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, number | null> = {};
      for (const s of audiences) {
        try {
          const segJson = JSON.stringify({
            type: 'saved_segment',
            saved_segment_id: s.id,
          });
          const res = await fetch('/api/marketing/segments/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: `{"segment":${segJson}}`,
          });
          if (cancelled) return;
          if (res.ok) {
            const j = (await res.json()) as { count?: number };
            next[s.id] = typeof j.count === 'number' ? j.count : null;
          } else {
            next[s.id] = null;
          }
        } catch {
          next[s.id] = null;
        }
      }
      if (!cancelled) setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [audiences]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this audience? Any campaigns using it will fall back to "All leads".')) return;
    const res = await fetch(`/api/marketing/segments/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error || 'Could not delete audience');
      return;
    }
    setErr(null);
    void load();
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audiences</h1>
          <p className="mt-1 text-sm text-gray-500">
            Save reusable audiences and pick them when sending campaigns. Edits to an audience update every campaign that
            uses it on the next send.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateOpen(true);
            setErr(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
        >
          <Plus size={18} /> New audience
        </button>
      </div>

      {err ? <p className="mb-3 text-sm text-red-600">{err}</p> : null}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : audiences.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <Users size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No audiences yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">
            Create an audience to reuse the same group across multiple campaigns — e.g. "Booked couples 2026", "Tour
            requested, no proposal", or "Newsletter subscribers".
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <Plus size={18} /> New audience
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {audiences.map((s) => {
            const count = counts[s.id];
            return (
              <div
                key={s.id}
                className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 transition-colors hover:border-gray-300"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900">{s.name}</p>
                  {s.description ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{s.description}</p>
                  ) : null}
                  <p className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    Updated {new Date(s.updated_at).toLocaleDateString()}
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1 text-gray-500">
                      <Users size={11} />
                      {count === undefined
                        ? '…'
                        : count === null
                          ? '—'
                          : `${count.toLocaleString()} ${count === 1 ? 'recipient' : 'recipients'}`}
                    </span>
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(s);
                      setErr(null);
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(s.id)}
                    className="flex items-center gap-1.5 rounded-xl border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen ? (
        <AudienceEditorModal
          mode="create"
          tags={tags}
          stages={stages}
          triggerLinks={triggerLinks}
          initial={{ name: '', description: '', definition: EMPTY_DEF }}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      ) : null}

      {editing ? (
        <AudienceEditorModal
          mode="edit"
          id={editing.id}
          tags={tags}
          stages={stages}
          triggerLinks={triggerLinks}
          initial={{
            name: editing.name,
            description: editing.description,
            definition: parseSavedSegmentDefinition(editing.definition_json),
          }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      <div className="mt-10 rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-5 text-xs text-gray-500">
        <p className="font-semibold text-gray-700">Want to send to one of these audiences?</p>
        <p className="mt-1">
          Open or create a campaign in{' '}
          <Link href="/dashboard/marketing/email/campaigns" className="font-medium text-gray-900 underline-offset-2 hover:underline">
            Marketing → Emails
          </Link>
          , then choose <span className="font-medium text-gray-700">Use a saved audience</span> in the Audience step.
        </p>
      </div>
    </div>
  );
}

function AudienceEditorModal({
  mode,
  id,
  tags,
  stages,
  triggerLinks,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  id?: string;
  tags: AudiencePickerTag[];
  stages: AudiencePickerStage[];
  triggerLinks: AudiencePickerTriggerLink[];
  initial: { name: string; description: string; definition: SavedSegmentDefinition };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [definition, setDefinition] = useState<SavedSegmentDefinition>(initial.definition);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 50);
  }, []);

  async function save() {
    const n = name.trim();
    if (!n) {
      setErr('Name is required');
      return;
    }
    setSaving(true);
    setErr(null);
    const url = mode === 'create' ? '/api/marketing/segments' : `/api/marketing/segments/${id}`;
    const res = await fetch(url, {
      method: mode === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: n, description: description.trim(), definition }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error || 'Save failed');
      return;
    }
    onSaved();
  }

  const value: CampaignSegment = definition;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {mode === 'create' ? 'New audience' : 'Edit audience'}
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Define an audience once and reuse it across as many campaigns as you want.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Audience name <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Booked couples 2026, Tour requested no proposal…"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Description (optional)
            </label>
            <input
              type="text"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 transition-colors placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this audience is for — helps your team pick the right one"
              maxLength={500}
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Audience filters</p>
            <AudiencePicker
              value={value}
              onChange={(next) => {
                if (next.type === 'saved_segment') {
                  setDefinition({ type: 'all_leads' });
                  return;
                }
                const { saved_segment_id: _ignored, ...rest } = next;
                void _ignored;
                setDefinition(rest as SavedSegmentDefinition);
              }}
              tags={tags}
              stages={stages}
              triggerLinks={triggerLinks}
              hideSavedSegmentOption
            />
          </div>

          {err ? <p className="text-sm text-red-600">{err}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {saving ? 'Saving…' : mode === 'create' ? 'Create audience' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
