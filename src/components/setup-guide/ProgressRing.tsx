import { GraduationCap } from 'lucide-react';

/**
 * Setup progress as a green ring around the guide's icon: on the guide's bar
 * at the top of every dashboard page, and on its entry in the sidebar, so the
 * venue sees how far along it is wherever it is. (On the bar it was first a
 * green line along the bottom edge; the bar's rounded corners clipped it.)
 */
export default function ProgressRing({ done, total, size = 32 }: { done: number; total: number; size?: number }) {
  const r = 14;
  const round = 2 * Math.PI * r;
  const part = total ? Math.min(1, Math.max(0, done / total)) : 0;
  const disc = Math.round(size * 0.6875);
  return (
    <span
      aria-hidden
      data-testid="setup-guide-progress"
      data-progress={`${done}/${total}`}
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" strokeWidth="2.5" className="stroke-gray-200" />
        <circle
          cx="16" cy="16" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round"
          className="stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
          strokeDasharray={round}
          strokeDashoffset={round * (1 - part)}
        />
      </svg>
      <span className="flex items-center justify-center rounded-full bg-[#1b1b1b] text-white" style={{ width: disc, height: disc }}>
        <GraduationCap size={Math.round(size * 0.375)} />
      </span>
    </span>
  );
}
