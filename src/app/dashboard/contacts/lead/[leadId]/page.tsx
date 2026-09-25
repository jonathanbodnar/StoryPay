import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

/**
 * /dashboard/contacts/lead/{leadId} — open a LEAD's contact profile.
 *
 * The contact page is keyed by the venue_customers id, but the places that only
 * know a lead — the new-lead and AI-handoff notifications, LeadFinder's inbox
 * copy, the marketing analytics rows — linked straight to
 * /dashboard/contacts/{leadId}, which landed on "Contact not found". This
 * resolves the lead's contact by email (creating it when the lead never got
 * one, exactly as the Leads list does before it opens a profile) and redirects.
 */

export const dynamic = 'force-dynamic';

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

async function resolveContactIdForLead(venueId: string, leadId: string): Promise<string | null> {
  if (!UUID_RE.test(leadId)) return null;

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('email, first_name, last_name, name, phone')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!lead) {
    // Not a lead of this venue — it may already be a contact id (an old link).
    const { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    return (vc as { id: string } | null)?.id ?? null;
  }

  const row = lead as { email: string | null; first_name: string | null; last_name: string | null; name: string | null; phone: string | null };
  const email = (row.email ?? '').trim().toLowerCase();
  if (!email) return null;

  const findByEmail = async () => {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .limit(1)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };

  const existing = await findByEmail();
  if (existing) return existing;

  const { data: created, error } = await supabaseAdmin
    .from('venue_customers')
    .insert({
      venue_id: venueId,
      customer_email: email,
      first_name: row.first_name?.trim() || row.name?.trim().split(/\s+/)[0] || null,
      last_name: row.last_name?.trim() || null,
      phone: row.phone?.trim() || null,
    })
    .select('id')
    .single();
  if (created) return (created as { id: string }).id;
  // A concurrent open created it first.
  if (error?.code === '23505') return findByEmail();
  console.error('[contacts/lead] could not resolve contact for lead', leadId, error?.message);
  return null;
}

export default async function OpenLeadContactPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const venueId = await getVenueId();
  if (!venueId) redirect('/login');

  const contactId = await resolveContactIdForLead(venueId, leadId);
  redirect(contactId ? `/dashboard/contacts/${contactId}` : '/dashboard/leads');
}
