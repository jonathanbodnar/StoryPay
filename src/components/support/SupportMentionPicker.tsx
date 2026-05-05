'use client';

/**
 * Pill-style multi-select for "@-mentioning" support team members on an
 * internal note. Email-notifies the selected teammates after the note posts.
 *
 * Kept deliberately simple: a search box that opens a dropdown of active
 * teammates, plus a row of removable pills underneath. We don't try to parse
 * @-syntax inside the textarea — explicit pills are unambiguous.
 */

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { AtSign, X, ChevronDown } from 'lucide-react';

interface SupportMember {
  id:     string;
  name:   string;
  email:  string;
  active: boolean;
  role?:  string;
}

interface Props {
  members:     SupportMember[];
  selectedIds: string[];
  onChange:    (ids: string[]) => void;
  /** id of the agent who's writing the note — auto-excluded from the dropdown. */
  selfId?:     string | null;
  /** Disable while a save is in flight. */
  disabled?:   boolean;
}

export function SupportMentionPicker({ members, selectedIds, onChange, selfId, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const eligible = useMemo(() => {
    return members.filter(m => m.active && m.id !== selfId);
  }, [members, selfId]);

  const byId = useMemo(() => {
    const m = new Map<string, SupportMember>();
    for (const x of members) m.set(x.id, x);
    return m;
  }, [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const remaining = eligible.filter(m => !selectedIds.includes(m.id));
    if (!q) return remaining;
    return remaining.filter(m =>
      m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [eligible, selectedIds, query]);

  function add(id: string) {
    onChange(Array.from(new Set([...selectedIds, id])));
    setQuery('');
  }
  function remove(id: string) {
    onChange(selectedIds.filter(x => x !== id));
  }

  return (
    <div className="space-y-1.5" ref={wrapRef}>
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedIds.map(id => {
          const m = byId.get(id);
          if (!m) return null;
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[11px] font-semibold"
            >
              <AtSign size={10} /> {m.name}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(id)}
                className="ml-0.5 -mr-0.5 hover:text-amber-700"
                aria-label={`Remove mention of ${m.name}`}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(v => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-amber-300 text-amber-800 hover:bg-amber-50 px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
        >
          <AtSign size={10} /> Mention
          <ChevronDown size={10} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>

      {open && (
        <div className="relative">
          <div className="absolute z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search teammates…"
                className="w-full text-xs px-2 py-1.5 outline-none"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-[11px] text-gray-400">
                  {eligible.length === 0 ? 'No teammates yet.' : 'No matches.'}
                </p>
              )}
              {filtered.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => add(m.id)}
                  className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b border-gray-50 last:border-b-0"
                >
                  <p className="text-xs font-semibold text-gray-900">{m.name}</p>
                  <p className="text-[10px] text-gray-500">{m.email}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
