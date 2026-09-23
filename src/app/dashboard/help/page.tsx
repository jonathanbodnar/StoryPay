'use client';

import { Suspense } from 'react';
import HelpCenter from '@/components/help/HelpCenter';
import InlineAI from '@/components/help/InlineAI';
import { HELP_CATEGORIES } from '@/lib/help-articles';

/**
 * Venue-owner Help Center.
 *
 * The layout, search, browsing, and feedback all live in the shared
 * <HelpCenter> component so the couple Help Center cannot drift from it. The
 * only venue-specific piece is the Ask AI panel, which is passed in and posts
 * to /api/ai/chat with the venue's live account data.
 */
export default function HelpPage() {
  return (
    <Suspense fallback={null}>
      <HelpCenter
        categories={HELP_CATEGORIES}
        firstCategoryId="getting-started"
        title="Help Center"
        subtitle="Documentation, guides, and platform reference for StoryVenue."
        searchEndpoint="/api/help/search"
        logSearchEndpoint="/api/help/log-search"
        rateEndpoint="/api/help/rate-article"
        aiPanel={<InlineAI />}
        basePath="/dashboard/help"
        searchPlaceholder={'Search or ask anything\u2026 e.g. \u201chow do I create a proposal\u201d or \u201crefund\u201d'}
      />
    </Suspense>
  );
}
