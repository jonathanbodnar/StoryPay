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

  // Load venue address for the Address block
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, location_full, location_city, location_state')
    .eq('id', venueId)
    .maybeSingle();

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
    />
  );
}
