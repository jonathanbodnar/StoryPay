'use client';

import { Fragment, type CSSProperties } from 'react';
import Image from 'next/image';
import { ListChecks, Play } from 'lucide-react';
import type { SetupLesson } from '@/lib/setup-guide';

/**
 * A step's title where it may wrap onto a second line. The words are the
 * owner's, unchanged; a hyphenated one ("3-minute", "follow-up") is kept
 * whole, so a line never ends on "…the 3-".
 */
export function StepTitle({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={`${i}-${word}`}>
          {i > 0 && ' '}
          {word.includes('-') ? <span className="whitespace-nowrap">{word}</span> : word}
        </Fragment>
      ))}
    </>
  );
}

/** The presenter on every video cover: the owner, cut out, in black and white, facing the title. */
const PRESENTER = '/setup-guide/presenter.webp';
const VIDEO_COVER_BG = 'linear-gradient(118deg, #ffffff 0%, #f6f6f7 42%, #e2e2e5 100%)';
const at = (style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style });

/**
 * A video's cover, YouTube style, in the brand's black and white (owner's
 * ask, Oct 5 2026, from a Viktor Academy thumbnail: an "Episode 01" tag, a big
 * title, a brand tag and the presenter cut out on the right). Every step that
 * has a video gets it, with that step's own label and title: the strategy-call
 * step now, the rest as their videos are recorded. All sizes are in container
 * units, so the same art is the big cover and the small picture in a list.
 */
function VideoCoverArt({ lesson, label, play }: { lesson: SetupLesson; label: string; play: boolean }) {
  const step = label.match(/^(Step)\s+(\d+)$/i);
  return (
    <>
      <span aria-hidden style={at({ right: '-12cqw', top: 0, width: '58cqw', aspectRatio: '1', borderRadius: 9999, background: 'radial-gradient(circle at 50% 46%, #ffffff 0%, #f0f0f2 46%, rgba(226,226,229,0) 70%)' })} />
      <span aria-hidden style={at({ right: '-4cqw', top: '6cqw', width: '42cqw', aspectRatio: '1', borderRadius: 9999, border: '0.16cqw solid rgba(27,27,27,0.1)' })} />
      <Image
        src={PRESENTER}
        alt=""
        width={949}
        height={900}
        unoptimized
        style={at({ right: '-7cqw', bottom: '-2.5cqw', height: '57cqw', width: 'auto', maxWidth: 'none', filter: 'drop-shadow(0 1.2cqw 2.4cqw rgba(0,0,0,0.18))' })}
      />
      {/* The guide's own mark, tipped like an app icon. */}
      <span
        aria-hidden
        className="flex items-center justify-center text-white"
        style={at({ left: '36.5cqw', top: '4.2cqw', width: '7.4cqw', height: '7.4cqw', borderRadius: '1.9cqw', background: 'linear-gradient(145deg, #2c2c2c, #0d0d0d)', transform: 'rotate(-11deg)', boxShadow: '0 1.4cqw 2.6cqw -0.8cqw rgba(0,0,0,0.5), inset 0 0.15cqw 0 rgba(255,255,255,0.18)' })}
      >
        <ListChecks style={{ width: '4cqw', height: '4cqw' }} />
      </span>
      <span
        className="flex items-center font-semibold text-[#1b1b1b]"
        style={at({ left: '6cqw', top: '6.4cqw', gap: '1.1cqw', border: '0.2cqw solid #1b1b1b', borderRadius: 9999, padding: step ? '0.55cqw 0.6cqw 0.55cqw 1.9cqw' : '1.2cqw 1.9cqw', fontSize: '2.2cqw', lineHeight: 1 })}
      >
        {step ? step[1] : label}
        {step && (
          <span className="flex items-center justify-center bg-[#1b1b1b] font-bold text-white" style={{ height: '3.7cqw', minWidth: '3.7cqw', padding: '0 1cqw', borderRadius: 9999, fontSize: '2cqw' }}>
            {step[2]}
          </span>
        )}
      </span>
      <span
        className="font-extrabold text-[#111] [text-wrap:balance]"
        style={at({ left: '6cqw', top: '15.2cqw', width: '45cqw', fontSize: '5.2cqw', lineHeight: 1.07, letterSpacing: '-0.035em' })}
      >
        <StepTitle text={lesson.title} />
      </span>
      <span className="flex items-center bg-[#1b1b1b]" style={at({ left: '6cqw', bottom: '6cqw', borderRadius: '1.5cqw', padding: '1.5cqw 2.3cqw' })}>
        <Image src="/storyvenue-light-logo.png" alt="" width={3000} height={751} unoptimized style={{ display: 'block', height: '3.1cqw', width: 'auto' }} />
      </span>
      {play && (
        // On the shoulder: clear of the title and of the face.
        <span
          className="flex items-center justify-center bg-white text-[#111] transition-transform duration-200 group-hover:scale-105"
          style={at({ left: '45.5cqw', top: '32cqw', width: '10cqw', height: '10cqw', borderRadius: 9999, boxShadow: '0 1.6cqw 3.6cqw -0.8cqw rgba(0,0,0,0.55)', outline: '0.7cqw solid rgba(255,255,255,0.35)' })}
        >
          <Play style={{ width: '4cqw', height: '4cqw', marginLeft: '0.55cqw' }} fill="currentColor" />
        </span>
      )}
    </>
  );
}

/**
 * A lesson's cover: its label ("Step 03", or "Optional") and title beside a
 * real screenshot of the screen it teaches. It stands where the lesson's video
 * goes; once a video link is set (Admin → Setup Guide) the cover becomes the
 * video's own (VideoCoverArt) and carries the play button. Sizes itself to its
 * container.
 */
export function LessonCover({
  lesson,
  label,
  hasVideo = false,
  onPlay,
  priority = false,
}: {
  lesson: SetupLesson;
  label: string;
  hasVideo?: boolean;
  onPlay?: () => void;
  priority?: boolean;
}) {
  const art = hasVideo ? <VideoCoverArt lesson={lesson} label={label} play /> : (
    <>
      <div className="absolute inset-y-0 left-0 flex w-[46%] flex-col justify-center gap-[3cqw] pl-[6cqw]">
        <span className="text-[1.9cqw] font-semibold uppercase tracking-[0.2em] text-[#8a7448]">{label}</span>
        <span className="font-heading text-[4.4cqw] leading-[1.12] tracking-tight text-[#1b1b1b]">
          <StepTitle text={lesson.title} />
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
    </>
  );

  const frame = 'group relative block aspect-video w-full overflow-hidden rounded-2xl bg-[#f3efe8] text-left [container-type:inline-size]';
  if (hasVideo && onPlay) {
    return (
      <button type="button" onClick={onPlay} aria-label={`Play: ${lesson.title}`} data-testid="setup-guide-video-cover" className={frame} style={{ background: VIDEO_COVER_BG }}>
        {art}
      </button>
    );
  }
  return <div className={frame} style={hasVideo ? { background: VIDEO_COVER_BG } : undefined}>{art}</div>;
}

/**
 * The small picture beside a lesson in a list: the screenshot, or, for a step
 * with a video, the video's cover in small.
 */
export function LessonThumb({ lesson, className = '', label = '', hasVideo = false }: { lesson: SetupLesson; className?: string; label?: string; hasVideo?: boolean }) {
  if (hasVideo) {
    return (
      <span
        data-testid="setup-guide-video-thumb"
        className={`relative block aspect-[16/10] overflow-hidden rounded-lg border border-black/10 [container-type:inline-size] ${className}`}
        style={{ background: VIDEO_COVER_BG }}
      >
        <VideoCoverArt lesson={lesson} label={label} play={false} />
      </span>
    );
  }
  return (
    <span className={`relative block aspect-[16/10] overflow-hidden rounded-lg border border-black/10 bg-[#f3efe8] ${className}`}>
      <Image src={lesson.cover} alt="" width={1280} height={800} unoptimized className="h-full w-full object-cover object-left-top" />
    </span>
  );
}

/**
 * A step's tick: green once it's really set up, grey when the venue ticked it
 * but it isn't set up yet, an empty circle while it's still to do.
 */
export function StepTick({ ticked, verified, size = 18 }: { ticked: boolean; verified: boolean; size?: number }) {
  if (verified) {
    return (
      <span aria-label="Done" className="flex items-center justify-center rounded-full bg-emerald-600 text-white" style={{ width: size, height: size }}>
        <TickMark size={size} />
      </span>
    );
  }
  if (ticked) {
    return (
      <span aria-label="Marked done, not set up yet" className="flex items-center justify-center rounded-full bg-gray-400 text-white" style={{ width: size, height: size }}>
        <TickMark size={size} />
      </span>
    );
  }
  return <span aria-label="To do" className="block rounded-full border-2 border-gray-300" style={{ width: size, height: size }} />;
}

function TickMark({ size }: { size: number }) {
  return (
    <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.2 5 8.6l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
