'use client';

/**
 * The Setup Guide when it's closed, at the top of the dashboard:
 *
 *  - the drawer, on the dashboard home, while there are steps still to tick.
 *    It hangs from the top of the page. Open, it shows every step's cover to
 *    jump to; closed, it's one slim bar: progress, the next step, Continue.
 *    It starts open and stays how the venue left it, on that device (the
 *    pop-up already comes back at each sign-in). The plan chip ("Plan ends
 *    Oct 27") sits on its bar, so the page has one thing at the top, not two.
 *  - the pill, everywhere else, and everywhere once every step is ticked. It
 *    stays until each step is REALLY set up, so a step the venue ticked
 *    without doing keeps its reminder (owner's rule, Oct 4 2026).
 *
 * Neither is shown to Private Clients, or once everything is set up.
 */

import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { ChevronDown, ChevronRight, GraduationCap, X } from 'lucide-react';
import { isNativeApp } from '@/lib/platform';
import { setupLesson } from '@/lib/setup-guide';
import { openSetupGuide, setupStepLabels, useSetupGuideStatus, type SetupGuideStatus } from '@/lib/setup-guide-client';
import { LessonThumb, StepTick } from './LessonCover';

export default function SetupGuidePrompt({ home, planChip }: { home: boolean; planChip?: ReactNode }) {
  const status = useSetupGuideStatus();
  if (!status?.prompted || isNativeApp()) return null;
  if (home && !status.checkedAll) return <SetupGuideDrawer status={status} planChip={planChip} />;
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

/**
 * Progress, as a ring around the guide's icon. (It was a green line along the
 * bottom of the bar: the bar's rounded corners clipped its ends, and the grey
 * remainder read as a second, broken line.)
 */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 14;
  const round = 2 * Math.PI * r;
  const part = total ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <span aria-hidden data-testid="setup-guide-progress" data-progress={`${done}/${total}`} className="relative flex h-8 w-8 shrink-0 items-center justify-center">
      <svg viewBox="0 0 32 32" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" strokeWidth="2.5" className="stroke-gray-200" />
        <circle
          cx="16" cy="16" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round"
          className="stroke-emerald-500 transition-[stroke-dashoffset] duration-500"
          strokeDasharray={round}
          strokeDashoffset={round * (1 - part)}
        />
      </svg>
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#1b1b1b] text-white">
        <GraduationCap size={12} />
      </span>
    </span>
  );
}

/**
 * How the venue left the drawer on this device. Until they've chosen, it's
 * open on a wide screen; on a phone, where the open drawer is a long list
 * that would push the dashboard off the screen, it starts as the bar.
 */
const DRAWER_KEY = 'storyvenue.setupGuide.drawer';
function drawerStartsOpen(): boolean {
  try {
    const left = window.localStorage.getItem(DRAWER_KEY);
    if (left === 'closed') return false;
    if (left === 'open') return true;
    return window.matchMedia('(min-width: 640px)').matches;
  } catch {
    return true;
  }
}

function SetupGuideDrawer({ status, planChip }: { status: SetupGuideStatus; planChip?: ReactNode }) {
  const labels = setupStepLabels(status.lessons);
  const nextId = status.lessons.find((l) => !l.optional && !l.checked)?.id;
  const next = nextId ? setupLesson(nextId) : undefined;
  // Only ever rendered in the browser (the guide's status is loaded there), so
  // reading what they chose last time can't disagree with the server's paint.
  const [open, setOpen] = useState(drawerStartsOpen);
  const toggle = () => {
    const now = !open;
    setOpen(now);
    try {
      window.localStorage.setItem(DRAWER_KEY, now ? 'open' : 'closed');
    } catch {
      /* storage blocked: it starts open next time */
    }
  };

  return (
    <section
      data-testid="setup-guide-card"
      data-open={open ? 'true' : 'false'}
      className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white lg:-mt-[68px] lg:rounded-t-none lg:border-t-0"
    >
      {/* The bar: all there is when the drawer is closed. */}
      <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="setup-guide-steps"
          className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left"
        >
          <ProgressRing done={status.done} total={status.total} />
          <span className="min-w-0 truncate text-[13px] text-gray-500">
            <span className="mr-2 hidden font-heading text-sm font-semibold text-gray-900 sm:inline">Finish setting up</span>
            {/* On a phone the count is the label: there's no room for both. */}
            <span className="font-semibold tabular-nums text-gray-900 sm:font-normal sm:text-gray-500">
              {status.done} of {status.total} done
            </span>
            {next && <span className="hidden md:inline"> · Next: {next.title}</span>}
          </span>
        </button>
        {planChip}
        <button
          type="button"
          onClick={() => openSetupGuide()}
          className="whitespace-nowrap rounded-lg bg-[#1b1b1b] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-black"
        >
          Continue setup
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="setup-guide-steps"
          aria-label={open ? 'Close the setup steps' : 'Show the setup steps'}
          className="shrink-0 rounded-lg p-1.5 text-gray-400 outline-none transition hover:bg-gray-100 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-gray-300"
        >
          {open ? <X size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {/* The steps: slide down when open. Hidden from keyboard and screen
          readers too when closed (visibility flips after the slide). */}
      <div
        id="setup-guide-steps"
        className={`grid transition-[grid-template-rows,visibility] duration-300 ease-out ${
          open ? 'visible grid-rows-[1fr]' : 'invisible grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {/* One straight hairline between the bar and the steps, edge to edge. */}
          <div className="border-t border-gray-100 px-4 pb-3 pt-4 sm:px-5 sm:pb-4">
            <LessonStrip>
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
            </LessonStrip>
            {/* A phone has no room for the covers: the steps as a list. */}
            <ul className="divide-y divide-gray-100 sm:hidden">
              {status.lessons.map((l) => {
                const lesson = setupLesson(l.id);
                if (!lesson) return null;
                return (
                  <li key={l.id}>
                    <button type="button" onClick={() => openSetupGuide(l.id)} className="flex w-full items-center gap-3 py-2.5 text-left">
                      <StepTick ticked={l.ticked} verified={l.verified} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          {labels.get(l.id)?.short}
                        </span>
                        <span className="block truncate text-[13px] font-medium text-gray-900">{lesson.title}</span>
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-gray-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The row of step covers. It scrolls sideways with no scrollbar of its own
 * (on a Mac set to always show scrollbars that was a thick grey bar under
 * the covers): a thin marker shows where you are while you scroll, and
 * fades away a moment after you stop.
 */
function LessonStrip({ children }: { children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const fade = useRef<number | null>(null);
  useEffect(() => () => {
    if (fade.current) window.clearTimeout(fade.current);
  }, []);

  const onScroll = (e: UIEvent<HTMLUListElement>) => {
    const strip = e.currentTarget;
    if (!track.current || !marker.current || strip.scrollWidth <= strip.clientWidth) return;
    marker.current.style.width = `${(strip.clientWidth / strip.scrollWidth) * 100}%`;
    marker.current.style.left = `${(strip.scrollLeft / strip.scrollWidth) * 100}%`;
    track.current.style.opacity = '1';
    if (fade.current) window.clearTimeout(fade.current);
    fade.current = window.setTimeout(() => {
      if (track.current) track.current.style.opacity = '0';
    }, 900);
  };

  return (
    <div className="hidden sm:block">
      <ul
        data-testid="setup-guide-strip"
        onScroll={onScroll}
        className="flex gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </ul>
      <div
        ref={track}
        aria-hidden
        data-testid="setup-guide-strip-marker"
        className="pointer-events-none relative mt-2 h-1 rounded-full bg-gray-100 opacity-0 transition-opacity duration-300"
      >
        <span ref={marker} className="absolute inset-y-0 rounded-full bg-gray-400" />
      </div>
    </div>
  );
}
