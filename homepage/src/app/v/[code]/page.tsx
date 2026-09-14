import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { siteUrl } from '@/lib/site-url';

// Resolve short bio links server-side on every hit (handles can change).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const API_BASE = siteUrl(process.env.NEXT_PUBLIC_DASHBOARD_URL, 'https://app.storyvenue.com');

type Resolved = { slug: string; is_demo: boolean; demo_preview_token: string | null };

/**
 * Link-shortener: storyvenue.com/v/<code> → the venue's Lead Link page.
 *
 * Everything lives under the dedicated /v/ namespace so the root
 * (storyvenue.com/links, /pricing, …) stays reserved for StoryVenue and no
 * venue can ever squat a prime path. <code> is a random 6-char code by default,
 * or a venue's chosen vanity — both resolve the same way.
 *
 * Redirecting to /venue/<slug>/links keeps lead attribution intact — that page
 * stamps every inquiry with source=lead_link, so a pricing-guide download made
 * through a short link is still credited to the Lead Link funnel. We also add
 * explicit utm tags for analytics and carry a demo venue's preview token so its
 * hidden listing stays viewable via the short link.
 */
export default async function ShortLinkPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const handle = decodeURIComponent(code || '').trim().toLowerCase();

  if (!handle || !/^[a-z0-9-]{1,80}$/.test(handle)) {
    notFound();
  }

  let data: Resolved | null = null;
  try {
    const res = await fetch(`${API_BASE}/api/public/lead-link/${encodeURIComponent(handle)}`, {
      next: { revalidate: 0 },
      headers: { Accept: 'application/json' },
    });
    if (res.ok) data = (await res.json()) as Resolved;
  } catch {
    /* fall through to 404 */
  }

  if (!data?.slug) notFound();

  const qs = new URLSearchParams({
    utm_source: 'lead_link',
    utm_medium: 'bio',
    utm_campaign: 'lead_link',
  });
  if (data.is_demo && data.demo_preview_token) {
    qs.set('preview', data.demo_preview_token);
  }

  redirect(`/venue/${encodeURIComponent(data.slug)}/links?${qs.toString()}`);
}
