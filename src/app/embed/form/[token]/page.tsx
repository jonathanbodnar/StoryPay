import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  MarketingFormView,
  type VenueContactInfo,
} from '@/components/marketing-form/MarketingFormView';
import { parseDefinition } from '@/lib/marketing-form-schema';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function venueContactFromVenueRow(v: {
  name?: string | null;
  brand_email?: string | null;
  brand_phone?: string | null;
  brand_address?: string | null;
  brand_city?: string | null;
  brand_state?: string | null;
  brand_zip?: string | null;
}): VenueContactInfo {
  const city = v.brand_city?.trim() ?? '';
  const state = v.brand_state?.trim() ?? '';
  const zip = v.brand_zip?.trim() ?? '';
  const line2 = [city, state, zip].filter(Boolean).join(', ');
  const addrParts = [v.brand_address?.trim() ?? '', line2].filter(Boolean);
  return {
    venueName: v.name ?? null,
    email: v.brand_email ?? null,
    phone: v.brand_phone ?? null,
    addressLine: addrParts.length ? addrParts.join('\n') : null,
  };
}

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

  const { data: form } = await supabaseAdmin
    .from('marketing_forms')
    .select('name, definition_json, venue_id')
    .eq('embed_token', token)
    .eq('published', true)
    .maybeSingle();

  if (!form) notFound();

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, brand_email, brand_phone, brand_address, brand_city, brand_state, brand_zip')
    .eq('id', form.venue_id)
    .maybeSingle();

  const definition = parseDefinition(form.definition_json);
  const venueContact = venue ? venueContactFromVenueRow(venue) : null;

  return (
    <main className="min-h-screen">
      <MarketingFormView
        definition={definition}
        embedToken={token}
        formTitle={form.name}
        venueContact={venueContact}
      />
    </main>
  );
}
