'use client';

import Image from 'next/image';
import { Play } from 'lucide-react';
import type { SetupLesson } from '@/lib/setup-guide';

/**
 * A lesson's cover: its step number and title beside a real screenshot of the
 * screen it teaches. It stands where the lesson's video goes; once a video
 * link is set (Admin → Setup guide) the same cover carries the play button.
 * Sizes itself to its container, so the one design serves the big player and
 * the dashboard card.
 */
export function LessonCover({
  lesson,
  step,
  hasVideo = false,
  onPlay,
  priority = false,
}: {
  lesson: SetupLesson;
  step: number;
  hasVideo?: boolean;
  onPlay?: () => void;
  priority?: boolean;
}) {
  const art = (
    <>
      <div className="absolute inset-y-0 left-0 flex w-[46%] flex-col justify-center gap-[3cqw] pl-[6cqw]">
        <span className="text-[1.9cqw] font-semibold uppercase tracking-[0.2em] text-[#8a7448]">
          Step {String(step).padStart(2, '0')}
        </span>
        <span className="font-heading text-[4.4cqw] leading-[1.12] tracking-tight text-[#1b1b1b]">
          {lesson.title}
        </span>
      </div>
      <div className="absolute bottom-[-9%] right-[-5%] w-[57%] overflow-hidden rounded-[1.6cqw] border border-black/10 bg-white shadow-[0_3cqw_6cqw_-2cqw_rgba(27,27,27,0.35)]">
        <Image
          src={lesson.cover}
          alt=""
          width={1280}
          height={800}
          unoptimized
          priority={priority}
          className="block h-auto w-full"
        />
      </div>
      {hasVideo && (
        // Over the screenshot, clear of the title.
        <span className="absolute left-[70%] top-[58%] flex h-[11cqw] w-[11cqw] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#1b1b1b] text-white shadow-xl ring-[0.8cqw] ring-white/70 transition group-hover:scale-105">
          <Play className="ml-[0.6cqw] h-[4.4cqw] w-[4.4cqw]" fill="currentColor" />
        </span>
      )}
    </>
  );

  const frame = 'group relative block aspect-video w-full overflow-hidden rounded-2xl bg-[#f3efe8] text-left [container-type:inline-size]';
  if (hasVideo && onPlay) {
    return (
      <button type="button" onClick={onPlay} aria-label={`Play: ${lesson.title}`} className={frame}>
        {art}
      </button>
    );
  }
  return <div className={frame}>{art}</div>;
}

/** The small picture beside a lesson in a list: just the screenshot. */
export function LessonThumb({ lesson, className = '' }: { lesson: SetupLesson; className?: string }) {
  return (
    <span className={`relative block aspect-[16/10] overflow-hidden rounded-lg border border-black/10 bg-[#f3efe8] ${className}`}>
      <Image src={lesson.cover} alt="" width={1280} height={800} unoptimized className="h-full w-full object-cover object-left-top" />
    </span>
  );
}
