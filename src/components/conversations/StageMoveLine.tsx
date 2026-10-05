import { ArrowRightLeft } from 'lucide-react';
import type { StageMove } from '@/lib/lead-stage-log';

/**
 * One line in a bride's thread for each time she was moved to another
 * pipeline stage: when, to which stage, and who moved her. Shown to the venue
 * (Conversations) and to support (the inbox), between the messages, in time
 * order. It is not a message: the couple's own chat never has it.
 */
export default function StageMoveLine({ move }: { move: StageMove }) {
  const when = new Date(move.at);
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <div
      data-testid="stage-move"
      className="flex select-none items-center gap-2 py-1"
      title={`${move.from ? `From ${move.from} to ` : 'To '}${move.to} · ${when.toLocaleString()} · by ${move.by}. Only your team and StoryVenue support see this.`}
    >
      <div className="h-px flex-1 bg-gray-200" />
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-[10.5px] leading-4 text-gray-500">
        <ArrowRightLeft size={10} className="shrink-0 text-gray-400" />
        <span className="truncate">
          {stamp && <span className="tabular-nums">{stamp} · </span>}
          Moved to <span className="font-semibold text-gray-700">{move.to}</span> by <span className="font-medium text-gray-700">{move.by}</span>
        </span>
      </span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

/**
 * Where each stage move goes among a thread's messages: `before(i)` gives the
 * moves that happened up to message i's time (and after the one before it);
 * `rest()` the ones after the last message.
 */
export function stageMovesAmong(moves: readonly StageMove[] | null | undefined, messageTimes: readonly string[]) {
  const sorted = [...(moves ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const at = messageTimes.map((t) => Date.parse(t));
  const slots: StageMove[][] = messageTimes.map(() => []);
  const after: StageMove[] = [];
  for (const move of sorted) {
    const when = Date.parse(move.at);
    const i = at.findIndex((t) => Number.isFinite(t) && when <= t);
    if (i < 0) after.push(move);
    else slots[i].push(move);
  }
  return { before: (i: number) => slots[i] ?? [], rest: () => after };
}
