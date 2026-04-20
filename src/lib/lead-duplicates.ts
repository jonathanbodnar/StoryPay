import { supabaseAdmin } from '@/lib/supabase';

export type DuplicateReason = 'same_email' | 'same_phone' | 'same_email_and_phone';

export function normalizeLeadEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Last 10 digits for loose match, or null if too short */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.slice(-10);
}

function reasonFor(emMatch: boolean, phMatch: boolean): DuplicateReason {
  if (emMatch && phMatch) return 'same_email_and_phone';
  if (emMatch) return 'same_email';
  return 'same_phone';
}

/**
 * After a new lead is inserted, find older leads with same email or phone and record open candidate rows.
 * Convention: lead_id = newer inquiry, matches_lead_id = older lead.
 */
export async function recordDuplicateCandidatesForNewLead(
  venueId: string,
  newLeadId: string,
  email: string,
  phone: string | null,
  createdAt: string,
): Promise<void> {
  const em = normalizeLeadEmail(email);
  const ph = normalizePhoneDigits(phone);
  if (!em && !ph) return;

  const { data: others, error } = await supabaseAdmin
    .from('leads')
    .select('id, email, phone, created_at')
    .eq('venue_id', venueId)
    .neq('id', newLeadId);

  if (error || !others?.length) return;

  const newCreated = new Date(createdAt).getTime();

  for (const row of others as Array<{ id: string; email: string; phone: string | null; created_at: string }>) {
    const oEm = normalizeLeadEmail(row.email);
    const oPh = normalizePhoneDigits(row.phone);
    const emMatch = em.length > 0 && oEm.length > 0 && oEm === em;
    const phMatch = Boolean(ph && oPh && ph === oPh);
    if (!emMatch && !phMatch) continue;

    const oldCreated = new Date(row.created_at).getTime();
    const newerId = newCreated >= oldCreated ? newLeadId : row.id;
    const olderId = newCreated >= oldCreated ? row.id : newLeadId;
    const r = reasonFor(emMatch, phMatch);

    const { error: insErr } = await supabaseAdmin.from('lead_duplicate_candidates').insert({
      venue_id: venueId,
      lead_id: newerId,
      matches_lead_id: olderId,
      reason: r,
      status: 'open',
    });

    if (insErr && !/duplicate key|unique constraint/i.test(insErr.message)) {
      console.warn('[recordDuplicateCandidatesForNewLead]', insErr.message);
    }
  }
}

/**
 * Recompute open duplicate rows involving this lead (e.g. after email/phone edit).
 */
export async function refreshDuplicateCandidatesForLead(venueId: string, leadId: string): Promise<void> {
  await supabaseAdmin
    .from('lead_duplicate_candidates')
    .delete()
    .eq('venue_id', venueId)
    .eq('status', 'open')
    .or(`lead_id.eq.${leadId},matches_lead_id.eq.${leadId}`);

  const { data: self, error } = await supabaseAdmin
    .from('leads')
    .select('id, email, phone, created_at')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error || !self) return;

  await recordDuplicateCandidatesForNewLead(
    venueId,
    (self as { id: string }).id,
    String((self as { email: string }).email ?? ''),
    (self as { phone: string | null }).phone,
    String((self as { created_at: string }).created_at),
  );
}

export type DuplicateMatchBrief = {
  other_lead_id: string;
  reason: DuplicateReason;
  name: string;
  email: string;
};

/**
 * Map of lead id -> open duplicate matches (the "other" lead ids with metadata).
 */
export async function fetchOpenDuplicateMatchesForLeads(
  venueId: string,
  leadIds: string[],
): Promise<Map<string, DuplicateMatchBrief[]>> {
  const out = new Map<string, DuplicateMatchBrief[]>();
  if (leadIds.length === 0) return out;

  const [{ data: rowsA }, { data: rowsB }] = await Promise.all([
    supabaseAdmin
      .from('lead_duplicate_candidates')
      .select('id, lead_id, matches_lead_id, reason')
      .eq('venue_id', venueId)
      .eq('status', 'open')
      .in('lead_id', leadIds),
    supabaseAdmin
      .from('lead_duplicate_candidates')
      .select('id, lead_id, matches_lead_id, reason')
      .eq('venue_id', venueId)
      .eq('status', 'open')
      .in('matches_lead_id', leadIds),
  ]);

  const seen = new Set<string>();
  const rows: Array<{ lead_id: string; matches_lead_id: string; reason: string }> = [];
  for (const r of [...(rowsA ?? []), ...(rowsB ?? [])]) {
    const x = r as { id: string; lead_id: string; matches_lead_id: string; reason: string };
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    rows.push(x);
  }

  if (!rows.length) return out;

  const needIds = new Set<string>();
  for (const r of rows as Array<{ lead_id: string; matches_lead_id: string }>) {
    needIds.add(r.lead_id);
    needIds.add(r.matches_lead_id);
  }

  const { data: names } = await supabaseAdmin
    .from('leads')
    .select('id, name, email')
    .eq('venue_id', venueId)
    .in('id', [...needIds]);

  const nameById = new Map(
    ((names ?? []) as Array<{ id: string; name: string; email: string }>).map((n) => [
      n.id,
      { name: n.name || '—', email: n.email || '' },
    ]),
  );

  function add(fromId: string, toId: string, reason: string) {
    const meta = nameById.get(toId);
    if (!meta) return;
    const list = out.get(fromId) ?? [];
    list.push({
      other_lead_id: toId,
      reason: reason as DuplicateReason,
      name: meta.name,
      email: meta.email,
    });
    out.set(fromId, list);
  }

  for (const r of rows as Array<{ lead_id: string; matches_lead_id: string; reason: string }>) {
    const reason = r.reason;
    if (leadIds.includes(r.lead_id)) add(r.lead_id, r.matches_lead_id, reason);
    if (leadIds.includes(r.matches_lead_id)) add(r.matches_lead_id, r.lead_id, reason);
  }

  return out;
}
