import { MetadataRoute } from 'next';
import { stateSlug, citySlug, stateFullName } from '@/lib/us-states';

const SITE_URL = (
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://storyvenue.com'
).replace(/\/$/, '');
const API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

interface SeoIndexVenue {
  slug: string;
  updated_at: string | null;
  location_city: string | null;
  location_state: string | null;
}

/**
 * Dynamic sitemap: static pages + every published venue listing + the
 * city/state hub pages derived from where those venues are located.
 * Revalidated hourly so new go-live listings surface quickly.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL,              lastModified: new Date(), changeFrequency: 'daily',  priority: 1.0 },
    { url: `${SITE_URL}/venues`,  lastModified: new Date(), changeFrequency: 'daily',  priority: 0.9 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/terms`,   lastModified: new Date(), changeFrequency: 'yearly', priority: 0.2 },
  ];

  let venues: SeoIndexVenue[] = [];
  try {
    const res = await fetch(`${API_BASE}/api/public/directory/seo-index`, {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = (await res.json()) as { venues?: SeoIndexVenue[] };
      venues = Array.isArray(json.venues) ? json.venues : [];
    }
  } catch {
    // API unreachable — serve static entries only rather than failing the sitemap.
  }

  // Venue listing pages
  for (const v of venues) {
    if (!v.slug) continue;
    entries.push({
      url: `${SITE_URL}/venue/${v.slug}`,
      lastModified: v.updated_at ? new Date(v.updated_at) : new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  // State + city hub pages (derived from venue locations)
  const states = new Set<string>();
  const cities = new Set<string>();
  for (const v of venues) {
    if (!v.location_state) continue;
    const full = stateFullName(v.location_state);
    states.add(stateSlug(full));
    if (v.location_city) {
      cities.add(`${stateSlug(full)}/${citySlug(v.location_city)}`);
    }
  }
  for (const s of states) {
    entries.push({
      url: `${SITE_URL}/venues/${s}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    });
  }
  for (const c of cities) {
    entries.push({
      url: `${SITE_URL}/venues/${c}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    });
  }

  return entries;
}
