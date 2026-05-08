/**
 * Public pricing guide preview page.
 *
 * URL: /venue/[venueId]/guide
 *
 * Opened when a bride clicks the {{pricing_guide_url}} link in an
 * email or SMS.  Shows the PDF inline so she can read it in the browser
 * and provides a prominent Download button so she can save it.
 *
 * The PDF itself is served by:
 *   GET /api/public/venue/[venueId]/pricing-guide          → inline (preview)
 *   GET /api/public/venue/[venueId]/pricing-guide?dl=1    → attachment (download)
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { GuideViewTracker } from '@/components/public/GuideViewTracker';

interface Props {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { venueId } = await params;
  const { data } = await supabaseAdmin
    .from('venues')
    .select('name')
    .eq('id', venueId)
    .maybeSingle();
  const name = data?.name ?? 'Venue';
  return {
    title: `${name} — Pricing & Availability Guide`,
    description: `View and download the Pricing & Availability Guide for ${name}.`,
  };
}

export default async function GuidePage({ params, searchParams }: Props) {
  const { venueId } = await params;
  const sp = await searchParams;
  const leadId = typeof sp.l === 'string' ? sp.l.trim() : '';

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, logo_url, location_city, location_state')
    .eq('id', venueId)
    .maybeSingle();

  if (!venue) notFound();

  const venueName     = venue.name ?? 'Our Venue';
  const location      = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
  const pdfUrl        = `/api/public/venue/${venueId}/pricing-guide`;
  const downloadUrl   = `${pdfUrl}?dl=1`;

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#f5f5f4', minHeight: '100vh' }}>
      {/* Client-side tracker — logs guide view to the contact's thread */}
      {leadId && <GuideViewTracker venueId={venueId} leadId={leadId} />}

      {/* Top bar */}
      <header style={{
        background: '#1b1b1b',
        color: '#fff',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {venue.logo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={venue.logo_url}
              alt={`${venueName} logo`}
              style={{ height: 36, width: 'auto', objectFit: 'contain', borderRadius: 4 }}
            />
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>{venueName}</div>
            {location && <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{location}</div>}
          </div>
        </div>

        <a
          href={downloadUrl}
          download
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            background: '#fff',
            color: '#1b1b1b',
            fontWeight: 700,
            fontSize: 13,
            borderRadius: 8,
            padding: '9px 18px',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download PDF
        </a>
      </header>

      {/* Subheader */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: '#6b7280' }}>Pricing &amp; Availability Guide</span>
        <span style={{ fontSize: 12, color: '#d1d5db' }}>·</span>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>Always up to date</span>
      </div>

      {/* PDF viewer — fills the rest of the screen */}
      <div style={{ padding: '0' }}>
        {/* Desktop / tablet: native iframe PDF viewer */}
        <iframe
          src={pdfUrl}
          title={`${venueName} Pricing Guide`}
          style={{
            display: 'block',
            width: '100%',
            height: 'calc(100vh - 105px)',
            border: 'none',
            background: '#f5f5f4',
          }}
          className="pdf-frame"
        />
      </div>

      {/* Mobile fallback — shown via CSS when iframe is not useful */}
      <style>{`
        @media (max-width: 640px) {
          .pdf-frame { display: none !important; }
          .mobile-cta { display: flex !important; }
        }
        .mobile-cta { display: none; }
      `}</style>

      <div className="mobile-cta" style={{
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '48px 24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, lineHeight: 1 }}>📄</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#1b1b1b', marginBottom: 6 }}>
            {venueName} — Pricing Guide
          </div>
          <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>
            Tap the button below to open or save the full Pricing &amp; Availability Guide.
          </div>
        </div>
        <a
          href={downloadUrl}
          download
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            background: '#1b1b1b',
            color: '#fff',
            fontWeight: 700,
            fontSize: 15,
            borderRadius: 12,
            padding: '14px 28px',
            textDecoration: 'none',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download Pricing Guide
        </a>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: '#6b7280', textDecoration: 'underline' }}
        >
          Open in browser instead
        </a>
      </div>
    </div>
  );
}
