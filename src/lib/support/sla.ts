/**
 * SLA traffic-light helper.
 *
 * Rule (per product spec):
 *   <24h since last activity → GREEN  (fresh)
 *   24–48h                   → YELLOW (needs attention)
 *   48–72h                   → RED    (overdue)
 *   >72h                     → CRITICAL (deeply overdue)
 *
 * The "last activity" we measure is the last message timestamp on the thread/
 * ticket — whoever sent it. In the bride inbox the latest message is always
 * an inbound from the bride (that's how the inbox is filtered), so the light
 * effectively shows how long the bride has been waiting for a reply.
 *
 * Pure functions — safe to call from any component on every render.
 */

export type SlaLevel = 'green' | 'yellow' | 'red' | 'critical';

export interface SlaInfo {
  level:       SlaLevel;
  hours:       number;
  /** Short label like "12h", "1d 4h", "3d ago". */
  label:       string;
  /** Human reason for tooltips. */
  description: string;
}

const HOUR = 3_600_000;

const THRESHOLDS = {
  yellow:   24,
  red:      48,
  critical: 72,
} as const;

const LABELS: Record<SlaLevel, string> = {
  green:    'Fresh — under 24h',
  yellow:   '24–48h since last activity',
  red:      '48–72h since last activity',
  critical: 'Over 72h since last activity',
};

const DOT_BG: Record<SlaLevel, string> = {
  green:    'bg-emerald-500',
  yellow:   'bg-amber-400',
  red:      'bg-orange-500',
  critical: 'bg-red-600',
};

const PILL_CLS: Record<SlaLevel, string> = {
  green:    'border-emerald-200 bg-emerald-50 text-emerald-800',
  yellow:   'border-amber-200 bg-amber-50 text-amber-800',
  red:      'border-orange-200 bg-orange-50 text-orange-800',
  critical: 'border-red-200 bg-red-50 text-red-800',
};

const DOT_RING: Record<SlaLevel, string> = {
  green:    'ring-emerald-200',
  yellow:   'ring-amber-200',
  red:      'ring-orange-200',
  critical: 'ring-red-200 animate-pulse',
};

export function classifySla(iso: string | null | undefined): SlaInfo {
  if (!iso) {
    return { level: 'green', hours: 0, label: '—', description: 'No activity yet' };
  }
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) {
    return { level: 'green', hours: 0, label: '—', description: 'Unknown' };
  }
  const hours = Math.max(0, (Date.now() - t) / HOUR);

  let level: SlaLevel = 'green';
  if (hours >= THRESHOLDS.critical) level = 'critical';
  else if (hours >= THRESHOLDS.red) level = 'red';
  else if (hours >= THRESHOLDS.yellow) level = 'yellow';

  return {
    level,
    hours,
    label:       formatLabel(hours),
    description: LABELS[level],
  };
}

function formatLabel(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${Math.max(1, mins)}m`;
  }
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const remH = Math.round(hours - days * 24);
  if (days < 7) {
    return remH === 0 ? `${days}d` : `${days}d ${remH}h`;
  }
  return `${days}d`;
}

// ── Tailwind class helpers ────────────────────────────────────────────────

export function slaDotClass(level: SlaLevel): string {
  return DOT_BG[level];
}

export function slaDotRing(level: SlaLevel): string {
  return DOT_RING[level];
}

export function slaPillClass(level: SlaLevel): string {
  return PILL_CLS[level];
}
