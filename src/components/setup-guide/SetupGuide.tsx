'use client';

/**
 * The Setup Guide modal: the lesson's video (or its cover, until a video is
 * set) and how-to on the left, the list of steps on the right. Mounted once in
 * the dashboard shell.
 *
 * Owner's rules (Oct 4 2026): it opens by itself a few seconds after each
 * sign-in, for every venue (Private Clients too, since Oct 5), until every
 * step is ticked.
 * The X always closes it (nothing is gated behind it), and the venue can tick
 * any step off itself, set up or not. A step that's ticked but isn't really
 * set up says so, and keeps the reminder pill up (SetupGuidePrompt).
 * It also opens from the pill, the dashboard card and the sidebar entry
 * (openSetupGuide in lib/setup-guide-client.ts).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Check, Copy, GraduationCap, Play, Undo2, X } from 'lucide-react';
import DashboardBookingModal from '@/components/DashboardBookingModal';
import { trackClient } from '@/lib/analytics-client';
import { isNativeApp } from '@/lib/platform';
import { setupLesson, type SetupLessonId, type SetupLessonState } from '@/lib/setup-guide';
import {
  getSetupGuideStatus, OPEN_SETUP_GUIDE_EVENT, refreshSetupGuide, setupStepLabels, tickSetupStep, useSetupGuideStatus,
} from '@/lib/setup-guide-client';
import { LessonCover, LessonThumb, StepTick, StepTitle } from './LessonCover';

/** Remembers which sign-in the guide last opened itself for. */
const OPENED_FOR_KEY = 'storyvenue.setupGuide.openedFor';
const AUTO_OPEN_DELAY_MS = 3000;

/** Start the video when its cover is pressed (each player spells autoplay its own way). */
function withAutoplay(embedUrl: string): string {
  const param = /wistia/.test(embedUrl)
    ? 'autoPlay=true'
    : /cloudflarestream|videodelivery/.test(embedUrl)
      ? 'autoplay=true'
      : 'autoplay=1';
  return `${embedUrl}${embedUrl.includes('?') ? '&' : '?'}${param}`;
}

/** The step to land on: the first still to tick, else the first not really set up. */
function firstToDo(lessons: readonly SetupLessonState[]): SetupLessonId | null {
  const counted = lessons.filter((l) => !l.optional);
  return (counted.find((l) => !l.checked) ?? counted.find((l) => !l.verified) ?? lessons[0])?.id ?? null;
}

export default function SetupGuide({ venueId }: { venueId: string }) {
  const status = useSetupGuideStatus();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<SetupLessonId | null>(null);
  const [playing, setPlaying] = useState<SetupLessonId | null>(null);
  const [copied, setCopied] = useState(false);
  const [callOpen, setCallOpen] = useState(false);

  // Load on arrival, and again as the venue moves around while something is
  // still not set up, so a step turns green soon after they've done it.
  useEffect(() => {
    const current = getSetupGuideStatus();
    if (!current || (current.eligible && !current.fulfilled)) void refreshSetupGuide(15_000);
  }, [pathname]);

  // Open by itself once per sign-in, a few seconds after the dashboard loads.
  const autoOpen = status?.autoOpen === true;
  const loginId = status?.loginId ?? null;
  useEffect(() => {
    if (!autoOpen || isNativeApp()) return;
    const stamp = `${venueId}:${loginId ?? 'this-visit'}`;
    // No sign-in time to go by (no session signing locally): once per tab.
    const read = (): string | null => {
      try { return (loginId ? localStorage : sessionStorage).getItem(OPENED_FOR_KEY); } catch { return null; }
    };
    if (read() === stamp) return;
    const timer = window.setTimeout(() => {
      try { (loginId ? localStorage : sessionStorage).setItem(OPENED_FOR_KEY, stamp); } catch { /* storage off */ }
      setOpen(true);
      trackClient('setup_guide_opened', { label: 'by itself' });
    }, AUTO_OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autoOpen, loginId, venueId]);

  // The setup wizard just finished (card entered, listing live): this is the
  // moment the guide takes over, so load it again and let it open. Twice, in
  // case the wizard's last save is still landing.
  useEffect(() => {
    let later: number | undefined;
    const onWizardDone = () => {
      void refreshSetupGuide();
      later = window.setTimeout(() => void refreshSetupGuide(), 2500);
    };
    window.addEventListener('storyvenue:setup-complete', onWizardDone);
    return () => {
      window.removeEventListener('storyvenue:setup-complete', onWizardDone);
      window.clearTimeout(later);
    };
  }, []);

  // Opened from the pill, the dashboard card or the sidebar entry.
  useEffect(() => {
    const onOpen = (e: Event) => {
      setPicked((e as CustomEvent<{ lessonId?: SetupLessonId }>).detail?.lessonId ?? null);
      setPlaying(null);
      setOpen(true);
      trackClient('setup_guide_opened', { label: 'by hand' });
      void refreshSetupGuide();
    };
    window.addEventListener(OPEN_SETUP_GUIDE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETUP_GUIDE_EVENT, onOpen);
  }, []);

  // While it's open: Escape closes it, and the page behind doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const lessons = status?.lessons ?? [];
  const currentId: SetupLessonId | null =
    (picked && lessons.some((l) => l.id === picked) ? picked : null) ?? firstToDo(lessons);
  const current = lessons.find((l) => l.id === currentId) ?? null;

  // The strategy-call step has nothing to set up: it's done once it's been shown.
  const tickGrow = open && currentId === 'grow' && current?.ticked === false;
  useEffect(() => {
    if (tickGrow) void tickSetupStep('grow');
  }, [tickGrow]);

  if (!status?.eligible || !currentId || !current) return null;
  const lesson = setupLesson(currentId);
  if (!lesson) return null;

  const labels = setupStepLabels(lessons);
  const next = lessons[lessons.findIndex((l) => l.id === currentId) + 1] ?? null;
  const video = status.videos[currentId] ?? null;
  const pct = status.total ? Math.round((status.done / status.total) * 100) : 0;
  const one = status.left === 1;

  const pick = (id: SetupLessonId) => {
    setPicked(id);
    setPlaying(null);
    setCopied(false);
  };
  const copyListing = () => {
    if (!status.listingUrl) return;
    void navigator.clipboard.writeText(status.listingUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    });
  };
  // Start the step's video where it is: from its cover, or from the
  // walkthrough's "Watch" button. Starting the walkthrough is what ticks it.
  const startVideo = (from: 'cover' | 'button') => {
    setPlaying(currentId);
    if (currentId === 'walkthrough' && !current.ticked) void tickSetupStep('walkthrough');
    if (from === 'button') trackClient('setup_guide_step_started', { label: currentId });
  };
  const primaryButton = 'inline-flex items-center gap-2 rounded-xl bg-[#1b1b1b] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black';
  const secondaryButton = 'inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50';
  const cta = lesson.cta;
  // The listing step leads with copying the link; opening the listing comes second.
  const copyFirst = lesson.id === 'listing' && Boolean(status.listingUrl);
  // A step whose button plays a video needs a video: without one it can only be ticked.
  const cantPlay = cta.does === 'play' && !video;
  // A Private Client has already signed up for what the last step offers: it
  // is shown done, with no survey to fill in (and so, as the last step, no buttons).
  const nothingToPress = current.alreadyTheirs && !next;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[10000] flex items-stretch justify-center bg-black/50 sm:items-center sm:p-6"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Setup guide"
            data-testid="setup-guide"
            className="flex max-h-full w-full max-w-[1080px] flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[min(92vh,820px)] sm:rounded-3xl"
          >
            {/* Header */}
            <div className="shrink-0 border-b border-gray-100 px-5 pb-4 pt-5 sm:px-7">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f3efe8] text-[#8a7448]">
                  <GraduationCap size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-lg font-semibold text-gray-900">Setup guide</h2>
                  <p className="text-[13px] text-gray-500">
                    {status.fulfilled
                      ? 'Everything here is set up. Come back any time to rewatch a lesson.'
                      : status.checkedAll
                        ? `You’ve ticked every step. ${status.left} still ${one ? 'isn’t' : 'aren’t'} set up, so the reminder stays until ${one ? 'it is' : 'they are'}.`
                        : 'Suggested steps to your first leads. Tick each one off as you go.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close the setup guide"
                  className="-mr-1.5 -mt-1 rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-gray-500">
                  {status.done} of {status.total} done
                </span>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
              {/* The lesson: on a wide screen its text scrolls and its buttons stay put. */}
              <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
                <div className="px-5 pt-5 sm:px-7 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-5">
                  {video && playing === currentId ? (
                    <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
                      <iframe
                        src={withAutoplay(video)}
                        title={lesson.title}
                        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                        allowFullScreen
                        className="h-full w-full border-0"
                      />
                    </div>
                  ) : (
                    <LessonCover
                      lesson={lesson}
                      label={labels.get(currentId)?.short ?? ''}
                      hasVideo={Boolean(video)}
                      onPlay={() => startVideo('cover')}
                      priority
                    />
                  )}

                  <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold uppercase tracking-wider text-gray-400">{labels.get(currentId)?.long}</span>
                    {current.verified ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                        <Check size={12} /> Done
                      </span>
                    ) : current.ticked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 font-semibold text-gray-600">
                        <Check size={12} /> Marked done
                      </span>
                    ) : current.optional ? null : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600">To do</span>
                    )}
                  </div>
                  <h3 className="font-heading mt-2 text-xl font-semibold tracking-tight text-gray-900">{lesson.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-gray-600">{lesson.summary}</p>
                  {current.ticked && !current.verified && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-900">
                      You marked this done, but it isn’t set up yet. The reminder stays until it is.
                    </p>
                  )}
                  {current.alreadyTheirs && (
                    <p data-testid="setup-guide-already-theirs" className="mt-3 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-emerald-900">
                      You’ve already signed up for this, so it’s done.
                    </p>
                  )}

                  <ol className="mt-4 space-y-2.5">
                    {lesson.steps.map((step, i) => (
                      <li key={step} className="flex items-start gap-3 text-[14px] leading-relaxed text-gray-700">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>

                {!nothingToPress && <div className="flex flex-wrap items-center gap-2.5 px-5 py-4 sm:px-7 lg:shrink-0 lg:border-t lg:border-gray-100">
                  {copyFirst && (
                    <button type="button" onClick={copyListing} className={primaryButton}>
                      {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy my link'}
                    </button>
                  )}
                  {cta.href !== undefined ? (
                    <Link
                      href={cta.href}
                      onClick={() => {
                        setOpen(false);
                        trackClient('setup_guide_step_started', { label: lesson.id });
                      }}
                      className={copyFirst ? secondaryButton : primaryButton}
                    >
                      {cta.label} {!copyFirst && <ArrowRight size={15} />}
                    </Link>
                  ) : cta.does === 'play' ? (
                    !cantPlay && (
                      <button type="button" onClick={() => startVideo('button')} className={primaryButton}>
                        <Play size={15} /> {cta.label}
                      </button>
                    )
                  ) : !current.alreadyTheirs && (
                    <button
                      type="button"
                      onClick={() => {
                        // The survey takes over the screen; the guide steps aside for it.
                        setOpen(false);
                        setCallOpen(true);
                        trackClient('setup_guide_call_requested');
                      }}
                      className={primaryButton}
                    >
                      {cta.label} <ArrowRight size={15} />
                    </button>
                  )}
                  {/* Their call to make: any step can be ticked off, set up or not.
                      (The walkthrough ticks when its video starts; with no video
                      yet, this is how it's ticked, so it can't get stuck.) */}
                  {!current.checked && (cta.href !== undefined || cantPlay) && (
                    <button type="button" onClick={() => void tickSetupStep(lesson.id, true)} className={secondaryButton}>
                      <Check size={15} /> Mark as done
                    </button>
                  )}
                  {current.ticked && !current.verified && (
                    <button
                      type="button"
                      onClick={() => void tickSetupStep(lesson.id, false)}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                    >
                      <Undo2 size={15} /> Not done yet
                    </button>
                  )}
                  {next && (
                    <button
                      type="button"
                      onClick={() => pick(next.id)}
                      className="ml-auto text-sm font-medium text-gray-500 transition hover:text-gray-900"
                    >
                      Next step
                    </button>
                  )}
                </div>}
              </div>

              {/* The steps: pick one to read it, tick its circle to mark it done. */}
              <div className="shrink-0 border-t border-gray-100 px-3 py-3 lg:w-[330px] lg:overflow-y-auto lg:border-l lg:border-t-0">
                <ul className="space-y-1">
                  {lessons.map((l) => {
                    const item = setupLesson(l.id);
                    if (!item) return null;
                    const selected = l.id === currentId;
                    return (
                      <li
                        key={l.id}
                        className={`flex items-center rounded-xl pr-1.5 transition ${selected ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                      >
                        <button
                          type="button"
                          onClick={() => pick(l.id)}
                          aria-current={selected ? 'step' : undefined}
                          className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
                        >
                          <LessonThumb lesson={item} className="w-[84px] shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                              {labels.get(l.id)?.short}
                            </span>
                            <span className="line-clamp-2 text-balance text-[13px] font-medium leading-snug text-gray-900"><StepTitle text={item.title} /></span>
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={l.verified}
                          onClick={() => void tickSetupStep(l.id, !l.ticked)}
                          aria-label={
                            l.verified ? `Done: ${item.title}` : l.ticked ? `Marked done, not set up yet: ${item.title}` : `Mark as done: ${item.title}`
                          }
                          title={l.verified ? 'Done' : l.ticked ? 'Marked done, not set up yet. Click to untick.' : 'Mark as done'}
                          className="shrink-0 rounded-full p-2 enabled:hover:bg-gray-200/70"
                        >
                          <StepTick ticked={l.ticked} verified={l.verified} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
      <DashboardBookingModal open={callOpen} onClose={() => setCallOpen(false)} />
    </>
  );
}
