import { notFound, redirect } from 'next/navigation';
import { EmailBuilderEditor } from '@/components/email-builder/EmailBuilderEditor';
import { getVenueId } from '@/lib/auth-helpers';
import { parseEmailDefinition } from '@/lib/marketing-email-schema';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function EmailTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) redirect('/dashboard');

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('marketing_email_templates')
    .select('id, name, subject, preheader, definition_json')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error || !data) notFound();

  return (
    <EmailBuilderEditor
      templateId={data.id}
      initialName={data.name}
      initialSubject={data.subject}
      initialPreheader={data.preheader}
      initialDefinition={parseEmailDefinition(data.definition_json)}
    />
  );
}
