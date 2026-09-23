'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import HelpCenter from '@/components/help/HelpCenter';
import { COUPLE_HELP_CATEGORIES } from '@/lib/couple-help-articles';

/**
 * Couple Help Center — search-only.
 *
 * Renders the same shared component as the venue Help Center so the look, feel,
 * browsing, and search behaviour are identical, but with the couple article set
 * and the couple search endpoint (its own corpus, so a bride can never be
 * served venue-owner articles such as plans, billing, or marketing tooling).
 *
 * Deliberately no Ask AI panel: the venue assistant injects live account data
 * and venue-specific knowledge, which is not appropriate here. In its place the
 * article footer points couples at messaging their venue.
 *
 * Search terms are not logged (no logSearchEndpoint) — we don't store what
 * couples search for. Article thumbs feedback is still collected, which is what
 * surfaces content that needs improving.
 */
export default function CoupleHelpPage() {
  return (
    <Suspense fallback={null}>
      <HelpCenter
        categories={COUPLE_HELP_CATEGORIES}
        firstCategoryId="couple-getting-started"
        title="Help & how-to"
        subtitle="How to use your Wedding Planner, step by step."
        searchEndpoint="/api/couple/help/search"
        rateEndpoint="/api/help/rate-article"
        basePath="/couple/help"
        searchPlaceholder={'Search, e.g. \u201cRSVP\u201d, \u201cseating\u201d, \u201cwedding website\u201d'}
        fallbackCta={
          <p className="text-xs text-gray-400">
            Still stuck?{' '}
            <Link href="/couple/messages" className="font-medium text-gray-600 underline">
              Message your venue
            </Link>{' '}
            and they can help.
          </p>
        }
      />
    </Suspense>
  );
}
