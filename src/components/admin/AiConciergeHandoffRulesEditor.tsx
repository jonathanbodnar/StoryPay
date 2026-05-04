'use client';

/**
 * Super-admin handoff-rules editor.
 *
 * Three things in one panel:
 *
 *   1. **Regex tester** at the top.
 *      Operator pastes a sample inbound SMS and clicks "Test against all
 *      active rules" — we call /test which mirrors the inbound webhook's
 *      first-match-wins evaluation. Each row in the rules table also gets
 *      its own per-rule test indicator (green check or gray dot) so the
 *      operator sees at a glance which rule fired.
 *
 *   2. **Rules table** with reorder + activate + edit + delete.
 *      Reorder uses up/down arrow buttons (drag-and-drop is overkill for
 *      a list of ~20 rules). Active toggle is inline — click the chip,
 *      we PATCH { is_active } immediately.
 *
 *   3. **Create / edit modal** with full validation.
 *      Trigger value gets a "Test this regex" button that calls /test
 *      with the in-progress value (no DB write) so the operator can
 *      iterate on tricky regexes before saving.
 *
 * The handoff-rules cache TTL is 60s and the in-process cache is cleared
 * after every write — we surface that contract in a footer note so the
 * operator knows their change hits production within a minute (and
 * instantly on the same Node instance).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Edit2, Loader2,
  Play, Plus, RotateCw, Trash2, X as XIcon, XCircle, Filter,
  Info,
} from 'lucide-react';

// ── API types ─────────────────────────────────────────────────────────────

type RuleType    = 'keyword' | 'intent';
type ActionKey   = 'opt_out' | 'stop_and_handoff' | 'mark_not_interested';
type NotifyRole  = 'venue_owner' | 'concierge';

interface HandoffRule {
  id:             string;
  rule_type:      RuleType;
  trigger_value:  string;
  action:         ActionKey;
  notify_roles:   string[];
  tags_to_apply:  string[];
  pipeline_stage: string | null;
  is_active:      boolean;
  position:       number;
  description:    string | null;
  created_at:     string;
  updated_at:     string;
}

interface RulesPayload {
  rules: HandoffRule[];
  enums: {
    rule_types:   readonly RuleType[];
    actions:      readonly ActionKey[];
    notify_roles: readonly NotifyRole[];
    tags:         readonly string[];
    stages:       readonly string[];
  };
}

interface TestResponse {
  matched:       boolean;
  matchedText?:  string;
  matchIndex?:   number;
  ruleId?:       string;
  ruleType?:     RuleType;
  compileError?: string;
  evaluation?: Array<{
    ruleId:       string;
    description:  string | null;
    triggerValue: string;
    matched:      boolean;
    error?:       string;
  }>;
}

// ── Pretty-printer maps ───────────────────────────────────────────────────

const ACTION_LABELS: Record<ActionKey, { label: string; tone: 'rose' | 'amber' | 'gray' }> = {
  opt_out:             { label: 'Opt out (TCPA)',      tone: 'rose'  },
  stop_and_handoff:    { label: 'Stop + handoff',      tone: 'amber' },
  mark_not_interested: { label: 'Mark not interested', tone: 'gray'  },
};

const TAG_LABELS: Record<string, string> = {
  ai_active:         'AI active',
  ai_replied:        'Replied',
  ai_not_interested: 'Not interested',
  ai_needs_human:    'Needs human',
  ai_exhausted:      'Exhausted',
};

const STAGE_LABELS: Record<string, string> = {
  followup:             'Followup',
  conversation_started: 'Conversation started',
  not_interested:       'Not interested',
};

const NOTIFY_LABELS: Record<NotifyRole, string> = {
  venue_owner: 'Venue owner',
  concierge:   'Concierge team',
};

// ── Small UI atoms ────────────────────────────────────────────────────────

function ActionPill({ action }: { action: ActionKey }) {
  const spec = ACTION_LABELS[action];
  const tone = spec.tone === 'rose' ? 'bg-rose-50 text-rose-700' : spec.tone === 'amber' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-700';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{spec.label}</span>;
}

function Chip({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'emerald' | 'amber' | 'rose' | 'blue' }) {
  const map = {
    gray:    'bg-gray-100 text-gray-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber:   'bg-amber-50 text-amber-800',
    rose:    'bg-rose-50 text-rose-700',
    blue:    'bg-blue-50 text-blue-700',
  } as const;
  return <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${map[tone]}`}>{children}</span>;
}

// ── Main component ────────────────────────────────────────────────────────

export function AiConciergeHandoffRulesEditor() {
  const [data, setData]         = useState<RulesPayload | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [bootError, setBootError] = useState('');

  const [filterType, setFilterType] = useState<RuleType | ''>('');
  const [showInactive, setShowInactive] = useState(true);

  const [busyRuleId, setBusyRuleId] = useState<string>('');

  // Modal state
  const [editing, setEditing] = useState<HandoffRule | 'new' | null>(null);

  // Tester state (panel-level)
  const [testBody, setTestBody]       = useState('');
  const [testResult, setTestResult]   = useState<TestResponse | null>(null);
  const [testRunning, setTestRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/ai-concierge/handoff-rules', { cache: 'no-store' });
      const j   = await res.json().catch(() => ({})) as RulesPayload & { error?: string; schemaMissing?: boolean };
      if (!res.ok) {
        if (j.schemaMissing) {
          setBootError('handoff_rules table is missing. Run /api/admin/run-migration-098 then reload.');
          return;
        }
        setError(j.error ?? 'Failed to load rules');
        return;
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Mutations ─────────────────────────────────────────────────────────

  const patchRule = useCallback(async (id: string, patch: Partial<HandoffRule>) => {
    setBusyRuleId(id); setError('');
    try {
      const res = await fetch(`/api/admin/ai-concierge/handoff-rules/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });
      const j = await res.json().catch(() => ({})) as { rule?: HandoffRule; error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Update failed');
        return;
      }
      if (data && j.rule) {
        setData({ ...data, rules: data.rules.map((r) => r.id === id ? j.rule! : r) });
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyRuleId('');
    }
  }, [data, load]);

  const deleteRule = useCallback(async (id: string) => {
    if (!confirm('Permanently delete this rule? Disabled rules are skipped by the cron and are usually a better choice than deletion.')) return;
    setBusyRuleId(id); setError('');
    try {
      const res = await fetch(`/api/admin/ai-concierge/handoff-rules/${id}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? 'Delete failed');
        return;
      }
      if (data) setData({ ...data, rules: data.rules.filter((r) => r.id !== id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyRuleId('');
    }
  }, [data]);

  const reorder = useCallback(async (id: string, direction: 'up' | 'down') => {
    if (!data) return;
    const visible = visibleRules(data.rules, filterType, showInactive);
    const idx     = visible.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= visible.length) return;

    const newOrder = [...visible];
    [newOrder[idx], newOrder[swapWith]] = [newOrder[swapWith], newOrder[idx]];

    setBusyRuleId(id); setError('');
    try {
      const res = await fetch('/api/admin/ai-concierge/handoff-rules/reorder', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ order: newOrder.map((r) => r.id) }),
      });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!res.ok || j.ok === false) {
        setError(j.error ?? 'Reorder failed');
        return;
      }
      // Reload to pick up the renumbered positions
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reorder failed');
    } finally {
      setBusyRuleId('');
    }
  }, [data, filterType, showInactive, load]);

  // ── Tester ────────────────────────────────────────────────────────────

  const runTester = useCallback(async () => {
    if (!testBody.trim()) {
      setTestResult({ matched: false, compileError: 'Paste a sample SMS body first.' });
      return;
    }
    setTestRunning(true);
    try {
      const res = await fetch('/api/admin/ai-concierge/handoff-rules/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: testBody }),
      });
      const j = await res.json() as TestResponse;
      setTestResult(j);
    } catch (e) {
      setTestResult({ matched: false, compileError: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTestRunning(false);
    }
  }, [testBody]);

  // ── Save handler (used by modal) ──────────────────────────────────────

  const saveRule = useCallback(async (
    payload: Partial<HandoffRule>,
    mode: 'create' | 'edit',
    id?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    setError('');
    try {
      const url    = mode === 'create'
        ? '/api/admin/ai-concierge/handoff-rules'
        : `/api/admin/ai-concierge/handoff-rules/${id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({})) as { rule?: HandoffRule; error?: string };
      if (!res.ok) return { ok: false, error: j.error ?? 'Save failed' };
      await load();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Save failed' };
    }
  }, [load]);

  // ── Derived state (must come before any early return so the hooks order
  //    is stable across renders) ────────────────────────────────────────────

  const ruleMatchMap = useMemo(() => {
    const m = new Map<string, { matched: boolean; error?: string; isFirstMatch: boolean }>();
    if (testResult?.evaluation) {
      const firstMatchedId = testResult.matched ? testResult.ruleId : undefined;
      for (const e of testResult.evaluation) {
        m.set(e.ruleId, {
          matched: e.matched,
          error:   e.error,
          isFirstMatch: !!firstMatchedId && firstMatchedId === e.ruleId,
        });
      }
    }
    return m;
  }, [testResult]);

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

  const rules = data?.rules ?? [];
  const visible = visibleRules(rules, filterType, showInactive);

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <TesterCard
        body={testBody}
        onChangeBody={setTestBody}
        running={testRunning}
        onRun={runTester}
        result={testResult}
        onClear={() => { setTestBody(''); setTestResult(null); }}
      />

      {/* Filters + Add */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <Filter size={12} /> Filter:
        </span>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as RuleType | '')}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="">All types</option>
          <option value="keyword">Keyword (regex)</option>
          <option value="intent">Intent</option>
        </select>
        <label className="inline-flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Show disabled rules
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800"
          >
            <Plus size={12} />
            New rule
          </button>
        </div>
      </div>

      {/* Rules table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2.5 w-16">Order</th>
              <th className="px-3 py-2.5 w-12">Test</th>
              <th className="px-3 py-2.5">Type · Trigger</th>
              <th className="px-3 py-2.5">Action</th>
              <th className="px-3 py-2.5">Notify</th>
              <th className="px-3 py-2.5">Tags</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Active</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.length === 0 && !loading && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-gray-400">No rules match the current filter.</td></tr>
            )}
            {visible.map((r, idx) => {
              const busy = busyRuleId === r.id;
              const matchInfo = ruleMatchMap.get(r.id);
              return (
                <tr key={r.id} className="hover:bg-gray-50/60 align-top">
                  <td className="px-3 py-3 text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <span className="w-6 text-right tabular-nums">{r.position}</span>
                      <div className="flex flex-col gap-0.5">
                        <button type="button" disabled={busy || idx === 0} onClick={() => void reorder(r.id, 'up')}
                          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                          <ArrowUp size={11} />
                        </button>
                        <button type="button" disabled={busy || idx === visible.length - 1} onClick={() => void reorder(r.id, 'down')}
                          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 disabled:opacity-30">
                          <ArrowDown size={11} />
                        </button>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <RuleMatchIndicator info={matchInfo} ruleType={r.rule_type} />
                  </td>

                  <td className="px-3 py-3 max-w-md">
                    <div className="flex items-center gap-2">
                      {r.rule_type === 'keyword'
                        ? <Chip tone="blue">keyword</Chip>
                        : <Chip tone="emerald">intent</Chip>}
                      <code className="text-[12px] font-mono text-gray-800 break-all">{r.trigger_value}</code>
                    </div>
                    {r.description && <p className="mt-1 text-[11px] text-gray-500">{r.description}</p>}
                  </td>

                  <td className="px-3 py-3"><ActionPill action={r.action} /></td>

                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.notify_roles.length === 0
                        ? <span className="text-[11px] text-gray-300">—</span>
                        : r.notify_roles.map((role) => <Chip key={role}>{NOTIFY_LABELS[role as NotifyRole] ?? role}</Chip>)}
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.tags_to_apply.length === 0
                        ? <span className="text-[11px] text-gray-300">—</span>
                        : r.tags_to_apply.map((t) => <Chip key={t}>{TAG_LABELS[t] ?? t}</Chip>)}
                    </div>
                  </td>

                  <td className="px-3 py-3 text-xs text-gray-700">
                    {r.pipeline_stage ? <Chip tone="amber">{STAGE_LABELS[r.pipeline_stage] ?? r.pipeline_stage}</Chip> : <span className="text-[11px] text-gray-300">—</span>}
                  </td>

                  <td className="px-3 py-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void patchRule(r.id, { is_active: !r.is_active })}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                        r.is_active
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {r.is_active ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                      {r.is_active ? 'active' : 'disabled'}
                    </button>
                  </td>

                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button type="button" onClick={() => setEditing(r)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
                      <Edit2 size={11} /> Edit
                    </button>
                    <button type="button" disabled={busy} onClick={() => void deleteRule(r.id)}
                      className="ml-1 inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {loading && (
              <tr><td colSpan={9} className="px-3 py-6 text-center"><Loader2 size={16} className="inline animate-spin text-gray-400" /></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-400 inline-flex items-center gap-1">
        <Info size={11} />
        Rule changes propagate within ~60 seconds (cache TTL). The same Node instance picks them up immediately.
      </p>

      {/* Edit / create modal */}
      {editing !== null && data && (
        <RuleFormModal
          rule={editing === 'new' ? null : editing}
          enums={data.enums}
          onClose={() => setEditing(null)}
          onSave={saveRule}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function visibleRules(rules: HandoffRule[], filterType: RuleType | '', showInactive: boolean): HandoffRule[] {
  return rules.filter((r) => {
    if (filterType && r.rule_type !== filterType) return false;
    if (!showInactive && !r.is_active) return false;
    return true;
  });
}

// ── Sub-component: tester card ────────────────────────────────────────────

function TesterCard({
  body, onChangeBody, running, onRun, result, onClear,
}: {
  body:        string;
  onChangeBody:(v: string) => void;
  running:     boolean;
  onRun:       () => void;
  result:      TestResponse | null;
  onClear:     () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="font-heading text-base text-gray-900">Test inbound classifier</h2>
          <p className="mt-0.5 text-xs text-gray-500">Paste an inbound SMS the way a bride would write it. We&apos;ll evaluate every active keyword rule in priority order — first match wins.</p>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <button type="button" onClick={onClear} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
              <XIcon size={12} /> Clear
            </button>
          )}
          <button
            type="button"
            disabled={running || !body.trim()}
            onClick={onRun}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Test
          </button>
        </div>
      </div>

      <textarea
        value={body}
        onChange={(e) => onChangeBody(e.target.value)}
        placeholder="e.g. STOP texting me — I'm not interested anymore"
        rows={3}
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-400 focus:outline-none resize-none"
      />

      {result && (
        <div className={`mt-3 rounded-xl border p-3 text-sm ${result.matched ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
          {result.matched ? (
            <div className="space-y-1">
              <p className="font-medium">First match: rule <code className="rounded bg-white px-1 py-0.5 text-[11px] text-emerald-700">{result.ruleId?.slice(0, 8)}</code></p>
              {result.matchedText && (
                <p className="text-xs text-emerald-800/80">
                  Matched text: <em className="text-emerald-900">&ldquo;{result.matchedText}&rdquo;</em>
                </p>
              )}
              {result.evaluation && result.evaluation.some((e) => e.error) && (
                <p className="mt-2 text-xs text-amber-700">
                  Note: one or more rules had a regex compile error and were skipped (see indicator column below).
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-medium">No keyword rule matched.</p>
              {result.compileError
                ? <p className="text-xs text-rose-700">Compile error: {result.compileError}</p>
                : <p className="text-xs text-gray-500">Inbound would fall through to the LLM intent classifier.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuleMatchIndicator({ info, ruleType }: { info: { matched: boolean; error?: string; isFirstMatch: boolean } | undefined; ruleType: RuleType }) {
  if (ruleType === 'intent') return <span className="text-[10px] text-gray-300">n/a</span>;
  if (!info) return <span className="text-gray-200">·</span>;
  if (info.error) return <span title={info.error}><XCircle size={14} className="text-amber-500" /></span>;
  if (info.isFirstMatch) return <CheckCircle2 size={14} className="text-emerald-600" />;
  if (info.matched)      return <CheckCircle2 size={14} className="text-emerald-300" />;
  return <span className="text-gray-200">·</span>;
}

// ── Sub-component: form modal ─────────────────────────────────────────────

interface FormState {
  rule_type:      RuleType;
  trigger_value:  string;
  action:         ActionKey;
  notify_roles:   string[];
  tags_to_apply:  string[];
  pipeline_stage: string;     // '' = none
  is_active:      boolean;
  description:    string;
}

function RuleFormModal({
  rule, enums, onClose, onSave,
}: {
  rule:    HandoffRule | null;
  enums:   RulesPayload['enums'];
  onClose: () => void;
  onSave:  (payload: Partial<HandoffRule>, mode: 'create' | 'edit', id?: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const isEdit = rule !== null;
  const [state, setState] = useState<FormState>(() => rule ? toFormState(rule) : defaultFormState());
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const [previewBody, setPreviewBody]     = useState('');
  const [previewResult, setPreviewResult] = useState<TestResponse | null>(null);
  const [previewRunning, setPreviewRunning] = useState(false);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  }, []);

  const toggleArrayItem = useCallback((key: 'notify_roles' | 'tags_to_apply', item: string) => {
    setState((s) => {
      const list = s[key];
      const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
      return { ...s, [key]: next };
    });
  }, []);

  const validateLocal = useCallback((): string | null => {
    if (!state.trigger_value.trim()) return 'Trigger value is required';
    if (state.rule_type === 'keyword') {
      try { new RegExp(state.trigger_value, 'i'); }
      catch (e) { return e instanceof Error ? `Invalid regex: ${e.message}` : 'Invalid regex'; }
    }
    return null;
  }, [state]);

  const submit = useCallback(async () => {
    const v = validateLocal();
    if (v) { setError(v); return; }
    setSaving(true); setError('');
    const payload: Partial<HandoffRule> = {
      rule_type:      state.rule_type,
      trigger_value:  state.trigger_value.trim(),
      action:         state.action,
      notify_roles:   state.notify_roles,
      tags_to_apply:  state.tags_to_apply,
      pipeline_stage: state.pipeline_stage || null,
      is_active:      state.is_active,
      description:    state.description.trim() || null,
    };
    const r = await onSave(payload, isEdit ? 'edit' : 'create', rule?.id);
    setSaving(false);
    if (!r.ok) { setError(r.error ?? 'Save failed'); return; }
    onClose();
  }, [validateLocal, state, isEdit, rule, onSave, onClose]);

  // Live regex preview against an example body
  const runPreview = useCallback(async () => {
    if (!previewBody.trim() || state.rule_type !== 'keyword') return;
    setPreviewRunning(true);
    try {
      const res = await fetch('/api/admin/ai-concierge/handoff-rules/test', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: previewBody, triggerValue: state.trigger_value }),
      });
      const j = await res.json() as TestResponse;
      setPreviewResult(j);
    } catch (e) {
      setPreviewResult({ matched: false, compileError: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setPreviewRunning(false);
    }
  }, [previewBody, state.rule_type, state.trigger_value]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center">
      <div className="relative my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <h2 className="font-heading text-xl text-gray-900">{isEdit ? 'Edit handoff rule' : 'New handoff rule'}</h2>
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

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rule type">
              <select value={state.rule_type} onChange={(e) => update('rule_type', e.target.value as RuleType)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                {enums.rule_types.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>

            <Field label="Action on match">
              <select value={state.action} onChange={(e) => update('action', e.target.value as ActionKey)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                {enums.actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>)}
              </select>
            </Field>
          </div>

          <Field
            label={state.rule_type === 'keyword' ? 'Regex (case-insensitive)' : 'Intent key'}
            hint={state.rule_type === 'keyword'
              ? 'JavaScript regex. \\b for word boundaries. Example: \\b(stop|unsubscribe)\\b'
              : 'Lowercase identifier the LLM classifier will return, e.g. booked_elsewhere'}
          >
            <input value={state.trigger_value} onChange={(e) => update('trigger_value', e.target.value)}
              placeholder={state.rule_type === 'keyword' ? '\\b(price|pricing|cost)\\b' : 'booked_elsewhere'}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-[13px]" />
          </Field>

          {/* Inline regex tester (keyword only) */}
          {state.rule_type === 'keyword' && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Try this regex against an example</p>
              <div className="flex gap-2">
                <input value={previewBody} onChange={(e) => setPreviewBody(e.target.value)}
                  placeholder="Type a sample SMS body" className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm" />
                <button type="button" disabled={previewRunning || !previewBody.trim()} onClick={() => void runPreview()}
                  className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
                  {previewRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  Test
                </button>
              </div>
              {previewResult && (
                <div className="mt-2 text-xs">
                  {previewResult.compileError
                    ? <p className="text-rose-700">Compile error: {previewResult.compileError}</p>
                    : previewResult.matched
                      ? <p className="text-emerald-700">Matched: <em className="text-emerald-900">&ldquo;{previewResult.matchedText}&rdquo;</em></p>
                      : <p className="text-gray-600">No match.</p>}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Notify">
              <div className="flex flex-wrap gap-2">
                {enums.notify_roles.map((role) => {
                  const checked = state.notify_roles.includes(role);
                  return (
                    <button key={role} type="button" onClick={() => toggleArrayItem('notify_roles', role)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        checked ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}>
                      {NOTIFY_LABELS[role]}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Pipeline stage">
              <select value={state.pipeline_stage} onChange={(e) => update('pipeline_stage', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="">— none —</option>
                {enums.stages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Tags to apply">
            <div className="flex flex-wrap gap-2">
              {enums.tags.map((t) => {
                const checked = state.tags_to_apply.includes(t);
                return (
                  <button key={t} type="button" onClick={() => toggleArrayItem('tags_to_apply', t)}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      checked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    {TAG_LABELS[t] ?? t}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Description (optional)">
            <textarea value={state.description} onChange={(e) => update('description', e.target.value)}
              placeholder="Why this rule exists / what it&apos;s for"
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none" />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={state.is_active} onChange={(e) => update('is_active', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300" />
            Active (cron evaluates this rule)
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isEdit ? 'Save changes' : 'Create rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

function defaultFormState(): FormState {
  return {
    rule_type:      'keyword',
    trigger_value:  '',
    action:         'stop_and_handoff',
    notify_roles:   ['venue_owner'],
    tags_to_apply:  ['ai_replied', 'ai_needs_human'],
    pipeline_stage: 'conversation_started',
    is_active:      true,
    description:    '',
  };
}

function toFormState(r: HandoffRule): FormState {
  return {
    rule_type:      r.rule_type,
    trigger_value:  r.trigger_value,
    action:         r.action,
    notify_roles:   r.notify_roles,
    tags_to_apply:  r.tags_to_apply,
    pipeline_stage: r.pipeline_stage ?? '',
    is_active:      r.is_active,
    description:    r.description ?? '',
  };
}

export default AiConciergeHandoffRulesEditor;
