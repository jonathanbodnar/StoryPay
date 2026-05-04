'use client';

/**
 * Super-admin AI Concierge prompt-config editor.
 *
 * Layout:
 *   ┌─ Versions list (left, narrow)             ┌─ Editor pane (right, wide)
 *   │  v3  active  Mar 22                        │  Section tabs:
 *   │  v2          Mar 18                        │   Personality | Goals | Guardrails |
 *   │  v1          Mar 15                        │   Prohibited | Constraints (JSON) |
 *   │                                            │   Template | Notes
 *   │  + New version                             │
 *   │                                            │  Editor textareas
 *   │                                            │
 *   │                                            │  ┌─ Action bar ────────────────────
 *   │                                            │  │ [Save as new version] [Activate]
 *   │                                            │  │ [Preview prompt]      [Delete]
 *
 * Behaviour:
 *   - Selecting a version loads it into the editor (read-only by default).
 *   - "Edit" toggles the textareas to writable. They start off read-only so
 *     the operator can't accidentally type into the active prod prompt.
 *   - "Save as new version" POSTs a new row (clones from the selected
 *     version's id, overlays the operator's edits). Highlights the new
 *     version on completion.
 *   - "Activate this version" calls the atomic activate endpoint. Confirms
 *     first because this is a production change.
 *   - "Preview prompt" opens a modal that asks for a venueId + leadId, then
 *     renders the prompt against that real data — uses the in-progress
 *     edits if any.
 *
 * The active version gets a green "ACTIVE" pill in the list and a banner at
 * the top of the editor pane. Deleting the active version is forbidden by
 * the API; we mirror that by graying the Delete button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Copy, Edit2, Eye, FileCode2, Loader2,
  Lock, Plus, RotateCw, Save, Trash2, X as XIcon, Zap,
} from 'lucide-react';

// ── API types ─────────────────────────────────────────────────────────────

interface OutreachQuestion {
  text:      string;
  category?: string;
  priority?: number;
}

interface ConfigRow {
  id:                      string;
  version:                 number;
  is_active:               boolean;
  personality:             string;
  goals:                   string;
  guardrails:              string;
  prohibited_topics:       string;
  message_constraints:     Record<string, unknown>;
  system_prompt_template:  string;
  outreach_questions?:     OutreachQuestion[];
  notes:                   string | null;
  created_by:              string | null;
  created_at:              string;
  updated_at:              string;
}

interface ListPayload {
  rows:     ConfigRow[];
  activeId: string | null;
}

interface PreviewResponse {
  systemPrompt:  string;
  inputContext:  Record<string, unknown>;
  configVersion: number;
  configId:      string;
  isFromActive:  boolean;
}

type SectionKey =
  | 'personality' | 'goals' | 'guardrails' | 'prohibited_topics'
  | 'message_constraints' | 'system_prompt_template' | 'notes';

const SECTION_ORDER: { key: SectionKey; label: string; rows: number; mono?: boolean }[] = [
  { key: 'personality',            label: 'Personality',     rows: 8  },
  { key: 'goals',                  label: 'Goals',           rows: 6  },
  { key: 'guardrails',             label: 'Guardrails',      rows: 12 },
  { key: 'prohibited_topics',      label: 'Prohibited',      rows: 4  },
  { key: 'message_constraints',    label: 'Constraints',     rows: 6, mono: true },
  { key: 'system_prompt_template', label: 'Prompt template', rows: 24, mono: true },
  { key: 'notes',                  label: 'Notes',           rows: 3  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return '—'; }
}

function rowToFormState(r: ConfigRow): FormState {
  return {
    personality:            r.personality,
    goals:                  r.goals,
    guardrails:             r.guardrails,
    prohibited_topics:      r.prohibited_topics,
    message_constraints:    JSON.stringify(r.message_constraints ?? {}, null, 2),
    system_prompt_template: r.system_prompt_template,
    outreach_questions:     Array.isArray(r.outreach_questions) ? r.outreach_questions.map(cleanQuestion).filter(Boolean) as OutreachQuestion[] : [],
    notes:                  r.notes ?? '',
  };
}

function cleanQuestion(q: OutreachQuestion | null | undefined): OutreachQuestion | null {
  if (!q || typeof q.text !== 'string' || !q.text.trim()) return null;
  const out: OutreachQuestion = { text: q.text };
  if (q.category && typeof q.category === 'string') out.category = q.category;
  if (typeof q.priority === 'number') out.priority = q.priority;
  return out;
}

interface FormState {
  personality:             string;
  goals:                   string;
  guardrails:              string;
  prohibited_topics:       string;
  message_constraints:     string;       // JSON-as-text in the editor
  system_prompt_template:  string;
  outreach_questions:      OutreachQuestion[];
  notes:                   string;
}

interface FormStateDirty {
  personality:             boolean;
  goals:                   boolean;
  guardrails:              boolean;
  prohibited_topics:       boolean;
  message_constraints:     boolean;
  system_prompt_template:  boolean;
  outreach_questions:      boolean;
  notes:                   boolean;
}

function diffForm(base: FormState, current: FormState): FormStateDirty {
  return {
    personality:            base.personality            !== current.personality,
    goals:                  base.goals                  !== current.goals,
    guardrails:             base.guardrails             !== current.guardrails,
    prohibited_topics:      base.prohibited_topics      !== current.prohibited_topics,
    message_constraints:    base.message_constraints    !== current.message_constraints,
    system_prompt_template: base.system_prompt_template !== current.system_prompt_template,
    outreach_questions:     JSON.stringify(base.outreach_questions) !== JSON.stringify(current.outreach_questions),
    notes:                  base.notes                  !== current.notes,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

export function AiConciergeConfigEditor() {
  const [data, setData]               = useState<ListPayload | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [bootError, setBootError]     = useState('');

  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [editMode, setEditMode]       = useState(false);
  const [form, setForm]               = useState<FormState | null>(null);
  const [baseline, setBaseline]       = useState<FormState | null>(null);

  const [saving, setSaving]           = useState(false);
  const [activating, setActivating]   = useState(false);
  const [deleting, setDeleting]       = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Load list ─────────────────────────────────────────────────────────

  const load = useCallback(async (selectId?: string) => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/ai-concierge/configs', { cache: 'no-store' });
      const j   = await res.json().catch(() => ({})) as ListPayload & { error?: string; schemaMissing?: boolean };
      if (!res.ok) {
        if (j.schemaMissing) {
          setBootError('ai_config table missing. Run /api/admin/run-migration-098 then reload.');
          return;
        }
        setError(j.error ?? 'Failed to load versions');
        return;
      }
      setData(j);
      // Default selection: keep current, or pick activeId, or pick newest
      const next = selectId ?? selectedId ?? j.activeId ?? j.rows[0]?.id ?? null;
      setSelectedId(next);
      const row = j.rows.find((r) => r.id === next) ?? null;
      if (row) {
        const fs = rowToFormState(row);
        setForm(fs);
        setBaseline(fs);
        setEditMode(false);
      } else {
        setForm(null);
        setBaseline(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ── Selection ─────────────────────────────────────────────────────────

  const selectVersion = useCallback((id: string) => {
    if (!data) return;
    const row = data.rows.find((r) => r.id === id);
    if (!row) return;
    setSelectedId(id);
    const fs = rowToFormState(row);
    setForm(fs);
    setBaseline(fs);
    setEditMode(false);
  }, [data]);

  // ── Save as new version ──────────────────────────────────────────────

  const saveAsNew = useCallback(async () => {
    if (!form || !selectedId) return;

    // Validate JSON for message_constraints before sending
    let constraintsJson: Record<string, unknown>;
    try { constraintsJson = JSON.parse(form.message_constraints || '{}'); }
    catch (e) {
      setError(e instanceof Error ? `Invalid JSON in Constraints: ${e.message}` : 'Invalid JSON in Constraints');
      return;
    }
    if (typeof constraintsJson !== 'object' || Array.isArray(constraintsJson) || constraintsJson === null) {
      setError('Constraints must be a JSON object (not array / null / scalar)');
      return;
    }

    setSaving(true); setError('');
    try {
      const res = await fetch('/api/admin/ai-concierge/configs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          cloneFromVersionId:     selectedId,
          personality:            form.personality,
          goals:                  form.goals,
          guardrails:             form.guardrails,
          prohibited_topics:      form.prohibited_topics,
          message_constraints:    constraintsJson,
          system_prompt_template: form.system_prompt_template,
          outreach_questions:     form.outreach_questions,
          notes:                  form.notes || null,
        }),
      });
      const j = await res.json().catch(() => ({})) as { row?: ConfigRow; error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Save failed');
        return;
      }
      // Reload list and select the new version
      if (j.row) await load(j.row.id);
      setEditMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [form, selectedId, load]);

  // ── Activate selected version ────────────────────────────────────────

  const activate = useCallback(async () => {
    if (!selectedId || !data) return;
    const row = data.rows.find((r) => r.id === selectedId);
    if (!row) return;
    if (row.is_active) return;
    if (!confirm(`Activate version ${row.version}? The cron will start using this prompt within ~60 seconds.`)) return;

    setActivating(true); setError('');
    try {
      const res = await fetch(`/api/admin/ai-concierge/configs/${selectedId}/activate`, { method: 'POST' });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Activation failed');
        return;
      }
      await load(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed');
    } finally {
      setActivating(false);
    }
  }, [selectedId, data, load]);

  // ── Delete selected version ──────────────────────────────────────────

  const deleteSelected = useCallback(async () => {
    if (!selectedId || !data) return;
    const row = data.rows.find((r) => r.id === selectedId);
    if (!row) return;
    if (row.is_active) {
      setError('Cannot delete the active version. Activate another version first.');
      return;
    }
    if (!confirm(`Permanently delete version ${row.version}?`)) return;

    setDeleting(true); setError('');
    try {
      const res = await fetch(`/api/admin/ai-concierge/configs/${selectedId}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Delete failed');
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }, [selectedId, data, load]);

  // ── Derived state (must be computed unconditionally for hooks order) ──

  const dirty = useMemo<FormStateDirty | null>(() => {
    if (!form || !baseline) return null;
    return diffForm(baseline, form);
  }, [form, baseline]);

  const hasChanges = useMemo(() => {
    if (!dirty) return false;
    return Object.values(dirty).some(Boolean);
  }, [dirty]);

  // ── Render ────────────────────────────────────────────────────────────

  if (bootError) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="font-heading text-base text-amber-950">Schema not initialized</p>
            <p className="mt-1 text-sm text-amber-900/90">{bootError}</p>
          </div>
        </div>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  const selectedRow = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;
  const isSelectedActive = selectedRow?.is_active === true;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* ─── Versions list ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-heading text-sm text-gray-900">Versions</h2>
            <button type="button" onClick={() => void load()}
              className="rounded p-1 text-gray-400 hover:bg-gray-100"
              title="Refresh">
              <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {rows.length === 0 && !loading && (
              <p className="px-3 py-6 text-center text-xs text-gray-400">No versions yet.</p>
            )}
            {rows.map((r) => {
              const sel = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectVersion(r.id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                    sel
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono font-semibold text-gray-900">v{r.version}</span>
                    {r.is_active && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-800">
                        <CheckCircle2 size={9} /> active
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-400">{fmtDateTime(r.created_at)}</div>
                  {r.notes && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-gray-600">{r.notes}</p>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              // Start a new version from the currently selected one
              setEditMode(true);
            }}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 px-2 py-1.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
          >
            <Edit2 size={11} />
            Edit this version
          </button>
        </div>

        {/* ─── Editor pane ────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-gray-200 bg-white">
          {!selectedRow ? (
            <div className="p-8 text-center text-sm text-gray-400">
              {loading ? 'Loading…' : 'Select a version on the left to view it.'}
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-5 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <FileCode2 size={16} className="text-gray-500" />
                    <h2 className="font-heading text-base text-gray-900">
                      Version <span className="font-mono">{selectedRow.version}</span>
                    </h2>
                    {isSelectedActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                        <CheckCircle2 size={10} /> Active in production
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Created {fmtDateTime(selectedRow.created_at)} · last updated {fmtDateTime(selectedRow.updated_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!editMode ? (
                    <button
                      type="button"
                      onClick={() => setEditMode(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Edit2 size={12} />
                      Edit
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (hasChanges && !confirm('Discard your in-progress edits?')) return;
                        if (baseline) setForm(baseline);
                        setEditMode(false);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <XIcon size={12} />
                      Cancel edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Eye size={12} />
                    Preview prompt
                  </button>
                </div>
              </div>

              {isSelectedActive && editMode && (
                <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-900">
                  <Lock size={12} className="mt-0.5 shrink-0" />
                  <span>
                    You&apos;re editing the active production version. Saving creates a NEW version (the cron keeps running v{selectedRow.version} until you Activate the new one).
                  </span>
                </div>
              )}

              {/* Sections */}
              <div className="space-y-4 p-5">
                {form && SECTION_ORDER.map(({ key, label, rows: textRows, mono }) => {
                  const isDirty = dirty?.[key] === true;
                  return (
                    <Field
                      key={key}
                      label={label}
                      isDirty={isDirty && editMode}
                    >
                      <textarea
                        value={form[key]}
                        readOnly={!editMode}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        rows={textRows}
                        spellCheck={key === 'system_prompt_template' ? false : undefined}
                        className={`w-full rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                          mono ? 'font-mono text-[12px]' : ''
                        } ${editMode
                          ? 'border-gray-200 focus:border-gray-400 focus:outline-none'
                          : 'border-gray-100 bg-gray-50 text-gray-700'
                        } ${isDirty && editMode ? 'border-amber-300 ring-1 ring-amber-200' : ''}`}
                      />
                    </Field>
                  );
                })}

                {/* Outreach question pool (structured editor) */}
                {form && (
                  <OutreachQuestionsSection
                    questions={form.outreach_questions}
                    isDirty={dirty?.outreach_questions === true && editMode}
                    editMode={editMode}
                    onChange={(next) => setForm({ ...form, outreach_questions: next })}
                  />
                )}

                <div className="space-y-2 rounded-xl bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
                  <div>
                    <strong className="font-semibold text-gray-700">Available tokens</strong>
                    <span className="ml-1 text-gray-400">
                      — same dot-notation language as our email & form builders. Legacy
                      flat names still work for any older prompts.
                    </span>
                  </div>

                  <div>
                    <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-500">Venue</span>
                    <div className="font-mono text-gray-600">
                      {`{{venue.name}} {{venue.city}} {{venue.state}} {{venue.description}}`}
                    </div>
                  </div>

                  <div>
                    <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-500">Contact / Lead</span>
                    <div className="font-mono text-gray-600">
                      {`{{contact.first_name}} {{contact.full_name}} {{lead.wedding_date}} {{lead.created_at}} {{lead.time_since_inquiry}} {{lead.notes}}`}
                    </div>
                  </div>

                  <div>
                    <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-500">AI runtime</span>
                    <div className="font-mono text-gray-600">
                      {`{{ai.assistant_persona_name}} {{ai.attempt_number}} {{ai.angles_used_list}} {{ai.message_history_last_10}} {{ai.personality}} {{ai.goals}} {{ai.guardrails}} {{ai.prohibited_topics}} {{ai.outreach_questions}} {{ai.outreach_questions_grouped}}`}
                    </div>
                  </div>

                  <div>
                    <span className="font-semibold uppercase tracking-wide text-[10px] text-gray-500">System</span>
                    <div className="font-mono text-gray-600">
                      {`{{system.date}} {{system.year}}`}
                    </div>
                  </div>

                  <details className="pt-1">
                    <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                      Show legacy flat token names (still supported)
                    </summary>
                    <div className="mt-1 font-mono text-gray-500">
                      {`{{venue_name}} {{venue_city}} {{venue_state}} {{venue_style_description}} {{assistant_persona_name}} {{bride_first_name}} {{bride_full_name}} {{initial_inquiry_date}} {{time_since_initial_inquiry}} {{wedding_date_or_unknown}} {{bride_notes_or_none}} {{attempt_number}} {{angles_used_list}} {{message_history_last_10}} {{personality}} {{goals}} {{guardrails}} {{prohibited_topics}} {{outreach_questions}} {{outreach_questions_grouped}}`}
                    </div>
                  </details>
                </div>
              </div>

              {/* Action bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3">
                <div className="text-[11px] text-gray-500">
                  {editMode
                    ? (hasChanges
                        ? 'You have unsaved edits — saving creates a new version.'
                        : 'No changes yet.')
                    : 'Read-only view.'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveAsNew()}
                    disabled={!editMode || !hasChanges || saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save as new version
                  </button>
                  <button
                    type="button"
                    onClick={() => void activate()}
                    disabled={isSelectedActive || activating}
                    title={isSelectedActive ? 'Already active' : 'Atomically flip ACTIVE to this version'}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
                  >
                    {activating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                    {isSelectedActive ? 'Already active' : 'Activate this version'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSelected()}
                    disabled={isSelectedActive || deleting}
                    title={isSelectedActive ? 'Activate another version before deleting' : 'Permanently delete this version'}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                  >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Delete
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {previewOpen && form && selectedRow && (
        <PreviewModal
          configVersionId={selectedRow.id}
          // Pass the in-progress edits so preview reflects them BEFORE saving
          configOverride={editMode && hasChanges ? formToOverride(form) : null}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

function formToOverride(f: FormState): {
  personality:            string;
  goals:                  string;
  guardrails:             string;
  prohibited_topics:      string;
  message_constraints:    Record<string, unknown> | undefined;
  system_prompt_template: string;
  outreach_questions:     OutreachQuestion[];
} {
  let constraints: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(f.message_constraints || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) constraints = parsed;
  } catch { /* ignore — preview will use the saved version's constraints */ }
  return {
    personality:            f.personality,
    goals:                  f.goals,
    guardrails:             f.guardrails,
    prohibited_topics:      f.prohibited_topics,
    message_constraints:    constraints,
    system_prompt_template: f.system_prompt_template,
    outreach_questions:     f.outreach_questions,
  };
}

// ── Outreach questions section ────────────────────────────────────────────

const KNOWN_CATEGORIES = [
  // Tactical (ask the bride something concrete)
  'discovery', 'qualifying',
  // Asks (call-to-action variants)
  'cta', 'soft_cta',
  // Empathy (no ask, just connect)
  'check_in', 'reassurance', 'vibe',
  // Trust (handle objections about pricing / fit)
  'objection',
  // Catch-all
  'general',
] as const;

function OutreachQuestionsSection({
  questions, isDirty, editMode, onChange,
}: {
  questions:  OutreachQuestion[];
  isDirty:    boolean;
  editMode:   boolean;
  onChange:   (next: OutreachQuestion[]) => void;
}) {
  const [draftText, setDraftText]         = useState('');
  const [draftCategory, setDraftCategory] = useState<string>('discovery');

  const add = () => {
    const t = draftText.trim();
    if (!t) return;
    const next: OutreachQuestion = { text: t.slice(0, 280) };
    if (draftCategory) next.category = draftCategory;
    onChange([...questions, next]);
    setDraftText('');
  };

  const updateAt = (idx: number, patch: Partial<OutreachQuestion>) => {
    onChange(questions.map((q, i) => i === idx ? { ...q, ...patch } : q));
  };

  const removeAt = (idx: number) => {
    onChange(questions.filter((_, i) => i !== idx));
  };

  const moveBy = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Outreach question pool · {questions.length} {questions.length === 1 ? 'item' : 'items'}
        </label>
        {isDirty && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
            edited
          </span>
        )}
      </div>

      <div className={`rounded-lg border ${
        isDirty
          ? 'border-amber-300 ring-1 ring-amber-200'
          : editMode ? 'border-gray-200' : 'border-gray-100 bg-gray-50'
      }`}>
        <div className="px-3 py-2 text-[11px] text-gray-500 border-b border-gray-100">
          Curated list of question ideas the LLM can rephrase casually. Render in the prompt template via{' '}
          <code className="font-mono">{`{{outreach_questions}}`}</code> (flat list) or{' '}
          <code className="font-mono">{`{{outreach_questions_grouped}}`}</code> (grouped by category).
        </div>

        {questions.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] text-gray-400 italic">
            No questions yet. {editMode ? 'Add one below.' : 'Switch to edit mode to add some.'}
          </div>
        )}

        {questions.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {questions.map((q, idx) => (
              <li key={idx} className="grid grid-cols-[auto_1fr_140px_auto_auto] items-start gap-2 px-3 py-2">
                <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500">
                  {idx + 1}
                </span>
                <input
                  type="text"
                  value={q.text}
                  readOnly={!editMode}
                  onChange={(e) => updateAt(idx, { text: e.target.value })}
                  maxLength={280}
                  className={`min-w-0 rounded-md border px-2 py-1 text-[12px] ${
                    editMode
                      ? 'border-gray-200 focus:border-gray-400 focus:outline-none'
                      : 'border-transparent bg-transparent text-gray-700'
                  }`}
                />
                <select
                  value={q.category ?? 'general'}
                  disabled={!editMode}
                  onChange={(e) => updateAt(idx, { category: e.target.value })}
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    editMode
                      ? 'border-gray-200 bg-white focus:border-gray-400 focus:outline-none'
                      : 'border-transparent bg-transparent text-gray-500'
                  }`}
                >
                  {KNOWN_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={!editMode || idx === 0}
                    onClick={() => moveBy(idx, -1)}
                    className="rounded-md p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30"
                    title="Move up"
                  >▲</button>
                  <button
                    type="button"
                    disabled={!editMode || idx === questions.length - 1}
                    onClick={() => moveBy(idx, 1)}
                    className="rounded-md p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30"
                    title="Move down"
                  >▼</button>
                </div>
                <button
                  type="button"
                  disabled={!editMode}
                  onClick={() => removeAt(idx)}
                  className="rounded-md p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {editMode && (
          <div className="border-t border-gray-100 bg-gray-50/40 px-3 py-2">
            <div className="grid grid-cols-[1fr_140px_auto] gap-2">
              <input
                type="text"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                placeholder="e.g., What does your dream wedding day look like?"
                maxLength={280}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] focus:border-gray-400 focus:outline-none"
              />
              <select
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] focus:border-gray-400 focus:outline-none"
              >
                {KNOWN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={add}
                disabled={!draftText.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
              >
                <Plus size={11} />
                Add
              </button>
            </div>
            <p className="mt-1 text-[10px] text-gray-400">
              Categories help when using <code className="font-mono">{`{{outreach_questions_grouped}}`}</code>. Use the up/down arrows to control which questions surface earliest.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────

function Field({
  label, isDirty, children,
}: {
  label:    string;
  isDirty:  boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</label>
        {isDirty && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
            edited
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Preview modal ─────────────────────────────────────────────────────────

function PreviewModal({
  configVersionId, configOverride, onClose,
}: {
  configVersionId: string;
  configOverride:  ReturnType<typeof formToOverride> | null;
  onClose:         () => void;
}) {
  const [venueId, setVenueId]           = useState('');
  const [leadId, setLeadId]             = useState('');
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [running, setRunning]           = useState(false);
  const [result, setResult]             = useState<PreviewResponse | null>(null);
  const [error, setError]               = useState('');

  const run = useCallback(async () => {
    if (!venueId.trim() || !leadId.trim()) {
      setError('Venue ID and Lead ID are both required');
      return;
    }
    setRunning(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/admin/ai-concierge/configs/preview', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          venueId:         venueId.trim(),
          leadId:          leadId.trim(),
          attemptNumber,
          configVersionId: configOverride ? undefined : configVersionId,
          configOverride:  configOverride ?? undefined,
        }),
      });
      const j = await res.json().catch(() => ({})) as PreviewResponse & { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Preview failed');
        return;
      }
      setResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setRunning(false);
    }
  }, [venueId, leadId, attemptNumber, configOverride, configVersionId]);

  const copyPrompt = useCallback(async () => {
    if (!result?.systemPrompt) return;
    try {
      await navigator.clipboard.writeText(result.systemPrompt);
    } catch {
      // Fallback: select-all in a temporary textarea
    }
  }, [result]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center">
      <div className="relative my-8 w-full max-w-4xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-heading text-xl text-gray-900">Preview prompt</h2>
            <p className="mt-1 text-xs text-gray-500">
              Renders the system prompt against a real lead. No DB writes, no LLM calls, no SMS sends.
              {configOverride && <span className="ml-1 font-medium text-amber-700">(Using your unsaved edits.)</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <XIcon size={16} />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3 mb-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Venue ID</label>
            <input value={venueId} onChange={(e) => setVenueId(e.target.value)}
              placeholder="UUID" className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-[12px]" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Lead ID</label>
            <input value={leadId} onChange={(e) => setLeadId(e.target.value)}
              placeholder="UUID" className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-[12px]" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Attempt #</label>
            <input type="number" min={1} max={60} value={attemptNumber}
              onChange={(e) => setAttemptNumber(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="mb-4 flex items-center justify-end gap-2">
          {result && (
            <button type="button" onClick={() => void copyPrompt()}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              <Copy size={12} /> Copy prompt
            </button>
          )}
          <button type="button" disabled={running} onClick={() => void run()}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Render prompt
          </button>
        </div>

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>Rendered with version <span className="font-mono">{result.configVersion}</span></span>
              {result.isFromActive
                ? <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">active</span>
                : <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">override</span>}
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Rendered system prompt</label>
              <textarea
                value={result.systemPrompt}
                readOnly
                rows={20}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] leading-relaxed text-gray-800"
              />
            </div>

            <details className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Input context (what the cron would log to ai_runs.input_context)
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-[11px] text-gray-700">
                {JSON.stringify(result.inputContext, null, 2)}
              </pre>
            </details>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AiConciergeConfigEditor;
