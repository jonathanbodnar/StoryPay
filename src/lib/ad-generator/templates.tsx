/* eslint-disable @next/next/no-img-element */
/**
 * The operator's APPROVED 1080x1350 Meta ad layouts, built as Satori (next/og)
 * JSX. Only two designs are used:
 *
 *   A. Editorial (also reused for "showcase") — cream left panel with the venue
 *      NAME as a Playfair Display headline, short Open Sans bullet features, a
 *      charcoal down-arrow CTA, and a 3-photo vertical stack on the right.
 *   B. Pricing — full-bleed photo behind a light panel: Playfair promise
 *      headline, Open Sans bullets, a "Starting at $X" band, a rounded pill CTA,
 *      and 3 rounded photos down the right.
 *
 * Type rules (locked): Playfair Display for headlines, Open Sans for all body,
 * bullets and buttons.
 *
 * Satori rules honored: every element with >1 child sets display:'flex';
 * images are data URIs (see images.ts); the arrow is inline SVG.
 */

import React from 'react';
import { AD_WIDTH, AD_HEIGHT, type AdCopyVariant, type TemplateKey, type VenueAdData } from './spec';

export interface TemplateProps {
  venue: VenueAdData;
  variant: AdCopyVariant;
  /** Pre-cropped photos as JPEG data URIs, one per slot in TEMPLATE_SLOTS. */
  images: string[];
  /** Optional logo as a PNG data URI. */
  logoDataUrl: string | null;
}

/** Ordered photo slots each template needs, cropped cover to these dimensions. */
export const TEMPLATE_SLOTS: Record<TemplateKey, { w: number; h: number }[]> = {
  editorial: [{ w: 612, h: 632 }, { w: 612, h: 353 }, { w: 612, h: 353 }],
  showcase: [{ w: 612, h: 632 }, { w: 612, h: 353 }, { w: 612, h: 353 }],
  pricing: [{ w: 1080, h: 1350 }, { w: 360, h: 380 }, { w: 360, h: 380 }, { w: 360, h: 380 }],
};

const CREAM = '#F3EFE7';
const INK = '#262626';
const BODY = '#3b3b3b';
const CHARCOAL = '#2E2E2E';
const SERIF = 'Playfair Display';
const SANS = 'Open Sans';

function Dot({ color = INK }: { color?: string }) {
  return <div style={{ display: 'flex', width: 9, height: 9, borderRadius: 9, backgroundColor: color, marginTop: 12, flexShrink: 0 }} />;
}

function BulletList({ items, color, size = 25 }: { items: string[]; color: string; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((b, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <Dot color={color} />
          <span style={{ fontFamily: SANS, fontWeight: 400, fontSize: size, color, lineHeight: 1.25 }}>{b}</span>
        </div>
      ))}
    </div>
  );
}

/** Charcoal downward banner/arrow with the download CTA (Template A). */
function DownArrowCta() {
  const W = 300;
  const H = 150;
  return (
    <div style={{ display: 'flex', position: 'relative', width: W, height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', top: 0, left: 0 }}>
        <polygon points={`0,0 ${W},0 ${W},105 ${W / 2},${H} 0,105`} fill={CHARCOAL} />
      </svg>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: 0,
          left: 0,
          width: W,
          height: 105,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18, letterSpacing: 2, color: '#fff' }}>DOWNLOAD</span>
        <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18, letterSpacing: 2, color: '#fff' }}>PRICING & AVAILABILITY</span>
        <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 18, letterSpacing: 2, color: '#fff' }}>GUIDE NOW</span>
      </div>
    </div>
  );
}

function headlineSize(name: string): number {
  const n = name.length;
  if (n > 28) return 46;
  if (n > 20) return 54;
  return 62;
}

// ── Template A: editorial / showcase ─────────────────────────────────────────
function Editorial({ venue, variant, images }: TemplateProps) {
  const LEFT_W = 468;
  const RIGHT_W = AD_WIDTH - LEFT_W;
  const name = (venue.name || 'Your Venue').toUpperCase();
  const bullets = variant.imageBullets.slice(0, 5);

  return (
    <div style={{ display: 'flex', width: AD_WIDTH, height: AD_HEIGHT, backgroundColor: CREAM }}>
      {/* Left editorial panel */}
      <div style={{ display: 'flex', position: 'relative', width: LEFT_W, height: AD_HEIGHT }}>
        {images[0] && (
          <img src={images[0]} width={LEFT_W} height={AD_HEIGHT} style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover', opacity: 0.06 }} alt="" />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', width: LEFT_W, height: AD_HEIGHT, padding: '52px 40px 44px', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            <span style={{ fontFamily: SERIF, fontWeight: 400, fontSize: headlineSize(name), lineHeight: 1.04, color: INK, letterSpacing: 1 }}>{name}</span>
            <BulletList items={bullets} color={BODY} />
          </div>
          <DownArrowCta />
        </div>
      </div>

      {/* Right 3-photo stack */}
      <div style={{ display: 'flex', flexDirection: 'column', width: RIGHT_W, height: AD_HEIGHT, backgroundColor: '#fff' }}>
        {images[0] && <img src={images[0]} width={RIGHT_W} height={632} style={{ objectFit: 'cover' }} alt="" />}
        <div style={{ display: 'flex', height: 6 }} />
        {images[1] && <img src={images[1]} width={RIGHT_W} height={353} style={{ objectFit: 'cover' }} alt="" />}
        <div style={{ display: 'flex', height: 6 }} />
        {images[2] && <img src={images[2]} width={RIGHT_W} height={353} style={{ objectFit: 'cover' }} alt="" />}
      </div>
    </div>
  );
}

// ── Template B: pricing ──────────────────────────────────────────────────────
function Pricing({ venue, variant, images }: TemplateProps) {
  const headline = (variant.imageHeadline || 'All-Inclusive Weddings');
  const bullets = variant.imageBullets.slice(0, 6);
  const price = venue.priceFrom;

  return (
    <div style={{ display: 'flex', position: 'relative', width: AD_WIDTH, height: AD_HEIGHT, backgroundColor: CREAM }}>
      {/* Full-bleed background photo */}
      {images[0] && <img src={images[0]} width={AD_WIDTH} height={AD_HEIGHT} style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover' }} alt="" />}
      {/* Light overlay so the left column stays readable */}
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: AD_WIDTH,
          height: AD_HEIGHT,
          backgroundImage:
            'linear-gradient(90deg, rgba(247,244,238,0.95) 0%, rgba(247,244,238,0.86) 42%, rgba(247,244,238,0.30) 70%, rgba(247,244,238,0) 100%)',
        }}
      />

      {/* Right rounded photo column */}
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', top: 96, right: 40, width: 360, gap: 22 }}>
        {[images[1], images[2], images[3]].map((src, i) =>
          src ? (
            <div key={i} style={{ display: 'flex', width: 360, height: 380, borderRadius: 22, overflow: 'hidden', border: '4px solid rgba(201,169,78,0.9)' }}>
              <img src={src} width={352} height={372} style={{ objectFit: 'cover' }} alt="" />
            </div>
          ) : null,
        )}
      </div>

      {/* Left content */}
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', top: 0, left: 0, width: 640, height: AD_HEIGHT, padding: '96px 48px', justifyContent: 'flex-start', gap: 26 }}>
        <span style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 66, lineHeight: 1.02, color: INK }}>{headline}</span>
        <BulletList items={bullets} color={BODY} size={26} />

        {price && (
          <div style={{ display: 'flex', alignItems: 'center', width: 520, marginTop: 8, padding: '14px 26px', backgroundColor: 'rgba(120,92,110,0.62)' }}>
            <span style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 44, color: '#fff' }}>Starting at {price}</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6, padding: '18px 30px', borderRadius: 999, backgroundColor: '#6C99A6', width: 'fit-content' }}>
          <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 34, color: '#fff' }}>Download the pricing guide</span>
          <div style={{ display: 'flex', width: 44, height: 44, borderRadius: 44, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="#6C99A6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

const TEMPLATES: Record<TemplateKey, (p: TemplateProps) => React.ReactElement> = {
  editorial: Editorial,
  showcase: Editorial,
  pricing: Pricing,
};

export function adTemplateElement(key: TemplateKey, props: TemplateProps): React.ReactElement {
  const Comp = TEMPLATES[key] ?? Editorial;
  return <Comp {...props} />;
}
