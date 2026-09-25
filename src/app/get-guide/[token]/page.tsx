/**
 * /get-guide/[token] — where the gated "Send me my guide" email lands.
 *
 * Venue-branded page with the couple's details prefilled; one button sends the
 * guide by text and email (see GetGuideForm and /api/public/get-guide).
 *
 * Rendering this page has NO side effects: email link scanners (Outlook Safe
 * Links, Gmail previews) open every link in an email, so only the explicit tap
 * on the button — a POST — does anything.
 */

import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyGuideInviteToken } from '@/lib/guide-invite-token';
import {
  guidePageConsentText,
  SMS_CONSENT_PRIVACY_PATH,
  SMS_CONSENT_TERMS_PATH,
} from '@/lib/sms-consent-disclosure';
import GetGuideForm from '@/components/public/GetGuideForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Your pricing guide',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ token: string }>;
}

/** "+14075550142" → "(407) 555-0142" for the prefilled field. */
function displayPhone(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  const us = /^\+?1?(\d{3})(\d{3})(\d{4})$/.exec(v.replace(/[^\d+]/g, ''));
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : v;
}

function Expired() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900">This link has expired</h1>
        <p className="mt-2 text-sm text-gray-500">
          Reply to the email you received and the venue will send your pricing guide right over.
        </p>
      </div>
    </main>
  );
}

export default async function GetGuidePage({ params }: Props) {
  const { token: raw } = await params;
  const ids = verifyGuideInviteToken(raw) ?? verifyGuideInviteToken(decodeURIComponent(raw));
  if (!ids) return <Expired />;
  const { leadId, venueId } = ids;

  const [{ data: leadRow }, { data: venueRow }, { data: inviteRow }] = await Promise.all([
    supabaseAdmin
      .from('leads')
      .select('first_name, name, email, phone, wedding_date')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle(),
    supabaseAdmin
      .from('venues')
      .select('name, logo_url, brand_logo_url, brand_color, location_city, location_state')
      .eq('id', venueId)
      .maybeSingle(),
    supabaseAdmin.from('guide_invites').select('tapped_at').eq('lead_id', leadId).maybeSingle(),
  ]);
  if (!leadRow || !venueRow) return <Expired />;

  const lead = leadRow as { first_name: string | null; name: string | null; email: string | null; phone: string | null; wedding_date: string | null };
  const venue = venueRow as {
    name: string | null;
    logo_url: string | null;
    brand_logo_url: string | null;
    brand_color: string | null;
    location_city: string | null;
    location_state: string | null;
  };
  const venueName = venue.name?.trim() || 'Our venue';
  const logo = venue.brand_logo_url || venue.logo_url;
  const location = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
  const firstName = (lead.first_name || lead.name?.split(/\s+/)[0] || '').trim() || null;
  const buttonColor = /^#[0-9a-f]{3,8}$/i.test(venue.brand_color ?? '') ? (venue.brand_color as string) : '#1b1b1b';
  const pdfUrl = `/api/public/venue/${venueId}/pricing-guide`;

  return (
    <div className="min-h-screen bg-stone-100">
      <header className="flex items-center gap-3 bg-[#1b1b1b] px-5 py-3.5 text-white">
        {logo && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={logo} alt={`${venueName} logo`} className="h-9 w-auto rounded object-contain" />
        )}
        <div>
          <div className="text-[15px] font-bold tracking-tight">{venueName}</div>
          {location && <div className="text-[11px] text-gray-400">{location}</div>}
        </div>
      </header>
      <main className="px-4 py-8">
        <GetGuideForm
          token={raw}
          venueId={venueId}
          leadId={leadId}
          venueName={venueName}
          firstName={firstName}
          initialPhone={displayPhone(lead.phone)}
          initialEmail={(lead.email ?? '').trim()}
          askWeddingDate={!lead.wedding_date}
          consentText={guidePageConsentText(venue.name)}
          privacyUrl={SMS_CONSENT_PRIVACY_PATH}
          termsUrl={SMS_CONSENT_TERMS_PATH}
          buttonColor={buttonColor}
          pdfUrl={pdfUrl}
          downloadUrl={`${pdfUrl}?dl=1`}
          alreadySent={!!(inviteRow as { tapped_at: string | null } | null)?.tapped_at}
        />
      </main>
    </div>
  );
}
