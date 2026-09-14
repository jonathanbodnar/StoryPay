import type { Metadata } from 'next';
import { after } from 'next/server';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { siteUrl } from '@/lib/site-url';

// Resolve short bio links server-side on every hit (handles can change).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const API_BASE = siteUrl(process.env.NEXT_PUBLIC_DASHBOARD_URL, 'https://app.storyvenue.com');

type Resolved = { venue_id: string | null; slug: string; is_demo: boolean; demo_preview_token: string | null };

/**
 * Record one short-link click (lead_link_scan) for the venue. Runs via after()
 * so it never adds latency to the redirect. This counts EVERY tap on the bio
 * short link — including bots or visitors who bounce before the destination
 * page's JS fires its lead_link_view — isolated from directly-shared long URLs.
 * We forward the visitor's IP + UA so the tracker attributes geo/device to the
 * visitor rather than to this (server-to-server) request.
 */
async function recordScan(venueId: string, code: string) {
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  const ua = h.get('user-agent');
  after(async () => {
    try {
      await fetch(`${API_BASE}/api/listing-track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(xff ? { 'x-forwarded-for': xff } : {}),
          ...(ua ? { 'user-agent': ua } : {}),
        },
        body: JSON.stringify({
          venue_id: venueId,
          session_id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          event_type: 'lead_link_scan',
          event_data: { code },
          utm_source: 'lead_link',
          utm_medium: 'bio',
          utm_campaign: 'lead_link',
        }),
      });
    } catch {
      /* best-effort analytics — never block the redirect */
    }
  });
}

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

  if (data.venue_id) {
    await recordScan(data.venue_id, handle);
  }

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
