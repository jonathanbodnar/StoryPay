'use client';

/**
 * SLA traffic-light components used throughout the support UI.
 *
 * SlaDot — small colored circle (8px) for inbox/ticket list rows.
 * SlaPill — full pill with label, used in headers + sidebars.
 *
 * Both compute their level from a timestamp via classifySla(). To keep them
 * accurate over time without a heartbeat polling loop, useNow() re-renders
 * once a minute. That's good enough for a 24/48/72-hour SLA scale where
 * sub-minute precision is irrelevant.
 */

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { classifySla, slaDotClass, slaDotRing, slaPillClass, type SlaInfo } from '@/lib/support/sla';

/** Auto-tick every 60s so the SLA dots/pills update without a page refresh. */
function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function SlaDot({
  iso,
  withLabel = false,
  className = '',
}: {
  iso: string | null | undefined;
  withLabel?: boolean;
  className?: string;
}) {
  useNow();
  const sla: SlaInfo = classifySla(iso);

  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      title={`${sla.description} · ${sla.label}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ring-2 ${slaDotClass(sla.level)} ${slaDotRing(sla.level)}`}
      />
      {withLabel && (
        <span className="text-[10px] tabular-nums text-gray-500">{sla.label}</span>
      )}
    </span>
  );
}

export function SlaPill({
  iso,
  size = 'md',
  className = '',
}: {
  iso: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}) {
  useNow();
  const sla: SlaInfo = classifySla(iso);

  const sizeCls = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-0.5 text-[11px]';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide ${sizeCls} ${slaPillClass(sla.level)} ${className}`}
      title={sla.description}
    >
      <Clock size={size === 'sm' ? 9 : 10} />
      {sla.label}
    </span>
  );
}
