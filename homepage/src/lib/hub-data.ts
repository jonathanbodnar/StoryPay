/**
 * Shared data helpers for the /venues/[state] and /venues/[state]/[city]
 * SEO hub pages. Server-side only.
 */

import { stateFullName, stateSlug, citySlug } from '@/lib/us-states';

const API_BASE = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.storyvenue.com';

export interface HubVenue {
  slug: string;
  name: string;
  location_city: string | null;
  location_state: string | null;
  listing_verified: boolean;
  listing_sponsored: boolean;
}

export interface SeoIndexVenue {
  slug: string;
  updated_at: string | null;
  location_city: string | null;
  location_state: string | null;
}

/** All published venues (slug + location only) — cached 1h. */
export async function fetchSeoIndex(): Promise<SeoIndexVenue[]> {
  try {
    const res = await fetch(`${API_BASE}/api/public/directory/seo-index`, {
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { venues?: SeoIndexVenue[] };
    return Array.isArray(json.venues) ? json.venues : [];
  } catch {
    return [];
  }
}

/** Published venues matching a state (and optional city) — cached 10 min. */
export async function fetchHubVenues(stateName: string, city?: string): Promise<HubVenue[]> {
  try {
    const params = new URLSearchParams({ state: stateName });
    if (city) params.set('city', city);
    const res = await fetch(`${API_BASE}/api/public/directory/venues?${params}`, {
      next: { revalidate: 600 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { venues?: HubVenue[] };
    return Array.isArray(json.venues) ? json.venues : [];
  } catch {
    return [];
  }
}

/** Distinct cities (display name + slug) with published venues in a state. */
export async function fetchCitiesForState(stateName: string): Promise<Array<{ name: string; slug: string; count: number }>> {
  const index = await fetchSeoIndex();
  const target = stateSlug(stateName);
  const byCity = new Map<string, { name: string; count: number }>();
  for (const v of index) {
    if (!v.location_state || !v.location_city) continue;
    if (stateSlug(stateFullName(v.location_state)) !== target) continue;
    const key = citySlug(v.location_city);
    const cur = byCity.get(key);
    if (cur) cur.count++;
    else byCity.set(key, { name: v.location_city.trim(), count: 1 });
  }
  return [...byCity.entries()]
    .map(([slug, { name, count }]) => ({ name, slug, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
