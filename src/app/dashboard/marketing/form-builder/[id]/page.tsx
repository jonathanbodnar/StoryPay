import { notFound, redirect } from 'next/navigation';
import { FormBuilderEditor } from '@/components/form-builder/FormBuilderEditor';
import { getVenueId } from '@/lib/auth-helpers';
import { parseDefinition } from '@/lib/marketing-form-schema';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function FormBuilderEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const venueId = await getVenueId();
  if (!venueId) redirect('/dashboard');

  const { id } = await params;
  const { data, error } = await supabaseAdmin
    .from('marketing_forms')
    .select('id, name, embed_token, published, definition_json')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error || !data) notFound();

  return (
    <FormBuilderEditor
      formId={data.id}
      initialName={data.name}
      initialPublished={data.published}
      initialDefinition={parseDefinition(data.definition_json)}
      embedToken={data.embed_token}
    />
  );
}
