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

/** Ordered photo slots each template needs, cropped cover to these dimensions.
 *  Editorial mirrors the Coto Valley reference exactly: a 50/50 split, then a
 *  tall top photo (~52%) over two shorter photos (~22% / ~25%) with 6px gaps. */
export const TEMPLATE_SLOTS: Record<TemplateKey, { w: number; h: number }[]> = {
  editorial: [{ w: 540, h: 700 }, { w: 540, h: 300 }, { w: 540, h: 338 }],
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

function BulletList({ items, color, size = 25, gap = 12 }: { items: string[]; color: string; size?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
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
function DownArrowCta({ w = 292, h = 158 }: { w?: number; h?: number }) {
  const rect = Math.round(h * 0.7); // height of the rectangular text area
  const fs = Math.max(16, Math.round(w * 0.054));
  const ls = Math.max(2, Math.round(w * 0.008));
  const line = { fontFamily: SANS, fontWeight: 700 as const, fontSize: fs, letterSpacing: ls, color: '#fff' };
  return (
    <div style={{ display: 'flex', position: 'relative', width: w, height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', top: 0, left: 0 }}>
        <polygon points={`0,0 ${w},0 ${w},${rect} ${w / 2},${h} 0,${rect}`} fill={CHARCOAL} />
      </svg>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          top: 0,
          left: 0,
          width: w,
          height: rect,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
        }}
      >
        <span style={line}>DOWNLOAD</span>
        <span style={line}>PRICING & AVAILABILITY</span>
        <span style={line}>GUIDE NOW</span>
      </div>
    </div>
  );
}

function promiseSize(text: string): number {
  const n = text.length;
  if (n > 42) return 46;
  if (n > 32) return 52;
  if (n > 22) return 58;
  return 64;
}

// ── Template A: editorial ────────────────────────────────────────────────────
// Coto Valley reference layout (true 50/50 split, faint ghost, tall top photo
// over two shorter photos, charcoal down-arrow CTA) — now with a small venue-name
// eyebrow above a big, high-converting PROMISE headline, and a large CTA that
// fills most of the panel width so the composition reads balanced.
function Editorial({ venue, variant, images }: TemplateProps) {
  const LEFT_W = 540;
  const RIGHT_W = AD_WIDTH - LEFT_W; // 540
  const name = (venue.name || 'Your Venue').toUpperCase();
  const headline = variant.imageHeadline || 'Where Your Story Begins';
  const bullets = variant.imageBullets.slice(0, 6);

  return (
    <div style={{ display: 'flex', width: AD_WIDTH, height: AD_HEIGHT, backgroundColor: CREAM }}>
      {/* Left editorial panel */}
      <div style={{ display: 'flex', position: 'relative', width: LEFT_W, height: AD_HEIGHT, backgroundColor: CREAM }}>
        {/* Faint ghost photo (behind everything) */}
        {images[2] && (
          <img
            src={images[2]}
            width={LEFT_W}
            height={AD_HEIGHT}
            style={{ position: 'absolute', top: 0, left: 0, objectFit: 'cover', opacity: 0.16 }}
            alt=""
          />
        )}
        {/* Cream gradient mask: solid at the top (keeps headline + bullets crisp),
            fading down so the ghost only whispers through the lower-left.
            (Satori paints in DOM order, so this sits above the ghost and the
            content below sits above both — no z-index needed.) */}
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            top: 0,
            left: 0,
            width: LEFT_W,
            height: AD_HEIGHT,
            backgroundImage:
              'linear-gradient(180deg, rgba(243,239,231,1) 0%, rgba(243,239,231,0.98) 30%, rgba(243,239,231,0.72) 55%, rgba(243,239,231,0.35) 100%)',
          }}
        />
        {/* Content — three evenly distributed groups (headline / bullets / CTA)
            so the type fills the panel and there is no big empty gap. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            width: LEFT_W,
            height: AD_HEIGHT,
            padding: '62px 40px 36px',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <span style={{ fontFamily: SANS, fontWeight: 600, fontSize: 22, letterSpacing: 4, color: '#8a857b', textTransform: 'uppercase' }}>{name}</span>
            <span style={{ fontFamily: SERIF, fontWeight: 400, fontSize: promiseSize(headline), lineHeight: 1.08, color: INK }}>{headline}</span>
          </div>
          <BulletList items={bullets} color={BODY} size={28} gap={20} />
          {/* Big CTA: a little narrower than the panel with equal side + below gaps */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <DownArrowCta w={404} h={212} />
          </div>
        </div>
      </div>

      {/* Right 3-photo stack (6px white gaps) */}
      <div style={{ display: 'flex', flexDirection: 'column', width: RIGHT_W, height: AD_HEIGHT, backgroundColor: '#fff' }}>
        {images[0] && <img src={images[0]} width={RIGHT_W} height={700} style={{ objectFit: 'cover' }} alt="" />}
        <div style={{ display: 'flex', height: 6 }} />
        {images[1] && <img src={images[1]} width={RIGHT_W} height={300} style={{ objectFit: 'cover' }} alt="" />}
        <div style={{ display: 'flex', height: 6 }} />
        {images[2] && <img src={images[2]} width={RIGHT_W} height={338} style={{ objectFit: 'cover' }} alt="" />}
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
  pricing: Pricing,
};

export function adTemplateElement(key: TemplateKey, props: TemplateProps): React.ReactElement {
  const Comp = TEMPLATES[key] ?? Editorial;
  return <Comp {...props} />;
}
