/* eslint-disable @next/next/no-img-element */
/**
 * The three 1080x1350 Meta ad layouts, built as Satori (next/og) JSX.
 *
 * Satori rules honored here:
 *  - every element that has >1 child sets `display: 'flex'`;
 *  - images are data URIs (see images.ts) so there is no network fetch;
 *  - the check + arrow marks are inline SVG so we never depend on a font glyph
 *    that Google's latin subset might not include.
 *
 * Each template gets the same props; the route decides which hero photo to feed
 * each one so the three creatives look genuinely different.
 */

import React from 'react';
import { AD_WIDTH, AD_HEIGHT, type AdCopyVariant, type TemplateKey, type VenueAdData } from './spec';

export interface TemplateProps {
  venue: VenueAdData;
  variant: AdCopyVariant;
  /** Pre-cropped hero photo as a JPEG data URI, sized for the slot. */
  heroDataUrl: string;
  /** Optional logo as a PNG data URI. */
  logoDataUrl: string | null;
}

const CREAM = '#F7F3EC';
const INK = '#1f2937';
const GREEN = '#16a34a';

function readableBrand(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#293745';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Very light brand colors read poorly as a CTA / accent — darken to a safe ink.
  return lum > 0.72 ? '#293745' : hex;
}

function Check({ size = 34, bg = GREEN }: { size?: number; bg?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17l-5-5" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ArrowBadge({ color }: { color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        width: 56,
        height: 56,
        borderRadius: 56,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={26} height={26} viewBox="0 0 24 24" fill="none">
        <path d="M5 12h14M13 6l6 6-6 6" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function CtaBar({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: color,
        borderRadius: 999,
        padding: '18px 22px 18px 34px',
      }}
    >
      <span style={{ color: '#ffffff', fontFamily: 'Montserrat', fontWeight: 700, fontSize: 34 }}>{label}</span>
      <ArrowBadge color={color} />
    </div>
  );
}

function LogoChip({ src }: { src: string }) {
  return (
    <div
      style={{
        display: 'flex',
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: '12px 18px',
        alignItems: 'center',
        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
      }}
    >
      <img src={src} height={56} style={{ objectFit: 'contain' }} alt="" />
    </div>
  );
}

function Kicker({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontFamily: 'Montserrat',
        fontWeight: 700,
        fontSize: 24,
        letterSpacing: 4,
        textTransform: 'uppercase',
        color,
      }}
    >
      {text}
    </span>
  );
}

// ── Editorial: hero on top, cream editorial panel below ──────────────────────
function Editorial({ venue, variant, heroDataUrl, logoDataUrl }: TemplateProps) {
  const brand = readableBrand(venue.brandColor);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: AD_WIDTH, height: AD_HEIGHT, backgroundColor: CREAM }}>
      <div style={{ display: 'flex', position: 'relative', width: AD_WIDTH, height: 760 }}>
        <img src={heroDataUrl} width={AD_WIDTH} height={760} style={{ objectFit: 'cover' }} alt="" />
        {logoDataUrl && (
          <div style={{ display: 'flex', position: 'absolute', top: 34, left: 40 }}>
            <LogoChip src={logoDataUrl} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '44px 56px 52px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Kicker text={variant.kicker} color={brand} />
          <span
            style={{
              fontFamily: 'Playfair Display',
              fontWeight: 700,
              fontSize: 66,
              lineHeight: 1.05,
              color: INK,
              marginTop: 14,
            }}
          >
            {variant.imageHeadline}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30, gap: 16 }}>
            {variant.imageBullets.slice(0, 4).map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Check />
                <span style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 32, color: INK }}>{b}</span>
              </div>
            ))}
          </div>
        </div>
        <CtaBar label={variant.imageCta} color={brand} />
      </div>
    </div>
  );
}

// ── Bold: full-bleed hero, dark scrim, copy anchored to the bottom ───────────
function Bold({ venue, variant, heroDataUrl, logoDataUrl }: TemplateProps) {
  const brand = readableBrand(venue.brandColor);
  return (
    <div style={{ display: 'flex', position: 'relative', width: AD_WIDTH, height: AD_HEIGHT }}>
      <img src={heroDataUrl} width={AD_WIDTH} height={AD_HEIGHT} style={{ objectFit: 'cover' }} alt="" />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: AD_WIDTH,
          height: AD_HEIGHT,
          backgroundImage:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.05) 34%, rgba(0,0,0,0.35) 62%, rgba(0,0,0,0.88) 100%)',
        }}
      />
      {logoDataUrl && (
        <div style={{ display: 'flex', position: 'absolute', top: 40, left: 44 }}>
          <LogoChip src={logoDataUrl} />
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: AD_WIDTH,
          padding: '0 56px 56px',
        }}
      >
        <Kicker text={variant.kicker} color="#ffffff" />
        <span
          style={{
            fontFamily: 'Playfair Display',
            fontWeight: 700,
            fontSize: 82,
            lineHeight: 1.02,
            color: '#ffffff',
            marginTop: 12,
          }}
        >
          {variant.imageHeadline}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26, marginBottom: 32, gap: 14 }}>
          {variant.imageBullets.slice(0, 4).map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Check size={32} />
              <span style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 32, color: '#ffffff' }}>{b}</span>
            </div>
          ))}
        </div>
        <CtaBar label={variant.imageCta} color={brand} />
      </div>
    </div>
  );
}

// ── Photo-forward: big photo, minimal floating card ──────────────────────────
function Photo({ venue, variant, heroDataUrl, logoDataUrl }: TemplateProps) {
  const brand = readableBrand(venue.brandColor);
  return (
    <div style={{ display: 'flex', position: 'relative', width: AD_WIDTH, height: AD_HEIGHT, backgroundColor: '#000' }}>
      <img src={heroDataUrl} width={AD_WIDTH} height={AD_HEIGHT} style={{ objectFit: 'cover' }} alt="" />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: AD_WIDTH,
          height: AD_HEIGHT,
          backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 30%)',
        }}
      />
      {logoDataUrl && (
        <div style={{ display: 'flex', position: 'absolute', top: 40, left: 0, width: AD_WIDTH, justifyContent: 'center' }}>
          <LogoChip src={logoDataUrl} />
        </div>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          left: 44,
          right: 44,
          bottom: 44,
          width: AD_WIDTH - 88,
          backgroundColor: 'rgba(255,255,255,0.96)',
          borderRadius: 28,
          padding: '38px 40px 34px',
        }}
      >
        <Kicker text={variant.kicker} color={brand} />
        <span
          style={{
            fontFamily: 'Playfair Display',
            fontWeight: 700,
            fontSize: 58,
            lineHeight: 1.04,
            color: INK,
            marginTop: 10,
          }}
        >
          {variant.imageHeadline}
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 22, marginBottom: 30, gap: 14 }}>
          {variant.imageBullets.slice(0, 3).map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Check size={30} />
              <span style={{ fontFamily: 'Montserrat', fontWeight: 600, fontSize: 30, color: INK }}>{b}</span>
            </div>
          ))}
        </div>
        <CtaBar label={variant.imageCta} color={brand} />
      </div>
    </div>
  );
}

const TEMPLATES: Record<TemplateKey, (p: TemplateProps) => React.ReactElement> = {
  editorial: Editorial,
  bold: Bold,
  photo: Photo,
};

/** Slot dimensions each template wants its hero cropped to (cover). */
export const HERO_SLOT: Record<TemplateKey, { w: number; h: number }> = {
  editorial: { w: AD_WIDTH, h: 760 },
  bold: { w: AD_WIDTH, h: AD_HEIGHT },
  photo: { w: AD_WIDTH, h: AD_HEIGHT },
};

export function adTemplateElement(key: TemplateKey, props: TemplateProps): React.ReactElement {
  const Comp = TEMPLATES[key] ?? Editorial;
  return <Comp {...props} />;
}
