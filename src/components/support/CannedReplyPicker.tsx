'use client';

/**
 * CannedReplyPicker — popover-style template picker.
 *
 * Used in both the admin support reply box and the venue conversations
 * composer. Loads templates via the appropriate listEndpoint, lets the user
 * type-filter them, and on click POSTs to the renderEndpoint to get a
 * merge-substituted body. Calls onInsert with the rendered text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, FileText, X } from 'lucide-react';

interface CannedReplyTemplate {
  id:        string;
  title:     string;
  body:      string;
  shortcut?: string | null;
  category?: string | null;
  channels:  ('sms' | 'email')[];
  use_count: number;
  scope?:    'admin' | 'venue' | 'both';
}

export interface CannedReplyPickerProps {
  open:           boolean;
  onClose:        () => void;
  /** Endpoint that returns { templates: CannedReplyTemplate[] } */
  listEndpoint:   string;
  /** Endpoint pattern; receives ${id} for the template, posted with { threadId, agentName? }. */
  renderEndpoint: (id: string) => string;
  /** Thread id to render against. */
  threadId:       string;
  /** Optional agent name passed to renderer (used to fill {{agent_name}}). */
  agentName?:     string;
  /** Channel constraint — only show templates that include this channel. */
  channel?:       'sms' | 'email';
  /** Called with the merge-rendered body. */
  onInsert:       (body: string) => void;
  /**
   * Horizontal alignment of the popover relative to its anchor.
   * 'right' (default) — right edge aligns with anchor, extends leftward.
   * 'left'            — left edge aligns with anchor, extends rightward.
   */
  align?:         'left' | 'right';
  /**
   * When true, the picker spans the full width of its positioned ancestor
   * (inset-x-0 w-auto) instead of a fixed w-80/w-96. Use when the relative
   * anchor is the entire toolbar row.
   */
  fullWidth?:     boolean;
}

export function CannedReplyPicker({
  open, onClose, listEndpoint, renderEndpoint, threadId, agentName, channel, onInsert,
  align = 'right', fullWidth = false,
}: CannedReplyPickerProps) {
  const [templates, setTemplates] = useState<CannedReplyTemplate[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [filter,    setFilter]    = useState('');
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (channel) params.set('channel', channel);
      const url = `${listEndpoint}${params.toString() ? `?${params.toString()}` : ''}`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `Failed (${r.status})`);
      }
      const d = (await r.json()) as { templates: CannedReplyTemplate[] };
      setTemplates(d.templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [listEndpoint, channel]);

  useEffect(() => {
    if (open) {
      loadTemplates();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setFilter('');
      setError(null);
    }
  }, [open, loadTemplates]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.body.toLowerCase().includes(q) ||
      (t.shortcut || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q),
    );
  }, [templates, filter]);

  const insert = useCallback(async (tpl: CannedReplyTemplate) => {
    setInsertingId(tpl.id);
    setError(null);
    try {
      const r = await fetch(renderEndpoint(tpl.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, agentName }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Render failed (${r.status})`);
      onInsert(d.body || '');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not insert template');
    } finally {
      setInsertingId(null);
    }
  }, [renderEndpoint, threadId, agentName, onInsert, onClose]);

  if (!open) return null;

  return (
    <div className={`absolute z-30 bottom-full mb-2 rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden ${fullWidth ? 'inset-x-0 w-auto' : align === 'left' ? 'left-0 w-80 sm:w-96' : 'right-0 w-80 sm:w-96'}`}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/60 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <FileText size={12} /> Saved replies
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={11} />
        </button>
      </div>

      <div className="border-b border-gray-200 px-3 py-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search title, body, /shortcut…"
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
          />
        </div>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 size={14} className="animate-spin" />
          </div>
        )}

        {error && (
          <div className="m-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="py-8 text-center text-[11px] text-gray-400 px-4">
            {templates.length === 0
              ? 'No saved replies yet.'
              : 'No replies match your search.'}
          </div>
        )}

        {filtered.map(tpl => {
          const previewLine = tpl.body.replace(/\s+/g, ' ').trim();
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => void insert(tpl)}
              disabled={insertingId !== null}
              className="w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-violet-50/40 transition-colors disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-semibold text-gray-900 truncate">{tpl.title}</span>
                  {tpl.shortcut && (
                    <span className="rounded bg-violet-100 text-violet-700 px-1 py-0.5 text-[9px] font-mono font-semibold shrink-0">
                      {tpl.shortcut}
                    </span>
                  )}
                </div>
                {insertingId === tpl.id ? (
                  <Loader2 size={11} className="animate-spin text-violet-600 shrink-0" />
                ) : (
                  <span className="text-[10px] text-gray-400 shrink-0">{tpl.use_count}× used</span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 line-clamp-2">{previewLine}</p>
              {tpl.category && (
                <span className="inline-block mt-1 rounded-full bg-gray-100 text-gray-600 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
                  {tpl.category}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
