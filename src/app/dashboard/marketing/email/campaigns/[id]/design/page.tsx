import { notFound, redirect } from 'next/navigation';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { parseEmailDefinition } from '@/lib/marketing-email-schema';
import { CampaignFlodeskBuilder } from '@/components/email-builder/CampaignFlodeskBuilder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CampaignDesignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const venueId = await getVenueId();
  if (!venueId) redirect('/dashboard');

  const { id: campaignId } = await params;

  // Load the campaign
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('id, name, template_id, status')
    .eq('id', campaignId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (campErr || !campaign) notFound();

  // Load the campaign's template
  const { data: template, error: tmplErr } = await supabaseAdmin
    .from('marketing_email_templates')
    .select('id, name, subject, preheader, definition_json')
    .eq('id', campaign.template_id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (tmplErr || !template) notFound();

  // Load venue address + brand_socials for the Address and Social Links blocks.
  // brand_socials may not exist yet (pre-migration) — handle gracefully.
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, location_full, location_city, location_state, brand_socials')
    .eq('id', venueId)
    .maybeSingle();

  // Normalize brand_socials defensively — DB column may be missing or hold
  // legacy values from before the schema was tightened.
  const rawSocials = (venue as { brand_socials?: unknown } | null)?.brand_socials;
  const venueSocials = Array.isArray(rawSocials)
    ? rawSocials
        .map((s): { platform: string; url: string } | null => {
          if (!s || typeof s !== 'object') return null;
          const p = String((s as { platform?: unknown }).platform ?? '').trim().toLowerCase();
          const u = String((s as { url?: unknown }).url ?? '').trim();
          return p && u ? { platform: p, url: u } : null;
        })
        .filter((s): s is { platform: string; url: string } => s !== null)
    : [];

  return (
    <CampaignFlodeskBuilder
      campaignId={campaign.id}
      templateId={template.id}
      initialName={campaign.name}
      initialSubject={template.subject ?? ''}
      initialPreheader={template.preheader ?? ''}
      initialDefinition={parseEmailDefinition(template.definition_json)}
      venueAddress={venue ? {
        name: venue.name ?? '',
        location_full: venue.location_full,
        location_city: venue.location_city,
        location_state: venue.location_state,
      } : undefined}
      venueSocials={venueSocials}
    />
  );
}
