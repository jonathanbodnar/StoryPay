'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Loader2, Check, AlertTriangle, Wallet, Lock } from 'lucide-react';
import { useAutoSaveDoc } from '@/lib/use-auto-save-doc';
import {
  BUDGET_CATEGORIES,
  budgetTotals,
  starterBudget,
  newBudgetId,
  type BudgetCategory,
  type BudgetLine,
  type WeddingBudget,
} from '@/lib/wedding-budget';

type SaveResult = { ok: boolean; conflict?: boolean; budget?: WeddingBudget };

interface BudgetTrackerProps {
  initial: WeddingBudget;
  onSave: (next: WeddingBudget) => Promise<SaveResult>;
}

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Parse a currency-ish string into a number (strip $ , spaces). */
function parseMoney(v: string): number {
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const MONEY_FIELD =
  'w-full rounded-lg border border-gray-200 px-2.5 py-2 text-right text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300';

export default function BudgetTracker({ initial, onSave }: BudgetTrackerProps) {
  const { doc, update, saving, savedFlash, conflict, error } = useAutoSaveDoc<WeddingBudget>(
    initial,
    async (next) => {
      const res = await onSave(next);
      return { ok: res.ok, conflict: res.conflict, doc: res.budget };
    },
  );

  const [addCategory, setAddCategory] = useState<BudgetCategory>('Venue');
  const totals = useMemo(() => budgetTotals(doc), [doc]);

  function setTarget(v: string) {
    update((prev) => ({ ...prev, target: parseMoney(v) }));
  }

  function addLine() {
    const line: BudgetLine = {
      id: newBudgetId(),
      category: addCategory,
      label: '',
      estimated: 0,
      actual: 0,
      paid: false,
      note: null,
    };
    update((prev) => ({ ...prev, lines: [...prev.lines, line] }), { immediate: true });
  }

  function patch(id: string, p: Partial<BudgetLine>, immediate = false) {
    update((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) }), { immediate });
  }

  function remove(id: string) {
    update((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.id !== id) }), { immediate: true });
  }

  function applyStarter() {
    update((prev) => ({ ...prev, lines: [...prev.lines, ...starterBudget()] }), { immediate: true });
  }

  const overTarget = doc.target > 0 && totals.actual > doc.target;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <Wallet className="h-5 w-5 text-gray-400" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Budget</p>
            <p className="flex items-center gap-1 text-xs text-gray-500">
              <Lock className="h-3 w-3" /> Private — only you can see this
            </p>
          </div>
        </div>
        <SaveStatus saving={saving} savedFlash={savedFlash} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
        <Stat label="Target" value={doc.target > 0 ? usd(doc.target) : '—'} />
        <Stat label="Estimated" value={usd(totals.estimated)} />
        <Stat label="Actual" value={usd(totals.actual)} accent={overTarget ? 'red' : undefined} />
        <Stat
          label={doc.target > 0 ? 'Remaining' : 'Paid'}
          value={doc.target > 0 ? usd(totals.remaining) : usd(totals.paid)}
          accent={doc.target > 0 && totals.remaining < 0 ? 'red' : undefined}
        />
      </div>

      {/* Target input */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <label className="text-sm text-gray-500">Overall target</label>
        <input
          value={doc.target ? String(doc.target) : ''}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="$0"
          inputMode="decimal"
          className="w-32 rounded-lg border border-gray-200 px-2.5 py-2 text-right text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>

      {conflict && (
        <div className="mx-4 mb-1 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          Your budget was updated in another tab. We refreshed it — please re-apply your change.
        </div>
      )}
      {error && (
        <div className="mx-4 mb-1 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {/* Add row */}
      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-3">
        <select
          value={addCategory}
          onChange={(e) => setAddCategory(e.target.value as BudgetCategory)}
          className="rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          {BUDGET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addLine}
          className="inline-flex items-center gap-1 rounded-xl bg-[#1b1b1b] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-85"
        >
          <Plus className="h-4 w-4" /> Add line
        </button>
      </div>

      {/* Lines — mobile card layout (below sm) */}
      {doc.lines.length > 0 && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-3 sm:hidden">
          {doc.lines.map((l) => (
            <div key={l.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start gap-2">
                <select
                  value={l.category}
                  onChange={(e) => patch(l.id, { category: e.target.value as BudgetCategory }, true)}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  {BUDGET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => remove(l.id)}
                  className="shrink-0 rounded-lg p-2 text-gray-300 hover:bg-gray-50 hover:text-red-500"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                value={l.label}
                onChange={(e) => patch(l.id, { label: e.target.value })}
                placeholder="Optional note"
                className="mt-2 w-full min-w-0 rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Estimated</span>
                  <input
                    value={l.estimated ? String(l.estimated) : ''}
                    onChange={(e) => patch(l.id, { estimated: parseMoney(e.target.value) })}
                    placeholder="$0"
                    inputMode="decimal"
                    className={MONEY_FIELD}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">Actual</span>
                  <input
                    value={l.actual ? String(l.actual) : ''}
                    onChange={(e) => patch(l.id, { actual: parseMoney(e.target.value) })}
                    placeholder="$0"
                    inputMode="decimal"
                    className={MONEY_FIELD}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => patch(l.id, { paid: !l.paid }, true)}
                aria-label={l.paid ? 'Mark unpaid' : 'Mark paid'}
                className={`mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  l.paid ? 'border-[#1b1b1b] bg-[#1b1b1b] text-white' : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                }`}
              >
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded-md border ${l.paid ? 'border-white' : 'border-gray-300'}`}>
                  {l.paid && <Check className="h-3 w-3" />}
                </span>
                Paid
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lines — desktop table (sm and up) */}
      {doc.lines.length > 0 && (
        <div className="hidden overflow-x-auto border-t border-gray-100 sm:block">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2">Category</th>
                <th className="px-2 py-2">Item</th>
                <th className="px-2 py-2 text-right">Estimated</th>
                <th className="px-2 py-2 text-right">Actual</th>
                <th className="px-2 py-2 text-center">Paid</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {doc.lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2">
                    <select
                      value={l.category}
                      onChange={(e) => patch(l.id, { category: e.target.value as BudgetCategory }, true)}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    >
                      {BUDGET_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={l.label}
                      onChange={(e) => patch(l.id, { label: e.target.value })}
                      placeholder="Optional note"
                      className="w-full min-w-[120px] rounded-lg border border-gray-200 px-2.5 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={l.estimated ? String(l.estimated) : ''}
                      onChange={(e) => patch(l.id, { estimated: parseMoney(e.target.value) })}
                      placeholder="$0"
                      inputMode="decimal"
                      className={MONEY_FIELD}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={l.actual ? String(l.actual) : ''}
                      onChange={(e) => patch(l.id, { actual: parseMoney(e.target.value) })}
                      placeholder="$0"
                      inputMode="decimal"
                      className={MONEY_FIELD}
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => patch(l.id, { paid: !l.paid }, true)}
                      aria-label={l.paid ? 'Mark unpaid' : 'Mark paid'}
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
                        l.paid ? 'border-[#1b1b1b] bg-[#1b1b1b] text-white' : 'border-gray-300 bg-white hover:border-gray-400'
                      }`}
                    >
                      {l.paid && <Check className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(l.id)}
                      className="rounded-lg p-1.5 text-gray-300 hover:bg-gray-50 hover:text-red-500"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {doc.lines.length === 0 && (
        <div className="border-t border-gray-100 px-4 py-8 text-center">
          <Wallet className="mx-auto h-8 w-8 text-gray-200" />
          <p className="mt-2 text-sm text-gray-500">No budget lines yet.</p>
          <button
            type="button"
            onClick={applyStarter}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Plus className="h-4 w-4" /> Start with common categories
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'red' }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${accent === 'red' ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
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
