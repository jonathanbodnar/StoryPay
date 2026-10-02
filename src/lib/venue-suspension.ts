/**
 * While a venue is suspended nothing automated goes from it to couples:
 * campaigns, follow-up sequences and the AI Concierge pause (they pick up
 * again when the venue is restored), and the new-lead guide and appointment
 * reminders that come due meanwhile are skipped. Payments for booked weddings
 * carry on (plan charges, receipts and payment emails).
 *
 * The list of suspended venues is cached for a minute; suspending or restoring
 * a venue clears it on that server. A failed read keeps the last list (or
 * none), so a database hiccup never stops every venue's messages.
 */
import { supabaseAdmin } from '@/lib/supabase';

const TTL_MS = 60_000;

type Cache = { ids: string[]; exp: number } | null;

function store(): { current: Cache } {
  const g = globalThis as typeof globalThis & { __suspendedVenues?: { current: Cache } };
  return (g.__suspendedVenues ??= { current: null });
}

export async function suspendedVenueIds(): Promise<string[]> {
  const s = store();
  if (s.current && s.current.exp > Date.now()) return s.current.ids;
  const { data, error } = await supabaseAdmin.from('venues').select('id').eq('is_suspended', true);
  if (error) {
    console.warn('[venue-suspension] could not read suspended venues:', error.message);
    return s.current?.ids ?? [];
  }
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  s.current = { ids, exp: Date.now() + TTL_MS };
  return ids;
}

export async function isVenueSuspended(venueId: string): Promise<boolean> {
  return (await suspendedVenueIds()).includes(venueId);
}

/** For `.not('venue_id', 'in', filter)` on a batch query; null when no venue is suspended. */
export async function suspendedVenueFilter(): Promise<string | null> {
  const ids = await suspendedVenueIds();
  return ids.length ? `(${ids.join(',')})` : null;
}

/** After a venue is suspended or restored, so this server sees it at once. */
export function forgetSuspendedVenues(): void {
  store().current = null;
}
