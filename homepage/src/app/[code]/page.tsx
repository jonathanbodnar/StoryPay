import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { siteUrl } from '@/lib/site-url';

// Resolve short bio links server-side on every hit (handles can change).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const API_BASE = siteUrl(process.env.NEXT_PUBLIC_DASHBOARD_URL, 'https://app.storyvenue.com');

/**
 * Single-segment handles that must never be treated as a short link because
 * they map to real routes/assets. Next.js already resolves static routes before
 * this dynamic catch, so these are a belt-and-suspenders guard (and cover asset
 * requests like favicon.ico that would otherwise 404 through the resolver).
 */
const RESERVED = new Set([
  'venue', 'venues', 'confirmation', 'privacy', 'terms', 'api',
  'robots.txt', 'sitemap.xml', 'llms.txt', 'indexnow.txt', 'favicon.ico',
  '_next', 'static',
]);

type Resolved = { slug: string; is_demo: boolean; demo_preview_token: string | null };

/**
 * Link-shortener: storyvenue.com/<handle> → the venue's Lead Link page.
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

  if (!handle || RESERVED.has(handle) || !/^[a-z0-9-]{1,80}$/.test(handle)) {
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
