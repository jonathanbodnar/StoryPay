/**
 * Tripleseat integration helpers.
 *
 * Tripleseat's `POST /v1/leads/create` endpoint supports a plain public API
 * key (no OAuth required) — the venue owner just copies it from their
 * Tripleseat account under Settings → API. We store it alongside their chosen
 * location ID and fire a background push every time a new lead arrives.
 *
 * Docs: https://api.tripleseat.com/api-docs/v1/openapi.yaml
 */

import { supabaseAdmin } from '@/lib/supabase';

const TRIPLESEAT_API = 'https://api.tripleseat.com/v1';

export interface TripleseatLocation {
  id: number;
  name: string;
  /** True when the venue has more than one Tripleseat location (site_id required). */
  active: boolean;
}

/**
 * Fetch all Tripleseat locations accessible with the given public key.
 * Used to populate the location picker after the venue owner pastes their key.
 */
export async function fetchTripleseatLocations(
  publicKey: string,
): Promise<TripleseatLocation[]> {
  const url = `${TRIPLESEAT_API}/locations.json?public_key=${encodeURIComponent(publicKey)}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tripleseat locations fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  // The API returns an array of LocationWrapped objects:
  // [{ location: { id: 123, name: "My Venue", ... } }, ...]
  const data = await res.json() as Array<{ location?: { id?: number; name?: string } }>;
  const rows = Array.isArray(data) ? data : [];
  return rows.map((item) => ({
    id:     Number(item.location?.id ?? 0),
    name:   String(item.location?.name ?? ''),
    active: true,
  })).filter((l) => l.id > 0);
}

export interface TripleseatLeadPayload {
  first_name?: string;
  last_name?: string;
  email_address?: string;
  phone_number?: string;
  event_date?: string;       // ISO date YYYY-MM-DD
  guest_count?: number;
  event_description?: string;
  additional_information?: string;
  location_id?: number;
  campaign_source?: string;
  campaign_medium?: string;
  campaign_name?: string;
  campaign_term?: string;
  campaign_content?: string;
  email_opt_in?: boolean;
}

/**
 * Push a single lead to Tripleseat. Fire-and-forget safe — never throws;
 * returns { ok, error } instead so callers can log without crashing.
 */
export async function pushLeadToTripleseat(
  publicKey: string,
  locationId: number | null,
  lead: TripleseatLeadPayload,
): Promise<{ ok: boolean; tripleseatLeadId?: number; error?: string }> {
  try {
    const body: Record<string, unknown> = { lead: { ...lead } };
    if (locationId) (body.lead as Record<string, unknown>).location_id = locationId;

    const url = `${TRIPLESEAT_API}/leads/create.json?public_key=${encodeURIComponent(publicKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({})) as {
      lead_id?: number; success_message?: string; errors?: unknown;
    };

    if (!res.ok) {
      const errText = JSON.stringify(json).slice(0, 300);
      return { ok: false, error: `Tripleseat ${res.status}: ${errText}` };
    }
    return { ok: true, tripleseatLeadId: json.lead_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

/**
 * If this venue has Tripleseat connected, push the lead in the background.
 * Reads credentials from the venue row — never throws.
 */
export async function maybePushLeadToTripleseat(
  venueId: string,
  lead: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    wedding_date?: string | null;
    guest_count?: number | null;
    message?: string | null;
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_term?: string | null;
    utm_content?: string | null;
  },
): Promise<void> {
  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('tripleseat_public_key, tripleseat_location_id')
      .eq('id', venueId)
      .maybeSingle();

    const v = venue as { tripleseat_public_key?: string | null; tripleseat_location_id?: number | null } | null;
    if (!v?.tripleseat_public_key) return;

    const result = await pushLeadToTripleseat(
      v.tripleseat_public_key,
      v.tripleseat_location_id ?? null,
      {
        first_name:          lead.first_name ?? undefined,
        last_name:           lead.last_name ?? undefined,
        email_address:       lead.email ?? undefined,
        phone_number:        lead.phone ?? undefined,
        event_date:          lead.wedding_date?.slice(0, 10) ?? undefined,
        guest_count:         lead.guest_count ?? undefined,
        event_description:   lead.message ?? undefined,
        campaign_source:     lead.utm_source ?? undefined,
        campaign_medium:     lead.utm_medium ?? undefined,
        campaign_name:       lead.utm_campaign ?? undefined,
        campaign_term:       lead.utm_term ?? undefined,
        campaign_content:    lead.utm_content ?? undefined,
        email_opt_in:        true,
      },
    );

    if (!result.ok) {
      console.warn(`[tripleseat] push failed for venue ${venueId}:`, result.error);
    } else {
      console.log(`[tripleseat] lead pushed for venue ${venueId}, tripleseat id:`, result.tripleseatLeadId);
    }
  } catch (e) {
    console.warn('[tripleseat] maybePushLeadToTripleseat error:', e instanceof Error ? e.message : e);
  }
}
