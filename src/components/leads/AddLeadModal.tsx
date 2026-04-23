'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  DollarSign,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

type StageKind = 'open' | 'won' | 'lost';

export interface LeadStage {
  id: string;
  pipeline_id: string;
  venue_id: string;
  name: string;
  color: string;
  kind: StageKind;
  position: number;
  win_probability?: number | null;
}

export interface LeadPipeline {
  id: string;
  venue_id: string;
  name: string;
  is_default: boolean;
  position: number;
  stages: LeadStage[];
}

export interface MarketingTag {
  id: string;
  name: string;
  icon?: string;
  color?: string | null;
}

export interface VenueSpaceLite {
  id: string;
  name: string;
  color: string;
  capacity?: number | null;
}

export type LeadDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  venueName: string;
  venueWebsiteUrl: string;
  opportunityValue: string;
  weddingDate: string;
  guestCount: string;
  bookingTimeline: string;
  message: string;
  pipelineId: string;
  /**
   * Regular stage UUID, or `NO_PIPELINE_STAGE` for the special "None" option
   * (creates a contact without placing it in any visible pipeline stage).
   */
  stageId: string;
  spaceId: string;
  tagIds: string[];
};

/**
 * Sentinel value used by the shared stage dropdown to mean "no pipeline at
 * all". Consumers should translate this into `excludeFromPipeline: true` on
 * the API payload instead of forwarding it as a real stage id.
 */
export const NO_PIPELINE_STAGE = '__none__';

export const emptyLeadDraft = (pipelineId: string): LeadDraft => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  venueName: '',
  venueWebsiteUrl: '',
  opportunityValue: '',
  weddingDate: '',
  guestCount: '',
  bookingTimeline: '',
  message: '',
  pipelineId,
  stageId: '',
  spaceId: '',
  tagIds: [],
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function AddLeadModal({
  title = 'New lead',
  submitLabel = 'Create lead',
  pipelines,
  allTags,
  spaces,
  onSpacesChange,
  defaultPipelineId,
  onClose,
  onSave,
  onVenueTagCreated,
}: {
  title?: string;
  submitLabel?: string;
  pipelines: LeadPipeline[];
  allTags: MarketingTag[];
  spaces: VenueSpaceLite[];
  onSpacesChange: (next: VenueSpaceLite[] | ((prev: VenueSpaceLite[]) => VenueSpaceLite[])) => void;
  defaultPipelineId: string;
  onClose: () => void;
  onSave: (draft: LeadDraft) => Promise<void> | void;
  onVenueTagCreated: (tag: MarketingTag) => void;
}) {
  const initialPipeline = pipelines.find((p) => p.id === defaultPipelineId) ?? pipelines[0];
  const [draft, setDraft] = useState<LeadDraft>(() => {
    const d = emptyLeadDraft(initialPipeline?.id ?? defaultPipelineId);
    const first = initialPipeline?.stages?.[0];
    return { ...d, stageId: first?.id ?? '' };
  });
  const [saving, setSaving] = useState(false);

  const [manageSpaces, setManageSpaces] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceColor, setNewSpaceColor] = useState('#6366f1');
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editSpaceDraft, setEditSpaceDraft] = useState<{ name: string; color: string }>({
    name: '',
    color: '#6366f1',
  });
  const [spaceBusy, setSpaceBusy] = useState(false);

  const stagesForPipeline = useMemo(() => {
    const p = pipelines.find((x) => x.id === draft.pipelineId);
    return p?.stages ?? [];
  }, [pipelines, draft.pipelineId]);

  async function createSpace() {
    const name = newSpaceName.trim();
    if (!name) return;
    setSpaceBusy(true);
    try {
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: newSpaceColor }),
      });
      if (res.ok) {
        const row = (await res.json()) as VenueSpaceLite;
        onSpacesChange((prev) => [...prev, row]);
        setDraft((p) => ({ ...p, spaceId: row.id }));
        setNewSpaceName('');
      }
    } finally {
      setSpaceBusy(false);
    }
  }

  async function saveSpaceEdit(id: string) {
    const name = editSpaceDraft.name.trim();
    if (!name) return;
    setSpaceBusy(true);
    try {
      const res = await fetch(`/api/spaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: editSpaceDraft.color }),
      });
      if (res.ok) {
        const row = (await res.json()) as VenueSpaceLite;
        onSpacesChange((prev) => prev.map((s) => (s.id === id ? { ...s, ...row } : s)));
        setEditingSpaceId(null);
      }
    } finally {
      setSpaceBusy(false);
    }
  }

  async function deleteSpace(id: string) {
    const space = spaces.find((s) => s.id === id);
    const ok = window.confirm(
      `Delete space${space ? ` "${space.name}"` : ''}? Leads and events assigned to this space will keep their data but lose the space label.`,
    );
    if (!ok) return;
    setSpaceBusy(true);
    try {
      const res = await fetch(`/api/spaces/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onSpacesChange((prev) => prev.filter((s) => s.id !== id));
        setDraft((p) => (p.spaceId === id ? { ...p, spaceId: '' } : p));
      }
    } finally {
      setSpaceBusy(false);
    }
  }

  async function submit() {
    if (!draft.firstName.trim()) {
      alert('First name is required');
      return;
    }
    if (!draft.lastName.trim()) {
      alert('Last name is required');
      return;
    }
    if (!draft.email.trim()) {
      alert('Email is required');
      return;
    }
    if (!draft.phone.trim()) {
      alert('Phone is required');
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-2xl max-h-[90vh] rounded-3xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h3 className="font-heading text-lg text-gray-900 flex items-center gap-2">
              <UserPlus className="w-4.5 h-4.5" /> {title}
            </h3>
            <button
              onClick={onClose}
              className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-6 overflow-y-auto space-y-3">
            {pipelines.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                    Pipeline
                  </label>
                  <select
                    value={draft.pipelineId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const p = pipelines.find((x) => x.id === pid);
                      const first = p?.stages?.[0];
                      setDraft((prev) => ({
                        ...prev,
                        pipelineId: pid,
                        stageId: first?.id ?? '',
                      }));
                    }}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                    Stage
                  </label>
                  <select
                    value={draft.stageId}
                    onChange={(e) => set('stageId', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
                  >
                    <option value={NO_PIPELINE_STAGE}>None — contact only (not in pipeline)</option>
                    {stagesForPipeline.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {draft.stageId === NO_PIPELINE_STAGE && (
                    <p className="mt-1 text-[11px] text-gray-500">
                      They&rsquo;ll appear on the Contacts page but won&rsquo;t show up in the leads pipeline.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Space
                </label>
                <button
                  type="button"
                  onClick={() => setManageSpaces((v) => !v)}
                  className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-900 transition-colors"
                >
                  {manageSpaces ? (
                    <>
                      <X size={11} /> Done
                    </>
                  ) : (
                    <>
                      <Pencil size={11} /> Manage
                    </>
                  )}
                </button>
              </div>
              <select
                value={draft.spaceId}
                onChange={(e) => set('spaceId', e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
              >
                <option value="">No specific space</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.capacity ? ` (cap ${s.capacity})` : ''}
                  </option>
                ))}
              </select>

              {manageSpaces && (
                <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Customize spaces
                  </p>
                  {spaces.length === 0 && (
                    <p className="text-[11px] text-gray-500">No spaces yet. Add one below.</p>
                  )}
                  {spaces.map((s) => {
                    const isEditing = editingSpaceId === s.id;
                    return (
                      <div key={s.id} className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <input
                              type="color"
                              value={editSpaceDraft.color}
                              onChange={(e) =>
                                setEditSpaceDraft((d) => ({ ...d, color: e.target.value }))
                              }
                              className="h-7 w-7 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                              aria-label="Space color"
                            />
                            <input
                              value={editSpaceDraft.name}
                              onChange={(e) =>
                                setEditSpaceDraft((d) => ({ ...d, name: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void saveSpaceEdit(s.id);
                                }
                              }}
                              className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => void saveSpaceEdit(s.id)}
                              disabled={spaceBusy || !editSpaceDraft.name.trim()}
                              className="rounded-lg border border-gray-300 bg-white p-1.5 text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                              aria-label="Save"
                            >
                              <Check size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSpaceId(null)}
                              className="rounded-lg border border-gray-300 bg-white p-1.5 text-gray-700 hover:bg-gray-100"
                              aria-label="Cancel"
                            >
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span
                              className="inline-block h-3 w-3 flex-shrink-0 rounded-full border border-white shadow"
                              style={{ backgroundColor: s.color }}
                            />
                            <span className="flex-1 truncate text-sm text-gray-800">
                              {s.name}
                              {s.capacity ? (
                                <span className="ml-1 text-[11px] text-gray-400">cap {s.capacity}</span>
                              ) : null}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSpaceId(s.id);
                                setEditSpaceDraft({ name: s.name, color: s.color || '#6366f1' });
                              }}
                              className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                              aria-label="Edit space"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteSpace(s.id)}
                              disabled={spaceBusy}
                              className="rounded-lg border border-red-200 bg-white p-1.5 text-red-500 hover:bg-red-50 disabled:opacity-40"
                              aria-label="Delete space"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="color"
                      value={newSpaceColor}
                      onChange={(e) => setNewSpaceColor(e.target.value)}
                      className="h-7 w-7 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
                      aria-label="New space color"
                    />
                    <input
                      value={newSpaceName}
                      onChange={(e) => setNewSpaceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void createSpace();
                        }
                      }}
                      placeholder="New space name"
                      className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void createSpace()}
                      disabled={spaceBusy || !newSpaceName.trim()}
                      className="flex items-center gap-1 rounded-lg bg-gray-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <DraftField label="First name *" value={draft.firstName} onChange={(v) => set('firstName', v)} />
              <DraftField label="Last name *" value={draft.lastName} onChange={(v) => set('lastName', v)} />
            </div>
            <DraftField label="Email *" value={draft.email} type="email" onChange={(v) => set('email', v)} />
            <DraftField label="Phone *" value={draft.phone} type="tel" onChange={(v) => set('phone', v)} />
            <div className="grid grid-cols-2 gap-3">
              <DraftField
                label="Venue name"
                value={draft.venueName}
                onChange={(v) => set('venueName', v)}
              />
              <DraftField
                label="Venue website"
                value={draft.venueWebsiteUrl}
                type="url"
                onChange={(v) => set('venueWebsiteUrl', v)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DraftField
                label="Opportunity value"
                prefix={<DollarSign className="w-3.5 h-3.5 text-gray-400" />}
                value={draft.opportunityValue}
                type="number"
                onChange={(v) => set('opportunityValue', v)}
              />
              <DraftField
                label="Wedding date"
                value={draft.weddingDate}
                type="date"
                onChange={(v) => set('weddingDate', v)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DraftField
                label="Guest count"
                value={draft.guestCount}
                type="number"
                onChange={(v) => set('guestCount', v)}
              />
              <DraftField
                label="Booking timeline"
                value={draft.bookingTimeline}
                onChange={(v) => set('bookingTimeline', v)}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
                Message / inquiry
              </label>
              <textarea
                rows={3}
                value={draft.message}
                onChange={(e) => set('message', e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                Tags
              </label>
              <InlineTagPicker
                allTags={allTags}
                selectedIds={new Set(draft.tagIds)}
                onToggle={(tagId) => {
                  setDraft((prev) => {
                    const s = new Set(prev.tagIds);
                    if (s.has(tagId)) s.delete(tagId);
                    else s.add(tagId);
                    return { ...prev, tagIds: [...s] };
                  });
                }}
                onCreateTag={async (name) => {
                  const trimmed = name.trim();
                  if (!trimmed) return;
                  const res = await fetch('/api/marketing/tags', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: trimmed }),
                  });
                  const j = (await res.json().catch(() => ({}))) as {
                    tag?: MarketingTag;
                    error?: string;
                  };
                  if (!res.ok) {
                    alert(j.error || 'Could not create tag');
                    return;
                  }
                  const tag = j.tag;
                  if (!tag) return;
                  onVenueTagCreated(tag);
                  setDraft((prev) =>
                    prev.tagIds.includes(tag.id) ? prev : { ...prev, tagIds: [...prev.tagIds, tag.id] },
                  );
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
            <button
              onClick={onClose}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: '#1b1b1b' }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function DraftField({
  label,
  value,
  onChange,
  type = 'text',
  prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  prefix?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
        {label}
      </label>
      <div className="relative">
        {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2">{prefix}</span>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-xl border border-gray-200 ${prefix ? 'pl-7' : 'pl-3'} pr-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none`}
        />
      </div>
    </div>
  );
}

function InlineTagPicker({
  allTags,
  selectedIds,
  onToggle,
  onCreateTag,
}: {
  allTags: MarketingTag[];
  selectedIds: Set<string>;
  onToggle: (tagId: string) => void;
  onCreateTag: (name: string) => Promise<void>;
}) {
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  async function submitNew() {
    const n = newName.trim();
    if (!n) return;
    setSaving(true);
    try {
      await onCreateTag(n);
      setNewName('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {allTags.map((t) => {
            const on = selectedIds.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                title={t.name}
                onClick={() => onToggle(t.id)}
                className={`inline-flex max-w-[140px] items-center justify-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  on
                    ? 'border-brand-900 bg-brand-900 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-brand-900/30 hover:bg-brand-900/5 hover:text-brand-900'
                }`}
              >
                <span className="truncate">{t.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-[10px] text-gray-400">No tags yet — create one below.</p>
      )}
      <div className="flex gap-1.5 pt-0.5">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New tag name"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] focus:border-brand-900 focus:outline-none focus:ring-1 focus:ring-brand-900"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitNew();
          }}
        />
        <button
          type="button"
          disabled={saving || !newName.trim()}
          onClick={() => void submitNew()}
          className="shrink-0 rounded-lg bg-brand-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {saving ? '…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
