'use client';

/**
 * The Setup Guide when it's closed, at the top of the dashboard:
 *
 *  - the card, on the dashboard home, while there are steps still to tick:
 *    progress, the next step, and every step's cover to jump to it;
 *  - the pill, everywhere else, and everywhere once every step is ticked. It
 *    stays until each step is REALLY set up, so a step the venue ticked
 *    without doing keeps its reminder (owner's rule, Oct 4 2026).
 *
 * Neither is shown to Private Clients, or once everything is set up.
 */

import { GraduationCap } from 'lucide-react';
import { isNativeApp } from '@/lib/platform';
import { setupLesson } from '@/lib/setup-guide';
import { openSetupGuide, setupStepLabels, useSetupGuideStatus, type SetupGuideStatus } from '@/lib/setup-guide-client';
import { LessonThumb, StepTick } from './LessonCover';

export default function SetupGuidePrompt({ home }: { home: boolean }) {
  const status = useSetupGuideStatus();
  if (!status?.prompted || isNativeApp()) return null;
  if (home && !status.checkedAll) return <SetupGuideCard status={status} />;
  if (status.showPill) return <SetupGuidePill left={status.left} />;
  return null;
}

function SetupGuidePill({ left }: { left: number }) {
  return (
    <div className="mb-4 self-start">
      <button
        type="button"
        data-testid="setup-guide-pill"
        onClick={() => openSetupGuide()}
        className="flex items-center gap-2 rounded-full bg-[#1b1b1b] py-2 pl-2.5 pr-3 text-sm font-semibold text-white shadow-sm transition-transform hover:scale-[1.03]"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
          <GraduationCap size={14} />
        </span>
        Setup guide
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium tabular-nums">
          {left} left to set up
        </span>
      </button>
    </div>
  );
}

function SetupGuideCard({ status }: { status: SetupGuideStatus }) {
  const labels = setupStepLabels(status.lessons);
  const nextId = status.lessons.find((l) => !l.optional && !l.checked)?.id;
  const next = nextId ? setupLesson(nextId) : undefined;
  const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <section data-testid="setup-guide-card" className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[15px] font-semibold text-gray-900">Finish setting up</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {status.done} of {status.total} done{next ? `. Next: ${next.title}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => openSetupGuide()}
          className="whitespace-nowrap rounded-lg bg-[#1b1b1b] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-black"
        >
          Continue setup
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-4 hidden gap-3 overflow-x-auto pb-1 sm:flex">
        {status.lessons.map((l) => {
          const lesson = setupLesson(l.id);
          if (!lesson) return null;
          return (
            <li key={l.id} className="w-[168px] shrink-0">
              <button type="button" onClick={() => openSetupGuide(l.id)} className="group block w-full text-left">
                <span className="relative block">
                  <LessonThumb lesson={lesson} className="transition group-hover:opacity-90" />
                  {l.checked && (
                    <span className="absolute right-1.5 top-1.5 rounded-full ring-2 ring-white">
                      <StepTick ticked={l.ticked} verified={l.verified} />
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {labels.get(l.id)?.short}
                </span>
                <span className="line-clamp-2 text-[13px] font-medium leading-snug text-gray-900">{lesson.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
