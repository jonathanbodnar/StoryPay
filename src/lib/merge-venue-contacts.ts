import { supabaseAdmin } from '@/lib/supabase';
import { listCustomers } from '@/lib/lunarpay';
import { ghlRequest, refreshAccessToken } from '@/lib/ghl';

export type MergedContactSource = 'ghl' | 'lunarpay' | 'storypay';

export interface MergedContact {
  id: string | number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  source: MergedContactSource;
}

/**
 * Merged list for the dashboard: GHL + LunarPay + StoryPay `venue_customers`,
 * deduplicated by email (GHL wins, then LP, then native rows without dup email).
 */
export async function mergeVenueContacts(
  venueId: string,
  opts: { search: string; page: number; limit: number },
): Promise<MergedContact[]> {
  const { search, page, limit } = opts;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_refresh_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (!venue) return [];

  let ghlToken = venue.ghl_access_token;
  if (venue.ghl_connected && venue.ghl_refresh_token) {
    try {
      const refreshed = await refreshAccessToken(venue.ghl_refresh_token);
      if (refreshed.access_token) {
        ghlToken = refreshed.access_token;
        await supabaseAdmin.from('venues').update({
          ghl_access_token: refreshed.access_token,
          ghl_refresh_token: refreshed.refresh_token || venue.ghl_refresh_token,
        }).eq('id', venueId);
      }
    } catch (err) {
      console.error('[mergeVenueContacts] GHL token refresh failed:', err);
    }
  }

  const merged: MergedContact[] = [];
  const seenEmails = new Set<string>();

  if (venue.ghl_connected && ghlToken && venue.ghl_location_id) {
    try {
      const ghlResult = await ghlRequest(
        `/contacts/?locationId=${venue.ghl_location_id}&query=${encodeURIComponent(search)}&limit=${limit}`,
        ghlToken,
        { locationId: venue.ghl_location_id },
      );
      for (const c of ghlResult.contacts || []) {
        const email = ((c.email as string) || '').toLowerCase();
        const id = c.id as string;
        merged.push({
          id,
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || (c.email as string) || 'Unknown',
          firstName: (c.firstName as string) || '',
          lastName: (c.lastName as string) || '',
          email: (c.email as string) || '',
          phone: (c.phone as string) || '',
          source: 'ghl',
        });
        if (email) seenEmails.add(email);
      }
    } catch (err) {
      console.error('[mergeVenueContacts] GHL fetch error:', err);
    }
  }

  if (venue.lunarpay_secret_key) {
    try {
      const lpResult = await listCustomers(venue.lunarpay_secret_key, search, page, limit);
      const raw = lpResult.data || lpResult;
      const list = Array.isArray(raw) ? raw : [];
      for (const c of list) {
        const email = ((c.email as string) || '').toLowerCase();
        if (email && seenEmails.has(email)) continue;
        const firstName = (c.firstName as string) || '';
        const lastName = (c.lastName as string) || '';
        merged.push({
          id: c.id as string | number,
          name:
            (c.name as string) ||
            [firstName, lastName].filter(Boolean).join(' ') ||
            (c.email as string) ||
            'Unknown',
          firstName,
          lastName,
          email: (c.email as string) || '',
          phone: (c.phone as string) || '',
          source: 'lunarpay',
        });
        if (email) seenEmails.add(email);
      }
    } catch (err) {
      console.error('[mergeVenueContacts] LunarPay fetch error:', err);
    }
  }

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone, ghl_contact_id, lunarpay_customer_id')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[mergeVenueContacts] venue_customers fetch error:', error);
    } else {
      for (const c of rows ?? []) {
        const email = (c.customer_email || '').toLowerCase();
        if (email && seenEmails.has(email)) continue;
        merged.push({
          id: c.lunarpay_customer_id || c.ghl_contact_id || c.id,
          name:
            [c.first_name, c.last_name].filter(Boolean).join(' ') || c.customer_email || 'Unknown',
          firstName: c.first_name || '',
          lastName: c.last_name || '',
          email: c.customer_email || '',
          phone: c.phone || '',
          source: 'storypay',
        });
        if (email) seenEmails.add(email);
      }
    }
  } catch (err) {
    console.error('[mergeVenueContacts] venue_customers fetch error:', err);
  }

  const filtered = search
    ? merged.filter((c) => {
        const q = search.toLowerCase();
        return (
          String(c.name || '')
            .toLowerCase()
            .includes(q) ||
          String(c.email || '')
            .toLowerCase()
            .includes(q) ||
          String(c.phone || '')
            .toLowerCase()
            .includes(q)
        );
      })
    : merged;

  return filtered;
}
