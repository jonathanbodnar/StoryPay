'use client';

/**
 * The Setup Guide on the dashboard home: progress, the next step, and every
 * step's cover to jump straight to it. Only for a venue being walked through
 * the guide; it goes once every step is done.
 */

import { CheckCircle2 } from 'lucide-react';
import { isNativeApp } from '@/lib/platform';
import { setupLesson } from '@/lib/setup-guide';
import { openSetupGuide, useSetupGuideStatus } from '@/lib/setup-guide-client';
import { LessonThumb } from './LessonCover';

export default function SetupGuideCard() {
  const status = useSetupGuideStatus();
  if (!status?.guided || isNativeApp()) return null;

  const nextId = status.lessons.find((l) => !l.done)?.id;
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
        {status.lessons.map((l, i) => {
          const lesson = setupLesson(l.id);
          if (!lesson) return null;
          return (
            <li key={l.id} className="w-[168px] shrink-0">
              <button type="button" onClick={() => openSetupGuide(l.id)} className="group block w-full text-left">
                <span className="relative block">
                  <LessonThumb lesson={lesson} className="transition group-hover:opacity-90" />
                  {l.done && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-white">
                      <CheckCircle2 size={18} className="text-emerald-600" aria-label="Done" />
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  Step {String(i + 1).padStart(2, '0')}
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
