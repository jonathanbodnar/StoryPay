'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Users, X, Search } from 'lucide-react';
import type { CampaignSegment } from '@/lib/marketing-email-schema';

export interface AudiencePickerTag {
  id: string;
  name: string;
}

export interface AudiencePickerStage {
  id: string;
  name: string;
  pipeline_id: string;
  pipelineName: string;
  kind?: string;
}

export interface AudiencePickerTriggerLink {
  id: string;
  name: string;
}

export interface AudiencePickerSavedSegment {
  id: string;
  name: string;
  description?: string;
}

export interface AudiencePickerProps {
  /** Current segment value (controlled) */
  value: CampaignSegment;
  onChange: (next: CampaignSegment) => void;
  disabled?: boolean;

  tags: AudiencePickerTag[];
  stages: AudiencePickerStage[];
  triggerLinks: AudiencePickerTriggerLink[];

  /** Saved segments available to pick from. Pass `undefined` (or omit) to
   * hide the "Saved segment" radio entirely — used by the segment editor
   * itself, since a segment can't reference another segment. */
  savedSegments?: AudiencePickerSavedSegment[];

  /** When true, hides the saved-segment option even if `savedSegments` is
   * provided. (Convenience flag for the segment-editor surface.) */
  hideSavedSegmentOption?: boolean;

  /** Show the recipient-count preview chip. Defaults to true. */
  showPreview?: boolean;
}

const PREVIEW_DEBOUNCE_MS = 600;

/** Reusable audience picker. Drives the segment_json shape used by both
 * marketing campaigns and saved segments. Behavior filters (exclude
 * stages, require wedding date, trigger-link clicks, exclude booked
 * stages) compose on top of any audience type. */
export function AudiencePicker({
  value,
  onChange,
  disabled = false,
  tags,
  stages,
  triggerLinks,
  savedSegments,
  hideSavedSegmentOption = false,
  showPreview = true,
}: AudiencePickerProps): React.JSX.Element {
  const allowSaved = !hideSavedSegmentOption && Array.isArray(savedSegments);

  function set(next: Partial<CampaignSegment>) {
    onChange({ ...value, ...next });
  }

  function setType(type: CampaignSegment['type']) {
    if (type === 'tags_any') {
      onChange({ ...value, type: 'tags_any', tag_ids: value.tag_ids ?? [] });
    } else if (type === 'stages') {
      onChange({ ...value, type: 'stages', stage_ids: value.stage_ids ?? [] });
    } else if (type === 'saved_segment') {
      onChange({ ...value, type: 'saved_segment', saved_segment_id: value.saved_segment_id ?? '' });
    } else if (type === 'specific_contacts') {
      onChange({ ...value, type: 'specific_contacts', contact_emails: value.contact_emails ?? [] });
    } else {
      onChange({ ...value, type: 'all_leads' });
    }
  }

  function toggleArray(field: 'tag_ids' | 'stage_ids' | 'exclude_stage_ids' | 'booked_stage_ids' | 'clicked_trigger_link_ids', id: string) {
    const cur = (value[field] as string[] | undefined) ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ [field]: next } as Partial<CampaignSegment>);
  }

  // ── Contact search (for specific_contacts type) ───────────────────────────
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState<{ id: string; name: string; email: string }[]>([]);
  const [contactSearchBusy, setContactSearchBusy] = useState(false);
  const contactSearchRef = useRef<HTMLInputElement>(null);

  const searchContacts = useCallback(async (q: string) => {
    if (!q.trim()) { setContactResults([]); return; }
    setContactSearchBusy(true);
    try {
      const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=8`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as { data?: { id: string; name: string; email: string }[] } | { id: string; name: string; email: string }[];
      const items = Array.isArray(data) ? data : (data as { data?: { id: string; name: string; email: string }[] }).data ?? [];
      setContactResults(items.filter((c) => c.email));
    } catch { /* noop */ } finally {
      setContactSearchBusy(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void searchContacts(contactQuery), 300);
    return () => clearTimeout(t);
  }, [contactQuery, searchContacts]);

  function addContactEmail(email: string) {
    const norm = email.trim().toLowerCase();
    const cur = value.contact_emails ?? [];
    if (!cur.includes(norm)) {
      onChange({ ...value, type: 'specific_contacts', contact_emails: [...cur, norm] });
    }
    setContactQuery('');
    setContactResults([]);
    contactSearchRef.current?.focus();
  }

  function removeContactEmail(email: string) {
    onChange({ ...value, contact_emails: (value.contact_emails ?? []).filter((e) => e !== email) });
  }

  // ── Recipient-count preview ────────────────────────────────────────────────
  const [count, setCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);
  const lastReqRef = useRef(0);
  const stableSegment = useMemo(() => JSON.stringify(value), [value]);
  useEffect(() => {
    if (!showPreview) return;
    const reqId = ++lastReqRef.current;
    setLoadingCount(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/marketing/segments/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: stableSegment ? `{"segment":${stableSegment}}` : '{}',
        });
        if (reqId !== lastReqRef.current) return;
        if (res.ok) {
          const j = (await res.json()) as { count?: number };
          setCount(typeof j.count === 'number' ? j.count : null);
        } else {
          setCount(null);
        }
      } catch {
        if (reqId === lastReqRef.current) setCount(null);
      } finally {
        if (reqId === lastReqRef.current) setLoadingCount(false);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [stableSegment, showPreview]);

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name="seg"
          className="mt-1"
          checked={value.type === 'all_leads'}
          disabled={disabled}
          onChange={() => setType('all_leads')}
        />
        <span>
          <span className="font-medium text-gray-900">All leads</span>
          <span className="ml-2 text-xs text-gray-500">
            Every contact with an email, excluding unsubscribes and marketing opt-outs.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-2">
        <input
          type="radio"
          name="seg"
          className="mt-1"
          checked={value.type === 'tags_any'}
          disabled={disabled}
          onChange={() => setType('tags_any')}
        />
        <span>
          <span className="font-medium text-gray-900">Any of these tags</span>
          <span className="ml-2 text-xs text-gray-500">Lead has at least one of the selected tags.</span>
        </span>
      </label>
      {value.type === 'tags_any' ? (
        <div className="ml-6 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <p className="text-xs text-gray-500">No tags yet. Create tags from Marketing → Trigger links & tags.</p>
          ) : null}
          {tags.map((t) => {
            const checked = (value.tag_ids ?? []).includes(t.id);
            return (
              <label
                key={t.id}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                  checked ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  disabled={disabled}
                  checked={checked}
                  onChange={() => toggleArray('tag_ids', t.id)}
                />
                {t.name}
              </label>
            );
          })}
        </div>
      ) : null}

      <label className="flex items-start gap-2">
        <input
          type="radio"
          name="seg"
          className="mt-1"
          checked={value.type === 'stages'}
          disabled={disabled}
          onChange={() => setType('stages')}
        />
        <span>
          <span className="font-medium text-gray-900">In any of these pipeline stages</span>
          <span className="ml-2 text-xs text-gray-500">Lead is currently in one of the selected stages.</span>
        </span>
      </label>
      {value.type === 'stages' ? (
        <div className="ml-6 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/60 p-2 text-xs">
          {stages.length === 0 ? (
            <p className="text-gray-500">No pipeline stages yet.</p>
          ) : null}
          {stages.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-white">
              <input
                type="checkbox"
                disabled={disabled}
                checked={(value.stage_ids ?? []).includes(s.id)}
                onChange={() => toggleArray('stage_ids', s.id)}
              />
              <span className="text-gray-500">{s.pipelineName}:</span>
              <span className="text-gray-800">{s.name}</span>
            </label>
          ))}
        </div>
      ) : null}

      {allowSaved ? (
        <>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="seg"
              className="mt-1"
              checked={value.type === 'saved_segment'}
              disabled={disabled}
              onChange={() => setType('saved_segment')}
            />
            <span>
              <span className="font-medium text-gray-900">Use a saved audience</span>
              <span className="ml-2 text-xs text-gray-500">
                Reusable audience defined under Marketing → Audiences. Editing an audience updates this campaign automatically.
              </span>
            </span>
          </label>
          {value.type === 'saved_segment' ? (
            <div className="ml-6">
              {(savedSegments ?? []).length === 0 ? (
                <p className="text-xs text-gray-500">
                  No saved audiences yet —{' '}
                  <a
                    href="/dashboard/marketing/email/audiences"
                    className="font-medium text-gray-900 underline-offset-2 hover:underline"
                  >
                    create your first audience
                  </a>
                  .
                </p>
              ) : (
                <select
                  className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  value={value.saved_segment_id ?? ''}
                  disabled={disabled}
                  onChange={(e) => set({ saved_segment_id: e.target.value })}
                >
                  <option value="">Select a saved segment…</option>
                  {(savedSegments ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {/* ── Specific contacts ───────────────────────────────────────────── */}
      <label className="flex items-start gap-2">
        <input
          type="radio"
          name="seg"
          className="mt-1"
          checked={value.type === 'specific_contacts'}
          disabled={disabled}
          onChange={() => setType('specific_contacts')}
        />
        <span>
          <span className="font-medium text-gray-900">Specific contacts</span>
          <span className="ml-2 text-xs text-gray-500">Hand-pick people one at a time by name or email.</span>
        </span>
      </label>
      {value.type === 'specific_contacts' && (
        <div className="ml-6 space-y-2">
          {/* Selected pills */}
          {(value.contact_emails ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(value.contact_emails ?? []).map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800"
                >
                  {email}
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => removeContactEmail(email)}
                      className="ml-0.5 rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                      aria-label={`Remove ${email}`}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Search input */}
          {!disabled && (
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={contactSearchRef}
                type="text"
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-xs text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                autoComplete="off"
              />
              {contactSearchBusy && (
                <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />
              )}

              {/* Results dropdown */}
              {contactResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                  {contactResults.map((c) => {
                    const already = (value.contact_emails ?? []).includes(c.email.toLowerCase());
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={already}
                        onClick={() => addContactEmail(c.email)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                          already
                            ? 'cursor-default bg-gray-50 text-gray-400'
                            : 'hover:bg-gray-50 text-gray-800'
                        }`}
                      >
                        <span className="truncate font-medium">{c.name || c.email}</span>
                        <span className="shrink-0 text-gray-400">{c.email}</span>
                        {already && <span className="shrink-0 text-[10px] text-gray-400">Added</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {(value.contact_emails ?? []).length === 0 && !contactQuery && (
            <p className="text-xs text-gray-400">Search for contacts above to add them.</p>
          )}
        </div>
      )}

      {/* ── Behavior & filters ─────────────────────────────────────────── */}
      <div className="mt-4 space-y-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/80 p-3">
        <p className="text-xs font-semibold text-gray-700">Behavior &amp; filters</p>
        <p className="text-[11px] text-gray-500">
          Narrow any audience: require a wedding date, exclude stages, require past trigger-link clicks, or exclude
          “booked” stages.
        </p>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            disabled={disabled}
            className="mt-0.5"
            checked={value.require_wedding_date === true}
            onChange={(e) => set({ require_wedding_date: e.target.checked || undefined })}
          />
          <span>Only leads with a wedding date on file</span>
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            disabled={disabled}
            className="mt-0.5"
            checked={value.require_not_booked === true}
            onChange={(e) => set({ require_not_booked: e.target.checked || undefined })}
          />
          <span>Exclude leads in booked / won stages (pick which stages count as booked below)</span>
        </label>
        {value.require_not_booked ? (
          <div className="ml-1 max-h-32 space-y-1 overflow-y-auto border-l-2 border-gray-200 pl-2">
            <p className="text-[10px] font-medium uppercase text-gray-400">Booked stages</p>
            {stages.map((s) => (
              <label key={`booked-${s.id}`} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={(value.booked_stage_ids ?? []).includes(s.id)}
                  onChange={() => toggleArray('booked_stage_ids', s.id)}
                />
                <span className="text-gray-600">{s.pipelineName}:</span> {s.name}
                {s.kind ? <span className="text-gray-400">({s.kind})</span> : null}
              </label>
            ))}
          </div>
        ) : null}
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase text-gray-400">Exclude stages</p>
          <div className="max-h-28 space-y-1 overflow-y-auto text-[11px]">
            {stages.map((s) => (
              <label key={`ex-${s.id}`} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={(value.exclude_stage_ids ?? []).includes(s.id)}
                  onChange={() => toggleArray('exclude_stage_ids', s.id)}
                />
                <span className="text-gray-600">{s.pipelineName}:</span> {s.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase text-gray-400">Clicked any of these trigger links</p>
          {triggerLinks.length === 0 ? (
            <p className="text-[11px] text-gray-500">No trigger links yet.</p>
          ) : (
            <div className="max-h-28 space-y-1 overflow-y-auto text-[11px]">
              {triggerLinks.map((tl) => (
                <label key={tl.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={(value.clicked_trigger_link_ids ?? []).includes(tl.id)}
                    onChange={() => toggleArray('clicked_trigger_link_ids', tl.id)}
                  />
                  {tl.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {showPreview ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700">
          {loadingCount ? (
            <>
              <Loader2 size={12} className="animate-spin text-gray-400" />
              Calculating…
            </>
          ) : (
            <>
              <Users size={12} className="text-gray-500" />
              {count === null ? '—' : count.toLocaleString()} eligible{' '}
              {count === 1 ? 'recipient' : 'recipients'}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
