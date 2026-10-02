import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Couples see the venue, never StoryVenue (owner's decision): the browser tab
 * and link previews name the venue only. Not indexed.
 */
export async function generateMetadata({ params }: { params: Promise<{ proposalId: string }> }): Promise<Metadata> {
  const { proposalId } = await params;
  const { data: p } = await supabaseAdmin.from('proposals').select('venue_id').eq('id', proposalId).maybeSingle();
  const { data: v } = p?.venue_id
    ? await supabaseAdmin.from('venues').select('name').eq('id', p.venue_id).maybeSingle()
    : { data: null };
  const venue = (v?.name as string | undefined)?.trim() || '';
  const title = venue ? `Invoice from ${venue}` : 'Invoice';
  const description = 'Your invoice and payments.';
  return {
    title: { absolute: title },
    description,
    openGraph: { type: 'website', title, description, ...(venue ? { siteName: venue } : {}) },
    twitter: { card: 'summary', title, description },
    robots: { index: false, follow: false },
  };
}

export default function InvoiceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
