'use client';

/**
 * Consistent per-agent avatar colors, used everywhere an agent's identity
 * shows up in the support inbox: message sender avatars, the presence pill,
 * and @-mention chips. The color is a pure hash of the agent's id (falls
 * back to name) so the same person always gets the same color across every
 * thread and every browser session — no DB column needed.
 */

const PALETTE: Array<{ bg: string; text: string; ring: string }> = [
  { bg: 'bg-rose-100',    text: 'text-rose-700',    ring: 'ring-rose-200' },
  { bg: 'bg-orange-100',  text: 'text-orange-700',  ring: 'ring-orange-200' },
  { bg: 'bg-amber-100',   text: 'text-amber-700',   ring: 'ring-amber-200' },
  { bg: 'bg-lime-100',    text: 'text-lime-700',    ring: 'ring-lime-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  { bg: 'bg-teal-100',    text: 'text-teal-700',    ring: 'ring-teal-200' },
  { bg: 'bg-sky-100',     text: 'text-sky-700',     ring: 'ring-sky-200' },
  { bg: 'bg-indigo-100',  text: 'text-indigo-700',  ring: 'ring-indigo-200' },
  { bg: 'bg-violet-100',  text: 'text-violet-700',  ring: 'ring-violet-200' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200' },
  { bg: 'bg-pink-100',    text: 'text-pink-700',    ring: 'ring-pink-200' },
  { bg: 'bg-cyan-100',    text: 'text-cyan-700',    ring: 'ring-cyan-200' },
];

/** djb2-ish string hash — stable across sessions/browsers, no crypto needed. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Returns a stable Tailwind color triple for a given agent id (or name as fallback). */
export function avatarColorFor(idOrName: string | null | undefined): { bg: string; text: string; ring: string } {
  const key = (idOrName || 'unknown').trim().toLowerCase();
  const idx = hashString(key) % PALETTE.length;
  return PALETTE[idx];
}

export function initialsFor(name: string | null | undefined): string {
  const n = (name || '').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZE_CLS = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
} as const;

export function AgentAvatar({
  id,
  name,
  size = 'sm',
  className = '',
}: {
  /** Stable identifier (support_team_members.id) — falls back to name for hashing if omitted. */
  id?: string | null;
  name: string | null | undefined;
  size?: keyof typeof SIZE_CLS;
  className?: string;
}) {
  const colors = avatarColorFor(id || name);
  return (
    <span
      title={name || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-1 ${colors.bg} ${colors.text} ${colors.ring} ${SIZE_CLS[size]} ${className}`}
    >
      {initialsFor(name)}
    </span>
  );
}
