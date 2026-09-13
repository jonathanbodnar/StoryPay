'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Loader2, Check, AlertTriangle, ListChecks, CalendarClock } from 'lucide-react';
import { useAutoSaveDoc } from '@/lib/use-auto-save-doc';
import {
  starterChecklist,
  daysUntil,
  newChecklistId,
  type ChecklistItem,
  type WeddingChecklist,
} from '@/lib/wedding-checklist';

type SaveResult = { ok: boolean; conflict?: boolean; checklist?: WeddingChecklist };

interface ChecklistEditorProps {
  initial: WeddingChecklist;
  onSave: (next: WeddingChecklist) => Promise<SaveResult>;
  /** "YYYY-MM-DD" — powers the countdown + starter-template due dates. */
  weddingDate?: string | null;
  /** "couple" | "venue" — tweaks helper copy only. */
  audience?: 'couple' | 'venue';
}

const DATE_INPUT =
  'rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300';

function fmtDue(d: string): string {
  if (!d) return '';
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ChecklistEditor({ initial, onSave, weddingDate, audience = 'couple' }: ChecklistEditorProps) {
  const { doc, update, saving, savedFlash, conflict, error } = useAutoSaveDoc<WeddingChecklist>(
    initial,
    async (next) => {
      const res = await onSave(next);
      return { ok: res.ok, conflict: res.conflict, doc: res.checklist };
    },
  );

  const [newTitle, setNewTitle] = useState('');

  const countdown = daysUntil(weddingDate);
  const { done, total, pct } = useMemo(() => {
    const t = doc.items.length;
    const d = doc.items.filter((i) => i.done).length;
    return { done: d, total: t, pct: t ? Math.round((d / t) * 100) : 0 };
  }, [doc.items]);

  function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    const item: ChecklistItem = { id: newChecklistId(), title, dueDate: '', done: false, note: null };
    update((prev) => ({ ...prev, items: [...prev.items, item] }), { immediate: true });
    setNewTitle('');
  }

  function patchItem(id: string, patch: Partial<ChecklistItem>, immediate = false) {
    update(
      (prev) => ({ ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
      { immediate },
    );
  }

  function removeItem(id: string) {
    update((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }), { immediate: true });
  }

  function applyStarter() {
    update((prev) => ({ ...prev, items: [...prev.items, ...starterChecklist(weddingDate)] }), { immediate: true });
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      {/* Header: countdown + progress */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <ListChecks className="h-5 w-5 text-gray-400" />
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {done} of {total} done
            </p>
            {countdown != null && (
              <p className="flex items-center gap-1 text-xs text-gray-500">
                <CalendarClock className="h-3.5 w-3.5" />
                {countdown > 0
                  ? `${countdown} day${countdown === 1 ? '' : 's'} until the wedding`
                  : countdown === 0
                    ? 'The big day is today!'
                    : 'Congratulations on your wedding!'}
              </p>
            )}
          </div>
        </div>
        <SaveStatus saving={saving} savedFlash={savedFlash} />
      </div>

      {total > 0 && (
        <div className="px-4 pt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-[#1b1b1b] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {conflict && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          {audience === 'venue' ? 'The couple' : 'Your venue'} updated the checklist. We refreshed it — please re-apply your change.
        </div>
      )}
      {error && (
        <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Add row */}
      <div className="flex items-center gap-2 px-4 py-3">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTask();
            }
          }}
          placeholder="Add a task…"
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
        <button
          type="button"
          onClick={addTask}
          disabled={!newTitle.trim()}
          className="inline-flex items-center gap-1 rounded-xl bg-[#1b1b1b] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      {/* List */}
      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {doc.items.map((item) => {
          const overdue = !item.done && item.dueDate && daysUntilDate(item.dueDate) < 0;
          return (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                onClick={() => patchItem(item.id, { done: !item.done }, true)}
                aria-label={item.done ? 'Mark not done' : 'Mark done'}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                  item.done ? 'border-[#1b1b1b] bg-[#1b1b1b] text-white' : 'border-gray-300 bg-white hover:border-gray-400'
                }`}
              >
                {item.done && <Check className="h-3.5 w-3.5" />}
              </button>
              <input
                value={item.title}
                onChange={(e) => patchItem(item.id, { title: e.target.value })}
                className={`min-w-0 flex-1 border-none bg-transparent p-0 text-sm focus:outline-none focus:ring-0 ${
                  item.done ? 'text-gray-400 line-through' : 'text-gray-900'
                }`}
              />
              <input
                type="date"
                value={item.dueDate}
                onChange={(e) => patchItem(item.id, { dueDate: e.target.value }, true)}
                style={{ accentColor: '#1b1b1b' }}
                className={`${DATE_INPUT} ${overdue ? 'border-red-300 text-red-600' : ''} shrink-0`}
                title={item.dueDate ? `Due ${fmtDue(item.dueDate)}` : 'Set a due date'}
              />
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-gray-50 hover:text-red-500"
                aria-label="Remove task"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>

      {total === 0 && (
        <div className="px-4 py-8 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-gray-200" />
          <p className="mt-2 text-sm text-gray-500">No tasks yet.</p>
          <button
            type="button"
            onClick={applyStarter}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" /> Add a standard planning checklist
          </button>
        </div>
      )}
    </div>
  );
}

function daysUntilDate(d: string): number {
  const parsed = new Date(`${d}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parsed.getTime() - today.getTime()) / 86_400_000);
}

function SaveStatus({ saving, savedFlash }: { saving: boolean; savedFlash: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400">
      {saving ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </>
      ) : savedFlash ? (
        <span className="flex items-center gap-1 text-emerald-600">
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      ) : null}
    </div>
  );
}
