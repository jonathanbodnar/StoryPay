'use client';

/**
 * Per-contact AI Concierge controls for /dashboard/contacts/[id].
 *
 * Self-fetching component: pass it the linkedLeadId and it loads its own
 * snapshot from /api/dashboard/leads/[leadId]/ai. Renders nothing if the
 * lead isn't linked or the GET 404s (which is fine — not every contact
 * has a lead row).
 *
 * Visual states (driven entirely by the server-computed snapshot):
 *
 *   dormant + no first activation     → "AI hasn't started yet" (info only)
 *   dormant + cooldown after re-enable→ "Resumes in N hours" (info only)
 *   ai_active                          → green pill + Pause AI button
 *   paused                             → amber pill + Re-enable AI button
 *   handoff                            → red pill ("Needs human") + Re-enable button
 *   opted_out (non-TCPA)               → gray pill + Re-enable button
 *   opted_out + TCPA                   → red pill + locked button + STOP explainer
 *   exhausted (within 60d)             → orange pill + Re-enable button
 *   exhausted (past 60d)               → orange pill + locked button + cap explainer
 *
 * The buttons NEVER lie. Eligibility blockers come back from the server in
 * `reEnableBlockers` and we surface them in the disabled-state tooltip. If
 * the venue toggle is off entirely, the whole section is hidden.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Sparkles, Loader2, AlertCircle, Pause, RotateCw, Lock,
  Clock, X as XIcon,
} from 'lucide-react';

// ── Snapshot shape (mirrors the API) ───────────────────────────────────────

type AiState =
  | 'dormant'
  | 'ai_active'
  | 'paused'
  | 'handoff'
  | 'opted_out'
  | 'exhausted';

interface AiContactSnapshot {
  leadId:                string;
  state:                 AiState;
  firstActivatedAt:      string | null;
  expiresAt:             string | null;
  nextSendAt:            string | null;
  reEnabledAt:           string | null;
  reEnableCount:         number;
  attemptCount:          number;
  smsDnd:                boolean;
  smsDndSource:          string | null;
  smsDndAt:              string | null;
  canReEnable:           boolean;
  canPause:              boolean;
  isTcpaLocked:          boolean;
  isExpired60d:          boolean;
  hoursUntilCooldownEnd: number | null;
  reEnableBlockers:      string[];
  venueEligible:         boolean;
  venueAiEnabled:        boolean;
}

// ── Pill catalog ───────────────────────────────────────────────────────────

interface PillSpec {
  label:  string;
  bg:     string;
  fg:     string;
  border: string;
  icon:   ReactNode;
}

function pillFor(state: AiState, snap: AiContactSnapshot): PillSpec {
  switch (state) {
    case 'ai_active':
      return {
        label: 'AI active',
        bg: 'bg-emerald-50', fg: 'text-emerald-700', border: 'border-emerald-200',
        icon: <Sparkles size={12} className="text-emerald-600" />,
      };
    case 'paused':
      return {
        label: 'AI paused',
        bg: 'bg-amber-50', fg: 'text-amber-700', border: 'border-amber-200',
        icon: <Pause size={12} className="text-amber-600" />,
      };
    case 'handoff':
      return {
        label: 'Needs human attention',
        bg: 'bg-rose-50', fg: 'text-rose-700', border: 'border-rose-200',
        icon: <AlertCircle size={12} className="text-rose-600" />,
      };
    case 'opted_out':
      return {
        label: snap.isTcpaLocked ? 'Opted out (STOP)' : 'Not interested',
        bg: snap.isTcpaLocked ? 'bg-rose-50' : 'bg-gray-100',
        fg: snap.isTcpaLocked ? 'text-rose-700' : 'text-gray-700',
        border: snap.isTcpaLocked ? 'border-rose-200' : 'border-gray-200',
        icon: snap.isTcpaLocked
          ? <Lock size={12} className="text-rose-600" />
          : <XIcon size={12} className="text-gray-500" />,
      };
    case 'exhausted':
      return {
        label: 'Follow-up exhausted',
        bg: 'bg-orange-50', fg: 'text-orange-700', border: 'border-orange-200',
        icon: <Clock size={12} className="text-orange-600" />,
      };
    case 'dormant':
    default: {
      // Two flavors: post-re-enable cooldown (informative) vs never-activated
      if (snap.reEnabledAt && snap.hoursUntilCooldownEnd) {
        return {
          label: `Resumes in ${snap.hoursUntilCooldownEnd}h`,
          bg: 'bg-blue-50', fg: 'text-blue-700', border: 'border-blue-200',
          icon: <Clock size={12} className="text-blue-600" />,
        };
      }
      return {
        label: 'AI dormant',
        bg: 'bg-gray-50', fg: 'text-gray-600', border: 'border-gray-200',
        icon: <Sparkles size={12} className="text-gray-400" />,
      };
    }
  }
}

// ── Date helpers (UI only) ─────────────────────────────────────────────────

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  /** Lead UUID — null when the contact has no linked lead, in which case
   *  this component renders nothing. */
  leadId: string | null;
  /** Optional className to merge into the outer card. */
  className?: string;
}

export function ContactAiControls({ leadId, className }: Props) {
  const [snap, setSnap]         = useState<AiContactSnapshot | null>(null);
  const [loading, setLoading]   = useState(false);
  const [acting, setActing]     = useState<null | 're_enable' | 'pause'>(null);
  const [error, setError]       = useState<string>('');
  const [hidden, setHidden]     = useState(false); // 404 / venue not eligible

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/dashboard/leads/${leadId}/ai`, { cache: 'no-store' });
      if (res.status === 404) { setHidden(true); return; }
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? `Failed to load AI status (${res.status})`);
        return;
      }
      const next = await res.json() as AiContactSnapshot;
      setSnap(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AI status');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (action: 're_enable' | 'pause') => {
    if (!leadId || acting) return;
    setActing(action); setError('');
    try {
      const res = await fetch(`/api/dashboard/leads/${leadId}/ai`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      });
      const j = await res.json().catch(() => ({})) as Partial<AiContactSnapshot> & { error?: string; blockers?: string[] };
      if (!res.ok) {
        const msg = (j.blockers && j.blockers.length > 0)
          ? `${j.error ?? 'Action failed'} — ${j.blockers.join('; ')}`
          : (j.error ?? 'Action failed');
        setError(msg);
        return;
      }
      // The POST returns the fresh snapshot
      setSnap(j as AiContactSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActing(null);
    }
  }, [leadId, acting]);

  // ── Render guards ────────────────────────────────────────────────────────

  if (!leadId) return null;
  if (hidden)  return null;

  // Loading shell
  if (!snap && loading) {
    return (
      <div className={`rounded-2xl border border-gray-200 bg-white p-5 ${className ?? ''}`}>
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">Loading AI status…</span>
        </div>
      </div>
    );
  }
  if (!snap) {
    return error
      ? (
        <div className={`rounded-2xl border border-amber-200 bg-amber-50 p-5 ${className ?? ''}`}>
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      )
      : null;
  }

  // Hide the whole card when the venue hasn't turned AI on at all — no value
  // showing per-contact AI controls when the feature is globally off.
  if (!snap.venueAiEnabled && snap.state === 'dormant' && !snap.firstActivatedAt) {
    return null;
  }

  const pill = pillFor(snap.state, snap);
  const reEnableBlocked = !snap.canReEnable;
  const pauseBlocked    = !snap.canPause;

  // Should we show the re-enable button? Only when state is in a "stopped"
  // bucket (anything but ai_active/dormant). If state is ai_active we show
  // pause instead. Dormant states show neither (just info).
  const showReEnableButton =
    ['paused', 'handoff', 'opted_out', 'exhausted'].includes(snap.state);
  const showPauseButton = snap.state === 'ai_active';

  // Days remaining inside the 60-day cap (null until first activation)
  const daysLeftInCap = daysUntil(snap.expiresAt);

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-5 ${className ?? ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-gray-500" />
          <h2 className="font-heading text-base text-gray-900">AI Concierge</h2>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${pill.bg} ${pill.fg} ${pill.border}`}>
            {pill.icon}
            {pill.label}
          </span>
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <Stat label="Messages sent"  value={snap.attemptCount.toString()} />
        <Stat label="Re-enables"     value={snap.reEnableCount.toString()} />
        <Stat
          label="60-day cap"
          value={
            snap.firstActivatedAt
              ? (snap.isExpired60d
                  ? 'Reached'
                  : (daysLeftInCap !== null ? `${Math.max(0, daysLeftInCap)}d left` : '—'))
              : 'Not started'
          }
        />
        <Stat
          label="Next send"
          value={
            snap.state === 'ai_active' || (snap.state === 'dormant' && snap.reEnabledAt)
              ? fmtDateTime(snap.nextSendAt)
              : '—'
          }
        />
      </div>

      {/* State-specific explainer */}
      <StateExplainer snap={snap} />

      {/* Action buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {showReEnableButton && (
          <button
            type="button"
            disabled={reEnableBlocked || acting !== null}
            title={reEnableBlocked ? snap.reEnableBlockers.join(' · ') : 'Reset to dormant; AI will resume after a 24-hour cooldown'}
            onClick={() => void act('re_enable')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              reEnableBlocked
                ? 'cursor-not-allowed border border-gray-200 bg-gray-50 text-gray-400'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            {acting === 're_enable'
              ? <Loader2 size={14} className="animate-spin" />
              : reEnableBlocked
                ? <Lock size={14} />
                : <RotateCw size={14} />}
            Re-enable AI
          </button>
        )}

        {showPauseButton && (
          <button
            type="button"
            disabled={pauseBlocked || acting !== null}
            title="Stop the AI from sending any more messages to this contact"
            onClick={() => void act('pause')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              pauseBlocked
                ? 'cursor-not-allowed border border-gray-200 bg-gray-50 text-gray-400'
                : 'border border-gray-200 bg-white text-gray-900 hover:bg-gray-50'
            }`}
          >
            {acting === 'pause' ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
            Pause AI
          </button>
        )}

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || acting !== null}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Blocker list (only shown when re-enable is blocked AND we tried to render the button) */}
      {showReEnableButton && reEnableBlocked && snap.reEnableBlockers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-gray-500">
          {snap.reEnableBlockers.map((b) => (
            <li key={b} className="flex items-start gap-1.5">
              <XIcon size={11} className="mt-0.5 shrink-0 text-gray-400" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}

function StateExplainer({ snap }: { snap: AiContactSnapshot }) {
  const cls = 'rounded-lg border px-3 py-2 text-xs';

  if (snap.isTcpaLocked) {
    return (
      <div className={`${cls} border-rose-200 bg-rose-50 text-rose-900`}>
        <strong className="block mb-0.5">SMS opt-out (TCPA)</strong>
        This contact replied with a STOP keyword on {fmtDateTime(snap.smsDndAt)}. Federal law (TCPA)
        prohibits any further automated SMS unless they reply START or otherwise re-consent in writing.
        AI cannot be re-enabled.
      </div>
    );
  }

  if (snap.isExpired60d && snap.state === 'exhausted') {
    return (
      <div className={`${cls} border-orange-200 bg-orange-50 text-orange-900`}>
        <strong className="block mb-0.5">60-day follow-up window reached</strong>
        AI ran for 60 days starting {fmtDateTime(snap.firstActivatedAt)} and reached its hard cap.
        Per policy this cap is global per contact and cannot be reset.
      </div>
    );
  }

  switch (snap.state) {
    case 'ai_active':
      return (
        <div className={`${cls} border-emerald-200 bg-emerald-50 text-emerald-900`}>
          <strong className="block mb-0.5">AI is messaging this contact</strong>
          The next message is scheduled for {fmtDateTime(snap.nextSendAt)}.
          Pause AI if you want to take over the conversation manually.
        </div>
      );
    case 'paused':
      return (
        <div className={`${cls} border-amber-200 bg-amber-50 text-amber-900`}>
          <strong className="block mb-0.5">AI is paused after a reply</strong>
          The contact replied (or you paused manually). AI will not send any more messages until
          you re-enable it. Re-enabling enforces a 24-hour cooldown before the next send.
        </div>
      );
    case 'handoff':
      return (
        <div className={`${cls} border-rose-200 bg-rose-50 text-rose-900`}>
          <strong className="block mb-0.5">Needs human attention</strong>
          The reply triggered a handoff rule (e.g. lawyer, manager, refund). Reach out personally —
          if you resolve it and want AI to follow up later, click Re-enable AI.
        </div>
      );
    case 'opted_out':
      return (
        <div className={`${cls} border-gray-200 bg-gray-50 text-gray-700`}>
          <strong className="block mb-0.5">Marked not interested</strong>
          The contact's reply was classified as negative intent. You can re-enable AI if you have
          new context (e.g. they changed their mind), but only do so if appropriate.
        </div>
      );
    case 'exhausted':
      return (
        <div className={`${cls} border-orange-200 bg-orange-50 text-orange-900`}>
          <strong className="block mb-0.5">Follow-up exhausted</strong>
          AI sent the maximum number of attempts inside the 60-day window without a reply. You can
          re-enable AI if you want to try one more cadence — only if the cap is still open.
        </div>
      );
    case 'dormant': {
      if (snap.reEnabledAt) {
        return (
          <div className={`${cls} border-blue-200 bg-blue-50 text-blue-900`}>
            <strong className="block mb-0.5">Re-enabled — cooldown in progress</strong>
            AI was re-enabled on {fmtDateTime(snap.reEnabledAt)}. The first message will go out
            after the 24-hour cooldown ({fmtDateTime(snap.nextSendAt)}).
          </div>
        );
      }
      return (
        <div className={`${cls} border-gray-200 bg-gray-50 text-gray-600`}>
          <strong className="block mb-0.5">AI hasn't started yet</strong>
          AI Concierge activates automatically after 14 days of silence following an outbound message.
          {snap.venueAiEnabled
            ? ' Just keep messaging the contact normally.'
            : ' (AI Concierge is currently turned off for this venue — toggle it on in Settings → AI Concierge.)'}
        </div>
      );
    }
    default:
      return null;
  }
}

ContactAiControls.displayName = 'ContactAiControls';

export default ContactAiControls;
