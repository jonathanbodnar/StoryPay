/** Mirrors main app badges for storyvenue.com venue pages. */
export function DirectoryListingBadges({
  verified,
  sponsored,
  variant = 'onDark',
}: {
  verified: boolean;
  sponsored: boolean;
  variant?: 'onDark' | 'onLight';
}) {
  if (!verified && !sponsored) return null;

  const sponsoredClass =
    variant === 'onDark'
      ? 'rounded-full border border-white/40 bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm'
      : 'rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900';

  return (
    <span className={`mt-2 inline-flex flex-wrap items-center gap-2`} aria-label="Listing badges">
      {verified ? (
        <span className="inline-flex shrink-0" title="Verified venue" aria-label="Verified">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <defs>
              <linearGradient id="hpVerifiedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3897F0" />
                <stop offset="100%" stopColor="#1877D4" />
              </linearGradient>
            </defs>
            <circle cx="12" cy="12" r="11" fill="url(#hpVerifiedGrad)" />
            <path
              d="M7.2 12.3l2.8 2.8 6.8-6.8"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}
      {sponsored ? (
        <span className={sponsoredClass} title="Sponsored listing">
          Sponsored
        </span>
      ) : null}
    </span>
  );
}
