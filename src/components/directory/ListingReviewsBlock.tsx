import { Star } from 'lucide-react';
import type { PublicVenuePayload } from '@/lib/public-venue-directory';

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= value ? 'fill-amber-400 text-amber-400' : 'fill-gray-100 text-gray-200'}
          strokeWidth={n <= value ? 0 : 1.2}
        />
      ))}
    </span>
  );
}

type Props = {
  venueName: string;
  reviews: PublicVenuePayload['reviews'];
  /** Minimal chrome for iframe embeds */
  compact?: boolean;
};

export function ListingReviewsBlock({ venueName, reviews, compact }: Props) {
  const rounded =
    reviews.average_rating != null ? Math.round(reviews.average_rating * 10) / 10 : null;

  return (
    <section className={compact ? 'text-gray-900' : 'rounded-3xl border border-gray-200 bg-white p-6'}>
      <div className="mb-6 flex flex-col gap-3 border-b border-gray-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            Reviews
          </h2>
          <p className="mt-1 text-sm text-gray-500">Couples who celebrated at {venueName}</p>
        </div>
        {reviews.count > 0 && rounded != null && (
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
            <span
              className="text-3xl tabular-nums text-gray-900"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              {rounded}
            </span>
            <div>
              <Stars value={Math.round(rounded)} size={16} />
              <p className="text-xs text-gray-500">{reviews.count} reviews</p>
            </div>
          </div>
        )}
      </div>

      {reviews.items.length === 0 ? (
        <p className="text-center text-sm text-gray-500">No reviews yet.</p>
      ) : (
        <ul className="space-y-4">
          {reviews.items.map((r) => (
            <li key={r.id} className="rounded-2xl border border-gray-100 bg-gray-50/50 p-4">
              <Stars value={r.rating} />
              {r.title && (
                <h3
                  className="mt-2 text-lg text-gray-900"
                  style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                >
                  {r.title}
                </h3>
              )}
              <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{r.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span className="font-semibold text-gray-800">{r.reviewer_name}</span>
                {r.wedding_date && (
                  <span>
                    Wedding{' '}
                    {new Date(r.wedding_date + 'T12:00:00').toLocaleDateString(undefined, {
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                )}
                <span>
                  {new Date(r.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
