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
  /** Resolved from `venue_customers` pipeline stage (matches Leads funnel / contact profile). */
  funnelStage?: string | null;
  funnelStageColor?: string | null;
  /** StoryVenue `venue_customers.id` when known (for profile + conversations deep links). */
  venueCustomerId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function humanizePipelineSlug(slug: string | null | undefined): string {
  const s = (slug || '').trim();
  if (!s) return '—';
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function funnelLabelFromVenueCustomer(
  stageId: string | null | undefined,
  pipelineStageSlug: string | null | undefined,
  stageById: Map<string, { name: string; color: string }>,
): { label: string; color: string | null } {
  if (stageId && stageById.has(stageId)) {
    const s = stageById.get(stageId)!;
    return { label: s.name, color: s.color };
  }
  return { label: humanizePipelineSlug(pipelineStageSlug), color: null };
}

function attachFunnelMetadata(
  contacts: MergedContact[],
  funnelLookup: Map<string, { label: string; color: string | null }>,
) {
  for (const c of contacts) {
    const keys: string[] = [];
    const e = (c.email || '').toLowerCase().trim();
    if (e) keys.push(`email:${e}`);
    const sid = String(c.id);
    if (c.source === 'ghl') keys.push(`ghl:${sid}`);
    if (c.source === 'lunarpay') keys.push(`lp:${sid}`);
    if (c.source === 'storypay') keys.push(`uuid:${sid}`);
    if (UUID_RE.test(sid)) keys.push(`uuid:${sid}`);

    for (const k of keys) {
      const v = funnelLookup.get(k);
      if (v) {
        c.funnelStage = v.label;
        c.funnelStageColor = v.color;
        break;
      }
    }
  }
}

function attachVenueCustomerIds(contacts: MergedContact[], vcIdLookup: Map<string, string>) {
  for (const c of contacts) {
    const keys: string[] = [];
    const e = (c.email || '').toLowerCase().trim();
    if (e) keys.push(`email:${e}`);
    const sid = String(c.id);
    if (c.source === 'ghl') keys.push(`ghl:${sid}`);
    if (c.source === 'lunarpay') keys.push(`lp:${sid}`);
    if (c.source === 'storypay') keys.push(`uuid:${sid}`);
    if (UUID_RE.test(sid)) keys.push(`uuid:${sid}`);

    for (const k of keys) {
      const v = vcIdLookup.get(k);
      if (v) {
        c.venueCustomerId = v;
        break;
      }
    }
    if (!c.venueCustomerId && c.source === 'storypay' && UUID_RE.test(sid)) {
      c.venueCustomerId = sid;
    }
  }
}

export interface MergedContactsResult {
  data: MergedContact[];
  total: number;
}

/**
 * Merged list for the dashboard: GHL + LunarPay + StoryVenue `venue_customers`,
 * deduplicated by email (GHL wins, then LP, then native rows without dup email).
 * Returns paginated `data` plus the un-sliced `total` for page count display.
 */
export async function mergeVenueContacts(
  venueId: string,
  opts: { search: string; page: number; limit: number },
): Promise<MergedContactsResult> {
  const { search, page, limit } = opts;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_refresh_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (!venue) return { data: [], total: 0 };

  const [{ data: stageRows }, { data: vcFunnelRows }] = await Promise.all([
    supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, color')
      .eq('venue_id', venueId),
    supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, ghl_contact_id, lunarpay_customer_id, stage_id, pipeline_stage')
      .eq('venue_id', venueId),
  ]);

  const stageById = new Map<string, { name: string; color: string }>();
  for (const s of stageRows ?? []) {
    stageById.set(s.id as string, { name: s.name as string, color: (s.color as string) || '#6b7280' });
  }

  const funnelLookup = new Map<string, { label: string; color: string | null }>();
  const vcIdLookup = new Map<string, string>();
  for (const vc of vcFunnelRows ?? []) {
    const { label, color } = funnelLabelFromVenueCustomer(
      vc.stage_id as string | null | undefined,
      vc.pipeline_stage as string | null | undefined,
      stageById,
    );
    const payload = { label, color };
    const vid = vc.id as string;
    const em = ((vc.customer_email as string) || '').toLowerCase().trim();
    if (em) {
      funnelLookup.set(`email:${em}`, payload);
      vcIdLookup.set(`email:${em}`, vid);
    }
    const ghlId = vc.ghl_contact_id as string | null | undefined;
    if (ghlId) {
      funnelLookup.set(`ghl:${ghlId}`, payload);
      vcIdLookup.set(`ghl:${ghlId}`, vid);
    }
    const lpId = vc.lunarpay_customer_id;
    if (lpId != null && String(lpId).trim() !== '') {
      const lpKey = `lp:${String(lpId)}`;
      funnelLookup.set(lpKey, payload);
      vcIdLookup.set(lpKey, vid);
    }
    funnelLookup.set(`uuid:${vid}`, payload);
    vcIdLookup.set(`uuid:${vid}`, vid);
  }

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

  // Also pull directly from the `leads` table for any contacts that were
  // created before the venue_customers mirror write was added. This ensures
  // leads page contacts always appear on the contacts page too.
  try {
    const { data: leadRows, error: leadErr } = await supabaseAdmin
      .from('leads')
      .select('id, first_name, last_name, name, email, phone, stage_id, pipeline_id, status, created_at')
      .eq('venue_id', venueId)
      .order('created_at', { ascending: false });

    if (leadErr) {
      console.error('[mergeVenueContacts] leads fetch error:', leadErr);
    } else {
      for (const l of leadRows ?? []) {
        const email = ((l.email as string) || '').toLowerCase();
        if (email && seenEmails.has(email)) continue;
        const firstName = (l.first_name as string) || '';
        const lastName  = (l.last_name  as string) || '';
        const fullName  = (l.name as string) || [firstName, lastName].filter(Boolean).join(' ') || email || 'Unknown';
        merged.push({
          id: l.id as string,
          name: fullName,
          firstName,
          lastName,
          email: (l.email as string) || '',
          phone: (l.phone as string) || '',
          source: 'storypay',
        });
        if (email) seenEmails.add(email);
        // Back-fill venue_customers so future loads are fast and the mirror is consistent
        if (email) {
          supabaseAdmin.from('venue_customers').upsert(
            {
              venue_id:       venueId,
              customer_email: email,
              first_name:     firstName || null,
              last_name:      lastName  || null,
              phone:          (l.phone as string) || null,
              pipeline_id:    (l.pipeline_id as string) || null,
              stage_id:       (l.stage_id   as string) || null,
              pipeline_stage: (l.status     as string) || null,
              updated_at:     new Date().toISOString(),
            },
            { onConflict: 'venue_id,customer_email' },
          ).then(({ error: e }) => {
            if (e) console.warn('[mergeVenueContacts] backfill upsert warn:', e.message);
          });
        }
      }
    }
  } catch (err) {
    console.error('[mergeVenueContacts] leads fetch error:', err);
  }

  attachFunnelMetadata(merged, funnelLookup);
  attachVenueCustomerIds(merged, vcIdLookup);

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
            .includes(q) ||
          String(c.funnelStage || '')
            .toLowerCase()
            .includes(q)
        );
      })
    : merged;

  const total = filtered.length;
  const offset = (page - 1) * limit;
  const data = filtered.slice(offset, offset + limit);

  return { data, total };
}

/**
 * Resolve or create a `venue_customers` row for a merged contact so conversation threads
 * can use `venue_customer_id` (FK). Contacts list uses merge (GHL/LP/native); conversations
 * must anchor to StoryVenue customer rows.
 */
export async function ensureVenueCustomerIdForMergedContact(
  venueId: string,
  c: MergedContact,
): Promise<string | null> {
  const sid = String(c.id);
  const emailRaw = (c.email || '').trim().toLowerCase();

  if (UUID_RE.test(sid)) {
    const { data: byPk } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .eq('id', sid)
      .maybeSingle();
    if (byPk?.id) return byPk.id as string;
  }

  const { data: byGhl } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .eq('ghl_contact_id', sid)
    .maybeSingle();
  if (byGhl?.id) return byGhl.id as string;

  const { data: byLp } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .eq('lunarpay_customer_id', sid)
    .maybeSingle();
  if (byLp?.id) return byLp.id as string;

  if (
    emailRaw &&
    !emailRaw.endsWith('@storypay.internal') &&
    !emailRaw.includes('@ghl-sms.storypay.placeholder')
  ) {
    const { data: byEmail } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('customer_email', emailRaw)
      .maybeSingle();
    if (byEmail?.id) return byEmail.id as string;
  }

  const ghlId = c.source === 'ghl' ? sid : null;
  const lpId = c.source === 'lunarpay' ? sid : null;
  let ghlContactId = ghlId;
  let lunarpayCustomerId = lpId;
  if (c.source === 'storypay') {
    if (/^\d+$/.test(sid)) lunarpayCustomerId = sid;
    else if (!UUID_RE.test(sid)) ghlContactId = sid;
  }

  const customer_email =
    emailRaw ||
    (ghlContactId ? `ghl.${ghlContactId}@ghl-sms.storypay.placeholder` : '') ||
    `no-email-${sid.replace(/[^a-z0-9]/gi, '-')}@storypay.internal`;

  const { data: upserted, error } = await supabaseAdmin
    .from('venue_customers')
    .upsert(
      {
        venue_id: venueId,
        customer_email,
        first_name: c.firstName || '',
        last_name: c.lastName || '',
        phone: c.phone || null,
        ghl_contact_id: ghlContactId,
        lunarpay_customer_id: lunarpayCustomerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'venue_id,customer_email' },
    )
    .select('id')
    .single();

  if (error) {
    console.error('[ensureVenueCustomerIdForMergedContact]', error);
    return null;
  }
  return (upserted?.id as string) ?? null;
}
