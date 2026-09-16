'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Owner-controlled announcement bar at the very top of the public venue
 * listing (where a nav menu would normally sit). Message-only by design — no
 * buttons or outbound links — so it never competes with the pricing-guide
 * lead-capture opt-in that the landing page exists to drive.
 *
 * Behavior:
 *   - Scrolls (marquee) only when the text overflows its track; short messages
 *     render centered and static (cleaner). Animation is disabled under
 *     prefers-reduced-motion.
 *   - Dismissible per visitor, keyed to the message text, so posting a NEW
 *     announcement re-shows the bar for someone who dismissed the old one.
 *
 * The server only ever sends `message` when the announcement is enabled and in
 * its active window (see getPublicVenueBySlug), so this component just renders.
 */

/** Small, stable hash of the message for the per-visitor dismiss key. */
function hashMessage(msg: string): string {
  let h = 0;
  for (let i = 0; i < msg.length; i++) {
    h = (h << 5) - h + msg.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

export function VenueAnnouncementStrip({ message }: { message: string }) {
  const trimmed = message.trim();
  const storageKey = `sv_ann_dismiss_${hashMessage(trimmed)}`;

  const [dismissed, setDismissed] = useState(true); // hidden until we confirm not-dismissed (avoids flash)
  const [overflowing, setOverflowing] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  // Measure once mounted / on resize: only marquee when the message can't fit.
  useLayoutEffect(() => {
    function measure() {
      const track = trackRef.current;
      const text = textRef.current;
      if (!track || !text) return;
      setOverflowing(text.scrollWidth > track.clientWidth + 4);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [trimmed, dismissed]);

  if (!trimmed || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
  }

  return (
    <div
      role="region"
      aria-label="Venue announcement"
      className="relative flex items-center text-white"
      style={{ backgroundColor: '#1b1b1b', minHeight: 40 }}
    >
      {/* Label chip */}
      <div className="flex flex-shrink-0 items-center self-stretch border-r border-white/20 px-3">
        <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-widest text-white/60">
          Announcement
        </span>
      </div>

      {/* Message track — marquee only when overflowing */}
      <div
        ref={trackRef}
        className="relative flex-1 overflow-hidden px-4"
        style={{
          maskImage: 'linear-gradient(90deg, transparent, black 24px, black calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, black 24px, black calc(100% - 24px), transparent)',
        }}
      >
        <div className={overflowing ? 'sv-ann-marquee flex w-max' : 'flex justify-center'}>
          <span
            ref={textRef}
            className="whitespace-nowrap py-2 text-xs font-medium text-white/90 sm:text-sm"
          >
            {trimmed}
          </span>
          {overflowing && (
            <span aria-hidden className="whitespace-nowrap py-2 pl-16 text-xs font-medium text-white/90 sm:text-sm">
              {trimmed}
            </span>
          )}
        </div>
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="flex flex-shrink-0 items-center self-stretch px-3 text-white/50 transition-colors hover:text-white"
      >
        <X size={14} />
      </button>

      <style>{`
        @keyframes sv-ann-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .sv-ann-marquee { animation: sv-ann-scroll 24s linear infinite; }
        .sv-ann-marquee:hover { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .sv-ann-marquee { animation: none; }
        }
      `}</style>
    </div>
  );
}
