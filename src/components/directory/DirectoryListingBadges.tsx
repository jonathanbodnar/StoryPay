/**
 * Public directory badges: Instagram-style verified + "Sponsored" pill.
 * Use next to venue name on listing pages, search results, and city/state browse.
 */
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

  const gap = 'gap-2';
  const sponsoredClass =
    variant === 'onDark'
      ? 'rounded-full border border-white/40 bg-white/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm'
      : 'rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900';

  return (
    <span className={`inline-flex flex-wrap items-center ${gap} mt-2`} aria-label="Listing badges">
      {verified ? <VerifiedBadgeIcon /> : null}
      {sponsored ? (
        <span className={sponsoredClass} title="Sponsored listing">
          Sponsored
        </span>
      ) : null}
    </span>
  );
}

function VerifiedBadgeIcon() {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center"
      title="Verified venue"
      aria-label="Verified"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        {/* Meta-style 12-point rosette (see weddingdirectory version for derivation). */}
        <path
          d="M12.00 0.50 L14.54 2.53 L17.75 2.04 L18.93 5.07 L21.96 6.25 L21.47 9.46 L23.50 12.00 L21.47 14.54 L21.96 17.75 L18.93 18.93 L17.75 21.96 L14.54 21.47 L12.00 23.50 L9.46 21.47 L6.25 21.96 L5.07 18.93 L2.04 17.75 L2.53 14.54 L0.50 12.00 L2.53 9.46 L2.04 6.25 L5.07 5.07 L6.25 2.04 L9.46 2.53 Z"
          fill="#1D9BF0"
        />
        <path
          d="M6.8 12.4 l3.0 3.0 l7.4 -7.4"
          fill="none"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
