import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MarketingFormView } from '@/components/marketing-form/MarketingFormView';
import { parseDefinition } from '@/lib/marketing-form-schema';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) return { title: 'Form', robots: { index: false, follow: false } };
  const { data } = await supabaseAdmin
    .from('marketing_forms')
    .select('name')
    .eq('embed_token', token)
    .eq('published', true)
    .maybeSingle();
  return {
    title: data?.name ? `${data.name} | StoryPay` : 'Form',
    robots: { index: false, follow: false },
  };
}

export default async function PublicEmbedFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();

  const { data } = await supabaseAdmin
    .from('marketing_forms')
    .select('name, definition_json')
    .eq('embed_token', token)
    .eq('published', true)
    .maybeSingle();

  if (!data) notFound();

  const definition = parseDefinition(data.definition_json);

  return (
    <main className="min-h-screen">
      <MarketingFormView
        definition={definition}
        embedToken={token}
        formTitle={data.name}
      />
    </main>
  );
}
