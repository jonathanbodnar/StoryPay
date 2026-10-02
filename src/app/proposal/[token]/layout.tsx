import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Couples see the venue, never StoryVenue (owner's decision): the browser tab
 * and link previews (texts, email) name the venue only. Not indexed.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const { data: p } = await supabaseAdmin.from('proposals').select('venue_id, is_invoice').eq('public_token', token).maybeSingle();
  const { data: v } = p?.venue_id
    ? await supabaseAdmin.from('venues').select('name').eq('id', p.venue_id).maybeSingle()
    : { data: null };
  const venue = (v?.name as string | undefined)?.trim() || '';
  const kind = p?.is_invoice ? 'Invoice' : 'Proposal';
  const title = venue ? `${kind} from ${venue}` : kind;
  const description = p?.is_invoice ? 'View and pay your invoice.' : 'Review and sign your proposal.';
  return {
    title: { absolute: title },
    description,
    openGraph: { type: 'website', title, description, ...(venue ? { siteName: venue } : {}) },
    twitter: { card: 'summary', title, description },
    robots: { index: false, follow: false },
  };
}

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
