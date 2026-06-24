/**
 * Server-side pricing guide PDF generator — premium magazine layout.
 *
 * jsPDF v4.2.1, unit mm, A4. Runs in any Node.js environment (no browser
 * globals). The two server-safe image helpers (fetchImageWithDims +
 * readImageDimensions) and the runtime TTF font loaders are kept; the page
 * drawing has been rewritten into a magazine-style "Pricing & Planning Guide".
 *
 * Returns a Buffer of raw PDF bytes. The caller sets Content-Type /
 * Content-Disposition headers.
 */

// ─── Shared types ────────────────────────────────────────────────────────

type GalleryItem  = { url: string; caption?: string };
type ReviewItem   = { author?: string; location?: string; body?: string; rating?: number };
type Space        = { id: string; name: string | null; description: string | null; capacity: string | null; image_url: string | null };
type Accommodation = { id: string; name: string | null; description: string | null; image_url: string | null };
type Package      = { id: string; name: string | null; price_label: string | null; description: string | null; included_items: string[] };

export interface GuideData {
  cover_image_url:          string | null;
  cover_source_image_url:   string | null;
  congratulatory_message:   string | null;
  gallery:                  GalleryItem[];
  about_photos:             GalleryItem[];
  about_venue:              string | null;
  accommodations_text:      string | null;
  accommodations_photos:    GalleryItem[];
  accommodations_image_url: string | null;
  pricing_intro:            string | null;
  reviews:                  ReviewItem[];
  availability_text:        string | null;
  availability_image_url:   string | null;
  cta_headline:             string | null;
  cta_body:                 string | null;
  cta_button_label:         string;
  spaces:                   Space[];
  accommodations:           Accommodation[];
  packages:                 Package[];
  // Optional editorial extras — guides always read as complete even before
  // customization. Populated later when the owner edits; until then the
  // renderer falls back to evergreen, venue-named copy.
  why_points?:              string[];
  journey?:                 [string, string][];   // [title, body]
  faqs?:                    [string, string][];   // [question, answer]
}

export interface VenueInfo {
  name:           string | null;
  location_city:  string | null;
  location_state: string | null;
  phone:          string | null;
  email:          string | null;
  address_full:   string | null;
  lat:            number | null;
  lng:            number | null;
  logo_url:       string | null;
  website?:       string | null;   // from venues.social_links.website
  features?:      string[];        // from venues.features
}

// ─── Server-safe image helpers ──────────────────────────────────────────

/**
 * Fetch a remote image and return both the data-URL and the detected pixel
 * dimensions. Falls back to a 4:3 aspect ratio when dimensions cannot be read
 * from the image header.
 */
async function fetchImageWithDims(
  url: string,
): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = contentType.split(';')[0].trim();
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;

    const dims = readImageDimensions(buf, mime);
    return { dataUrl, ...dims };
  } catch {
    return null;
  }
}

/**
 * Read pixel dimensions from PNG or JPEG header bytes.
 * Returns { w, h } — falls back to 4:3 (1200×900) on failure.
 */
function readImageDimensions(buf: Buffer, mime: string): { w: number; h: number } {
  try {
    if (mime.includes('png') && buf.length >= 24) {
      const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (PNG_SIG.every((b, i) => buf[i] === b)) {
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      }
    }
    if ((mime.includes('jpeg') || mime.includes('jpg')) && buf.length >= 4) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          const h = buf.readUInt16BE(i + 5);
          const w = buf.readUInt16BE(i + 7);
          if (w > 0 && h > 0) return { w, h };
        }
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
    }
  } catch { /* fall through */ }
  return { w: 1200, h: 900 };
}

// ─── Font loaders (jsPDF only parses TTF; pull static TTFs at runtime) ────

type JsPDF = import('jspdf').jsPDF;

const FONT_BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@main';

async function registerTtf(
  doc: JsPDF, url: string, file: string, family: string, fallback: string,
): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fallback;
    const buf = Buffer.from(await res.arrayBuffer());
    (doc as unknown as { addFileToVFS: (n: string, d: string) => void })
      .addFileToVFS(file, buf.toString('base64'));
    (doc as unknown as { addFont: (f: string, n: string, s: string) => void })
      .addFont(file, family, 'normal');
    try {
      doc.setFont(family, 'normal');
      doc.setFontSize(12);
      doc.getTextWidth('test');
    } catch {
      return fallback;
    }
    return family;
  } catch {
    return fallback;
  }
}

/** Playfair Display Regular — the editorial serif. Falls back to "times". */
async function loadPlayfairDisplayServer(doc: JsPDF): Promise<string> {
  return registerTtf(
    doc,
    `${FONT_BASE}/ofl/playfairdisplay/static/PlayfairDisplay-Regular.ttf`,
    'PlayfairDisplay-Regular.ttf',
    'PlayfairDisplay',
    'times',
  );
}

/** Open Sans Regular — body copy. Falls back to "helvetica". */
async function loadOpenSansServer(doc: JsPDF): Promise<string> {
  return registerTtf(
    doc,
    `${FONT_BASE}/apache/opensans/static/OpenSans-Regular.ttf`,
    'OpenSans-Regular.ttf',
    'OpenSans',
    'helvetica',
  );
}

/** Open Sans SemiBold — tracked labels / emphasis. Falls back to body family. */
async function loadOpenSansSemiServer(doc: JsPDF, fallback: string): Promise<string> {
  return registerTtf(
    doc,
    `${FONT_BASE}/apache/opensans/static/OpenSans-SemiBold.ttf`,
    'OpenSans-SemiBold.ttf',
    'OpenSansSemi',
    fallback,
  );
}

/**
 * Pinyon Script — formal calligraphy for drop-caps, "Welcome", "Thank You",
 * package names and script subtitles. Falls back to the serif family.
 */
async function loadPinyonScriptServer(doc: JsPDF, fallback: string): Promise<string> {
  return registerTtf(
    doc,
    `${FONT_BASE}/ofl/pinyonscript/PinyonScript-Regular.ttf`,
    'PinyonScript-Regular.ttf',
    'PinyonScript',
    fallback,
  );
}

// ─── Main server generator ───────────────────────────────────────────────

type Img = { dataUrl: string; w: number; h: number };

export async function generatePricingGuidePdfServer(
  guide: GuideData,
  venue: VenueInfo,
): Promise<Buffer> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // ── Resolve the four font families up front ──────────────────────────
  const [serifFam, bodyFam] = await Promise.all([
    loadPlayfairDisplayServer(doc),
    loadOpenSansServer(doc),
  ]);
  const [bodySemiFam, scriptFam] = await Promise.all([
    loadOpenSansSemiServer(doc, bodyFam),
    loadPinyonScriptServer(doc, serifFam),
  ]);
  const F = {
    serif:     serifFam,
    serifBold: serifFam,
    script:    scriptFam,
    body:      bodyFam,
    bodySemi:  bodySemiFam,
  };

  // ── Geometry & palette (exact) ───────────────────────────────────────
  const W = 210, H = 297, MARGIN = 22, CONTENT_W = 166, CX = 105, FRAME = 0.8;
  const PAL = {
    paper: [239, 237, 232],
    ink:   [26, 26, 26],
    soft:  [74, 74, 74],
    mute:  [120, 118, 112],
    faint: [165, 162, 155],
    rule:  [196, 192, 184],
    box:   [231, 228, 221],
    white: [255, 255, 255],
  } as const;

  // ── Low-level jsPDF access ───────────────────────────────────────────
  const internal = doc as unknown as { internal: { scaleFactor: number; out: (s: string) => void } };
  const K   = () => internal.internal.scaleFactor;
  const out = (s: string) => internal.internal.out(s);
  const tc = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
  const fc = (c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);
  const dc = (c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
  const setG = (op: number) =>
    (doc as unknown as { setGState?: (g: unknown) => void }).setGState?.(
      new (doc as unknown as { GState: new (o: unknown) => unknown }).GState({ opacity: op }),
    );

  // ── Image prefetch → synchronous getter ──────────────────────────────
  const name = (venue.name ?? 'Our Venue').trim() || 'Our Venue';
  const coverSrc =
    guide.cover_image_url ?? guide.cover_source_image_url ?? guide.gallery[0]?.url ?? null;

  const urls = new Set<string>();
  const add = (u?: string | null) => { if (u) urls.add(u); };
  add(coverSrc);
  (guide.gallery ?? []).forEach((g) => add(g.url));
  (guide.about_photos ?? []).forEach((g) => add(g.url));
  (guide.accommodations_photos ?? []).forEach((g) => add(g.url));
  (guide.spaces ?? []).forEach((s) => add(s.image_url));
  (guide.accommodations ?? []).forEach((a) => add(a.image_url));
  add(guide.accommodations_image_url);
  add(guide.availability_image_url);

  const cache = new Map<string, Img | null>();
  await Promise.all(
    [...urls].map(async (u) => { cache.set(u, await fetchImageWithDims(u)); }),
  );
  const getImg = (u: string | null): Img | null => {
    if (!u) return null;
    return cache.get(u) ?? null;
  };

  // Decorative photo pool (gallery → about → spaces → cover), deduped, loaded.
  const decoUrls = [
    ...(guide.gallery ?? []).map((g) => g.url),
    ...(guide.about_photos ?? []).map((g) => g.url),
    ...(guide.spaces ?? []).map((s) => s.image_url),
    coverSrc,
  ].filter((u): u is string => !!u);
  const seen = new Set<string>();
  const pool: Img[] = [];
  for (const u of decoUrls) {
    if (seen.has(u)) continue;
    seen.add(u);
    const im = getImg(u);
    if (im) pool.push(im);
  }
  let pc = 0;
  const nextPhoto = (): Img | null => (pool.length ? pool[pc++ % pool.length] : null);

  // ── Shared drawing helpers ───────────────────────────────────────────
  function imgCover(im: Img | null, x: number, y: number, w: number, h: number) {
    if (!im) { fc(PAL.box); doc.rect(x, y, w, h, 'F'); return; }
    const scale = Math.max(w / im.w, h / im.h);
    const dw = im.w * scale, dh = im.h * scale;
    const dx = x - (dw - w) / 2, dy = y - (dh - h) / 2;
    const k = K(), pgH = H * k;
    out(`q ${(x * k).toFixed(3)} ${(pgH - (y + h) * k).toFixed(3)} ${(w * k).toFixed(3)} ${(h * k).toFixed(3)} re W n`);
    const fmt = im.dataUrl.startsWith('data:image/png') ? 'PNG'
              : im.dataUrl.startsWith('data:image/webp') ? 'WEBP' : 'JPEG';
    try { doc.addImage(im.dataUrl, fmt, dx, dy, dw, dh); } catch { /* skip */ }
    out('Q');
  }

  function overlay(x: number, y: number, w: number, h: number, op: number) {
    fc([0, 0, 0]);
    setG(op);
    doc.rect(x, y, w, h, 'F');
    setG(1);
  }

  function frame() {
    fc(PAL.white);
    doc.rect(0, 0, W, FRAME, 'F');
    doc.rect(0, H - FRAME, W, FRAME, 'F');
    doc.rect(0, 0, FRAME, H, 'F');
    doc.rect(W - FRAME, 0, FRAME, H, 'F');
  }

  /** Letter-spaced caps drawn char-by-char. align: left | center | right. */
  function tracked(
    text: string, x: number, y: number, size: number, gap: number,
    color: readonly number[], font: string, style: 'normal' = 'normal',
    align: 'left' | 'center' | 'right' = 'left',
  ) {
    doc.setFont(font, style);
    doc.setFontSize(size);
    tc(color);
    const chars = [...text];
    const widths = chars.map((ch) => doc.getTextWidth(ch));
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    chars.forEach((ch, i) => { doc.text(ch, cx, y); cx += widths[i] + gap; });
  }

  /** Tracked caps that auto-shrink size + gap to fit within maxW. */
  function fitTracked(
    text: string, x: number, y: number, size: number, gap: number, maxW: number,
    color: readonly number[], font: string, align: 'left' | 'center' | 'right' = 'center',
  ) {
    let s = size, g = gap;
    for (let i = 0; i < 8; i++) {
      doc.setFont(font, 'normal');
      doc.setFontSize(s);
      const chars = [...text];
      const total = chars.reduce((a, ch) => a + doc.getTextWidth(ch), 0) + g * Math.max(0, chars.length - 1);
      if (total <= maxW) break;
      s *= 0.92; g *= 0.85;
    }
    tracked(text, x, y, s, g, color, font, 'normal', align);
  }

  function shortRule(x: number, y: number, w = 14) {
    dc(PAL.rule);
    doc.setLineWidth(0.4);
    doc.line(x, y, x + w, y);
  }

  function fmtPhone(raw: string | null): string {
    const d = (raw ?? '').replace(/\D+/g, '');
    if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return raw ?? '';
  }

  // Draw a calligraphy initial at (x, baseline y) and return the x where the
  // following serif caps should begin. Script glyphs overhang their advance
  // width, so we pad past the advance to clear the flourish (0.353 = pt→mm).
  function scriptInitial(
    letter: string, x: number, y: number, sizePt: number,
    color: readonly number[] = PAL.ink,
  ): number {
    tc(color);
    doc.setFont(F.script, 'normal');
    doc.setFontSize(sizePt);
    doc.text(letter, x, y);
    const adv = doc.getTextWidth(letter);
    const overhang = sizePt * 0.353 * 0.30;
    return x + adv + overhang;
  }

  function wrap(text: string, w: number, size: number, font: string): string[] {
    doc.setFont(font, 'normal');
    doc.setFontSize(size);
    return doc.splitTextToSize(text, w) as string[];
  }

  // ── Contact line values ──────────────────────────────────────────────
  const phoneStr   = fmtPhone(venue.phone);
  const emailStr   = (venue.email ?? '').trim();
  const websiteStr = (venue.website ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
  const cityState  = [venue.location_city, venue.location_state].filter(Boolean).join(', ');

  // ── Page bookkeeping ─────────────────────────────────────────────────
  let PP = 1; // the cover sits on jsPDF's initial page
  const paper = () => { fc(PAL.paper); doc.rect(0, 0, W, H, 'F'); };
  const page  = () => { doc.addPage(); paper(); PP += 1; };
  const footer = () => {
    dc(PAL.rule);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, H - 16, W - MARGIN, H - 16);
    doc.setFont(F.body, 'normal');
    doc.setFontSize(8);
    tc(PAL.mute);
    doc.text(String(PP).padStart(2, '0'), W - MARGIN, H - 11, { align: 'right' });
    tracked(name.toUpperCase(), MARGIN, H - 11.3, 7, 1.1, PAL.mute, F.body, 'normal', 'left');
  };

  // ── Section presence (drives both the TOC predictor and the render) ──
  const hasAbout   = !!(guide.about_venue && guide.about_venue.trim());
  const pkgs       = (guide.packages ?? []).slice(0, 3);
  const hasPkgs    = pkgs.length > 0;
  const spaceList  = guide.spaces ?? [];
  const galleryAll = (guide.gallery ?? []).map((g) => getImg(g.url)).filter((x): x is Img => !!x);
  const hasGallery = galleryAll.length >= 3;
  const hasReviews = (guide.reviews ?? []).length > 0;
  const accList    = guide.accommodations ?? [];

  // ── TOC predictor — mirrors render order EXACTLY ─────────────────────
  let p = 2; // cover = 1, TOC = 2; first content section starts at 3
  const toc: [string, number][] = [];
  const consume = (n: number) => { const s = p + 1; p += n; return s; };
  const entry   = (label: string, n: number) => { const s = consume(n); toc.push([label, s]); return s; };

  entry('Welcome', 1);
  if (hasAbout) entry('Our Story', 1);
  entry('Why Book With Us', 1);
  entry('Your Journey', 1);
  consume(1); // statement spread (not in TOC)
  if (hasPkgs) entry('Packages', 1);
  if (spaceList.length) entry('The Spaces', spaceList.length);
  if (hasGallery) entry('Gallery', 1);
  if (hasReviews) entry('Kind Words', 1);
  entry("What's Included", 1);
  entry('Planning Checklist', 1);
  if (accList.length) entry('Accommodations', accList.length);
  entry('Questions & Answers', 1);
  entry('Get In Touch', 1);
  // thank-you consumes 1 more but isn't listed

  // ── Evergreen fallbacks ──────────────────────────────────────────────
  const whyPoints: string[] = (guide.why_points && guide.why_points.length)
    ? guide.why_points.slice(0, 2)
    : [
        `The day is yours. ${name} gives you the space, the setting, and the privacy to host a celebration that feels like you.`,
        `One team handles the details. Clear pricing, honest answers, and people who know this venue better than anyone.`,
      ];

  const journey: [string, string][] = (guide.journey && guide.journey.length)
    ? guide.journey.slice(0, 4)
    : [
        ['Tour the venue', `Walk the space in person. We show you every corner and answer your questions.`],
        ['Reserve your date', `Found the one? We hold your date and keep the booking simple.`],
        ['Plan together', `We help map timing, layout, and the details that make the day yours.`],
        ['Celebrate', `Arrive, relax, and be present. We handle the venue so you can enjoy it.`],
      ];

  const faqs: [string, string][] = (guide.faqs && guide.faqs.length)
    ? guide.faqs.slice(0, 4)
    : [
        ['How many guests can you host?',
          spaceList[0]?.capacity
            ? `Our main space seats ${spaceList[0].capacity.replace(/^up to\s*/i, 'up to ')}.`
            : `Tell us your guest count and we will confirm the right space for your celebration.`],
        ['What dates are available?',
          guide.availability_text?.trim() || `Dates book quickly. Send us your season and we will check availability.`],
        ["What's included?",
          `Your booking includes exclusive use of the space for your event. Ask us for the full list of what comes with your package.`],
        ['How do we book a tour?',
          `Use the contact details in this guide. We will set up a time that works for you.`],
      ];

  const includedItems: string[] = (venue.features && venue.features.length)
    ? venue.features.slice(0, 9)
    : [
        'Exclusive venue access', 'Tables and chairs', 'On-site parking',
        'Getting-ready space', 'Event coordination', 'Setup and cleanup',
        'Flexible vendor policy', 'Scenic photo spots', 'Ample guest parking',
      ];

  // ════════════════════════════════════════════════════════════════════
  // 1. COVER
  // ════════════════════════════════════════════════════════════════════
  imgCover(getImg(coverSrc), 0, 0, W, H);
  overlay(0, 0, W, H, 0.34);
  frame();

  tracked(name.toUpperCase(), CX, 42, 13, 2.4, PAL.white, F.serif, 'normal', 'center');

  {
    const baseY = H * 0.52;
    doc.setFont(F.script, 'normal'); doc.setFontSize(150);
    const pW = doc.getTextWidth('P');
    const rest = 'RICING GUIDE'; const gap = 1.4;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(45);
    let restW = 0; for (const ch of rest) restW += doc.getTextWidth(ch) + gap; restW -= gap;
    const startX = CX - (pW * 0.55 + restW) / 2;
    tc(PAL.white);
    doc.setFont(F.script, 'normal'); doc.setFontSize(150);
    doc.text('P', startX, baseY);
    tracked(rest, startX + pW * 0.55, baseY, 45, gap, PAL.white, F.serif, 'normal', 'left');
    doc.setFont(F.script, 'normal'); doc.setFontSize(30); tc(PAL.white);
    doc.text('Pricing & Planning', CX, baseY + 18, { align: 'center' });
  }

  {
    const contact = [phoneStr, emailStr, websiteStr].filter(Boolean).join('   ·   ');
    if (contact) {
      fitTracked(contact.toUpperCase(), CX, H - 26, 8.5, 1.4, CONTENT_W, PAL.white, F.body, 'center');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. TABLE OF CONTENTS
  // ════════════════════════════════════════════════════════════════════
  page();
  imgCover(getImg(coverSrc) ?? nextPhoto(), 0, 0, 86, H);
  frame();
  {
    const rx = 86 + 14;
    let y = MARGIN + 26;
    doc.setFont(F.script, 'normal'); doc.setFontSize(32); tc(PAL.ink);
    doc.text('Table of', rx, y); y += 15;
    tracked('CONTENTS', rx, y, 24, 1.6, PAL.ink, F.serif, 'normal', 'left'); y += 12;
    dc(PAL.rule); doc.setLineWidth(0.4); doc.line(rx, y, W - MARGIN, y); y += 11;
    toc.forEach(([label, pg]) => {
      doc.setFont(F.serif, 'normal'); doc.setFontSize(12.5); tc(PAL.soft);
      doc.text(label, rx, y);
      doc.setFont(F.bodySemi, 'normal'); doc.setFontSize(9); tc(PAL.mute);
      doc.text(String(pg).padStart(2, '0'), W - MARGIN, y, { align: 'right' });
      y += 9.5;
    });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 3. WELCOME
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    // Measured, centered wordmark: script W (80pt) + serif ELCOME (38pt).
    const wBaseline = 53;
    doc.setFont(F.script, 'normal'); doc.setFontSize(80);
    const wAdv = doc.getTextWidth('W');
    const wOver = 80 * 0.353 * 0.30;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(38);
    const eGap = 1.4;
    let eW = 0; for (const ch of 'ELCOME') eW += doc.getTextWidth(ch) + eGap; eW -= eGap;
    const wStart = CX - (wAdv + wOver + eW) / 2;
    const eX = scriptInitial('W', wStart, wBaseline, 80, PAL.ink);
    tracked('ELCOME', eX, wBaseline - 6, 38, eGap, PAL.ink, F.serif, 'normal', 'left');
    let y = wBaseline + 11;
    tracked('OUR DOORS, YOUR STORY', CX, y, 9, 2.2, PAL.mute, F.bodySemi, 'normal', 'center'); y += 14;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(15); tc(PAL.soft);
    doc.text('Where your celebration becomes a memory', CX, y, { align: 'center' }); y += 7;
    shortRule(CX - 7, y, 14); y += 10;

    const msg = guide.congratulatory_message?.trim()
      || `Welcome to ${name}. We are so glad you found us. This guide walks you through the spaces, the pricing, and the small details that make your day feel effortless.`;
    doc.setFont(F.body, 'normal'); doc.setFontSize(10.5); tc(PAL.soft);
    if (msg.length > 260) {
      const colW = (CONTENT_W - 12) / 2;
      const lines = wrap(msg, colW, 10.5, F.body);
      const half = Math.ceil(lines.length / 2);
      doc.text(lines.slice(0, half), MARGIN, y);
      doc.text(lines.slice(half), MARGIN + colW + 12, y);
      y += half * 5.1 + 10;
    } else {
      const lines = wrap(msg, CONTENT_W - 36, 10.5, F.body);
      doc.text(lines, CX, y, { align: 'center' }); y += lines.length * 5.1 + 10;
    }

    const ph = H - 24 - y;
    if (ph > 36) { imgCover(nextPhoto(), MARGIN, y, CONTENT_W, ph); }
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 4. ABOUT (only if about_venue)
  // ════════════════════════════════════════════════════════════════════
  if (hasAbout) {
    page();
    const body = (guide.about_venue ?? '').trim();
    const initial = body.charAt(0).toUpperCase() || 'A';
    const restBody = body.slice(1);

    // Measure the drop cap up front so we can size the indent + decide photo
    // height: short copy gets a taller photo so the page never sits half-empty.
    const dcSize = 46;
    doc.setFont(F.script, 'normal'); doc.setFontSize(dcSize);
    const dropW = doc.getTextWidth(initial);
    const indent = dropW + dcSize * 0.353 * 0.32;
    const lineH = 4.9;
    const fullLines = wrap(restBody, CONTENT_W, 10, F.body);
    const photoH = fullLines.length <= 8 ? 176 : 150;

    const aboutImg = getImg(guide.about_photos?.[0]?.url ?? null) ?? nextPhoto();
    imgCover(aboutImg, 0, 0, W, photoH);
    frame();
    let y = photoH + 22;
    tracked(`ABOUT ${name.toUpperCase()}`, MARGIN, y, 11, 1.8, PAL.ink, F.serif, 'normal', 'left');
    doc.setFont(F.script, 'normal'); doc.setFontSize(22); tc(PAL.mute);
    doc.text('our story', MARGIN, y + 11); y += 22;

    // Drop cap with the first three lines indented to clear the glyph, then the
    // remainder re-wrapped to the full width.
    const indented = wrap(restBody, CONTENT_W - indent, 10, F.body);
    const firstThree = indented.slice(0, 3);
    const remainder = restBody.slice(firstThree.join(' ').length).trimStart();
    const restLines = remainder ? wrap(remainder, CONTENT_W, 10, F.body) : [];

    scriptInitial(initial, MARGIN, y + 9, dcSize, PAL.ink);
    doc.setFont(F.body, 'normal'); doc.setFontSize(10); tc(PAL.soft);
    let by = y + 3;
    firstThree.forEach((ln) => { doc.text(ln, MARGIN + indent, by); by += lineH; });
    restLines.forEach((ln) => { doc.text(ln, MARGIN, by); by += lineH; });
    footer();
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. WHY BOOK WITH US
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    doc.setFont(F.serif, 'normal'); doc.setFontSize(40); tc(PAL.ink);
    doc.text('WHY BOOK', MARGIN + 6, H - MARGIN - 70, { angle: 90 });
    doc.text('WITH US',  MARGIN + 22, H - MARGIN - 70, { angle: 90 });

    imgCover(nextPhoto(), 86, MARGIN, W - 86 - FRAME, 96);

    let y = 150;
    whyPoints.slice(0, 2).forEach((pt, i) => {
      tracked(`0${i + 1}`, 86, y, 11, 1.5, PAL.faint, F.bodySemi, 'normal', 'left');
      const lines = wrap(pt, W - 86 - MARGIN, 11, F.serif);
      doc.setFont(F.serif, 'normal'); doc.setFontSize(11); tc(PAL.soft);
      doc.text(lines, 86, y + 8);
      y += 8 + lines.length * 6 + 12;
    });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 6. YOUR JOURNEY
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    let y = MARGIN + 16;
    tracked('YOUR JOURNEY', MARGIN, y, 22, 1.6, PAL.ink, F.serif, 'normal', 'left'); y += 6;
    shortRule(MARGIN, y, 16); y += 14;

    const colW = W - 86 - MARGIN;
    imgCover(nextPhoto(), 86, y, colW, H - y - 24);

    journey.slice(0, 4).forEach(([title, bodyTxt], i) => {
      tracked(`0${i + 1}`, MARGIN, y + 1, 13, 1.5, PAL.faint, F.bodySemi, 'normal', 'left');
      doc.setFont(F.serif, 'normal'); doc.setFontSize(14); tc(PAL.ink);
      doc.text(title, MARGIN, y + 9);
      const lines = wrap(bodyTxt, 58, 9, F.body);
      doc.setFont(F.body, 'normal'); doc.setFontSize(9); tc(PAL.soft);
      doc.text(lines, MARGIN, y + 15);
      y += 15 + lines.length * 4.6 + 9;
    });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 7. STATEMENT SPREAD
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    imgCover(nextPhoto(), 0, 0, W, 168);
    overlay(0, 0, W, 168, 0.28);
    frame();
    let y = 168 + 26;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(13); tc(PAL.soft);
    doc.text('Transform your celebration into', CX, y, { align: 'center' }); y += 22;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(48); tc(PAL.ink);
    doc.text('TIMELESS', CX, y, { align: 'center' }); y += 19;
    doc.text('MEMORIES', CX, y, { align: 'center' });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 8. PACKAGES (if any)
  // ════════════════════════════════════════════════════════════════════
  if (hasPkgs) {
    page();
    doc.setFont(F.serif, 'normal'); doc.setFontSize(34); tc(PAL.ink);
    doc.text('PACKAGES', MARGIN + 6, H - MARGIN - 30, { angle: 90 });

    const px = 58, ciW = 50, ciH = 62;
    const tx = px + ciW + 8;          // text column start (clears the image)
    const nameW = W - MARGIN - tx;    // wrap long names instead of running off
    const gap = pkgs.length > 1 ? 18 : 0;
    const nameLH = 8, priceH = 8, itemLH = 5.4;

    // Measure each card so the stack can be vertically centered on the page.
    const cards = pkgs.map((pkg) => {
      const nameLines = wrap(pkg.name ?? 'Package', nameW, 22, F.script);
      const items = (pkg.included_items ?? []).slice(0, 6);
      const textH = nameLines.length * nameLH + (pkg.price_label ? priceH : 0) + items.length * itemLH;
      return { pkg, nameLines, items, textH, h: Math.max(ciH, textH + 4) };
    });
    const stackH = cards.reduce((s, c) => s + c.h, 0) + gap * (cards.length - 1);
    const top = MARGIN, avail = H - 2 * MARGIN;
    let cy0 = top + Math.max(0, (avail - stackH) / 2);

    cards.forEach(({ pkg, nameLines, items, textH, h }) => {
      imgCover(nextPhoto(), px, cy0 + Math.max(0, (h - ciH) / 2), ciW, ciH);
      let ty = cy0 + Math.max(0, (h - textH) / 2) + 7;
      doc.setFont(F.script, 'normal'); doc.setFontSize(22); tc(PAL.ink);
      nameLines.forEach((ln) => { doc.text(ln, tx, ty); ty += nameLH; });
      if (pkg.price_label) {
        doc.setFont(F.serif, 'normal'); doc.setFontSize(12); tc(PAL.soft);
        doc.text(pkg.price_label, tx, ty); ty += priceH;
      }
      items.forEach((it) => {
        tracked(it.toUpperCase(), tx, ty, 7.5, 0.6, PAL.mute, F.body, 'normal', 'left');
        ty += itemLH;
      });
      cy0 += h + gap;
    });
    footer();
  }

  // ════════════════════════════════════════════════════════════════════
  // 9. SPACES (one page per space)
  // ════════════════════════════════════════════════════════════════════
  for (const space of spaceList) {
    page();
    let y = MARGIN + 8;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(28); tc(PAL.ink);
    doc.text(space.name ?? 'The Space', MARGIN, y); y += 8;
    if (space.capacity) {
      tracked(space.capacity.toUpperCase(), MARGIN, y, 8.5, 1.6, PAL.mute, F.bodySemi, 'normal', 'left');
      y += 9;
    }
    const desc = (space.description && space.description.trim())
      || `A versatile space at ${name}, ready to be styled for your ceremony, dinner, and dancing. Ask us how it can be arranged for your celebration.`;
    const lineH = 5.4, gap = 12;
    const descLines = wrap(desc, CONTENT_W, 11, F.body);
    const descBlockH = descLines.length * lineH;
    const photoH = Math.max(150, H - 16 - y - descBlockH - gap);
    imgCover(getImg(space.image_url) ?? nextPhoto(), FRAME, y, W - 2 * FRAME, photoH);
    const dy = y + photoH + gap;
    const maxLines = Math.max(1, Math.floor((H - 16 - dy) / lineH));
    doc.setFont(F.body, 'normal'); doc.setFontSize(11); tc(PAL.soft);
    doc.text(descLines.slice(0, maxLines), MARGIN, dy);
    footer();
  }

  // ════════════════════════════════════════════════════════════════════
  // 10. GALLERY COLLAGE (if ≥3 photos) — no footer
  // ════════════════════════════════════════════════════════════════════
  if (hasGallery) {
    page();
    const GM = FRAME, G = FRAME;
    const uW = W - 2 * GM, uH = H - 2 * GM;
    const TW = (uW - 2 * G) / 3;
    const FW = 2 * TW + G;
    const HW = (uW - G) / 2;
    const RH = (uH - 3 * G) / 4;
    const cells: Array<[number, number, number, number]> = [
      [GM, GM, FW, RH],
      [GM + FW + G, GM, TW, RH],
      [GM, GM + RH + G, TW, RH],
      [GM + TW + G, GM + RH + G, FW, RH],
      [GM, GM + 2 * (RH + G), TW, RH],
      [GM + TW + G, GM + 2 * (RH + G), TW, RH],
      [GM + 2 * (TW + G), GM + 2 * (RH + G), TW, RH],
      [GM, GM + 3 * (RH + G), HW, RH],
      [GM + HW + G, GM + 3 * (RH + G), HW, RH],
    ];
    cells.forEach(([cx, cy, cw, ch], idx) => {
      const im = galleryAll[idx % galleryAll.length];
      if (im) imgCover(im, cx, cy, cw, ch);
    });
    frame();
  }

  // ════════════════════════════════════════════════════════════════════
  // 11. KIND WORDS (if reviews)
  // ════════════════════════════════════════════════════════════════════
  if (hasReviews) {
    page();
    const stripH = 70;
    const cw = (W - 2 * FRAME - 2 * FRAME) / 3;
    [0, 1, 2].forEach((i) => {
      imgCover(nextPhoto(), FRAME + i * (cw + FRAME), MARGIN, cw, stripH);
    });
    const review = guide.reviews[0];
    const quote = `\u201C${(review.body ?? 'An unforgettable place to celebrate.').trim()}\u201D`;
    const qLines = wrap(quote, CONTENT_W - 20, 16, F.serif);
    const labelH = 16, quoteH = qLines.length * 7.5 + 12;
    const authorH = review.author ? 8 : 0, locH = review.location ? 6 : 0;
    const blockH = labelH + quoteH + authorH + locH;
    const bandTop = MARGIN + stripH, bandBottom = H - 24;
    let y = bandTop + Math.max(14, (bandBottom - bandTop - blockH) / 2);
    tracked('KIND WORDS', CX, y, 9, 2.2, PAL.mute, F.bodySemi, 'normal', 'center'); y += labelH;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(16); tc(PAL.ink);
    doc.text(qLines, CX, y, { align: 'center' }); y += quoteH;
    if (review.author) {
      doc.setFont(F.script, 'normal'); doc.setFontSize(22); tc(PAL.soft);
      doc.text(review.author, CX, y, { align: 'center' }); y += authorH;
    }
    if (review.location) {
      tracked(review.location.toUpperCase(), CX, y, 8, 1.6, PAL.mute, F.body, 'normal', 'center');
    }
    footer();
  }

  // ════════════════════════════════════════════════════════════════════
  // 12. WHAT'S INCLUDED
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    const titleY = MARGIN + 16;
    tracked("WHAT'S INCLUDED", MARGIN, titleY, 22, 1.4, PAL.ink, F.serif, 'normal', 'left');
    doc.setFont(F.serif, 'normal'); doc.setFontSize(12); tc(PAL.soft);
    doc.text('Everything you need to host with ease.', MARGIN, titleY + 8);

    const items = includedItems.slice(0, 9);
    const cols = 3, fRowH = 42;
    const fRows = Math.ceil(items.length / cols);
    const fBandTop = 60, fBandBottom = H - 24;
    const gridTop = fBandTop + Math.max(0, (fBandBottom - fBandTop - fRows * fRowH) / 2) + 14;
    const colW = CONTENT_W / cols;
    items.forEach((item, i) => {
      const cxi = MARGIN + (i % cols) * colW;
      const cyi = gridTop + Math.floor(i / cols) * fRowH;
      dc(PAL.rule); doc.setLineWidth(0.5);
      doc.circle(cxi + 3, cyi, 3, 'S');
      const lines = wrap(item, colW - 12, 11, F.serif);
      doc.setFont(F.serif, 'normal'); doc.setFontSize(11); tc(PAL.ink);
      doc.text(lines, cxi + 10, cyi + 1);
      shortRule(cxi, cyi + 8 + (lines.length - 1) * 5, 12);
    });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 13. PLANNING CHECKLIST
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    let y = MARGIN + 16;
    tracked('CHECKLIST', MARGIN, y, 22, 1.6, PAL.ink, F.serif, 'normal', 'left'); y += 6;
    shortRule(MARGIN, y, 16); y += 12;

    const boxes: [string, string[]][] = [
      ['As you plan', ['Set your budget', 'Pick your date', 'Book your venue', 'Choose your vibe', 'Build your guest list', 'Find your vendors']],
      ['Closer to the day', ['Finalize headcount', 'Confirm the timeline', 'Plan the layout', 'Order rentals', 'Confirm vendors', 'Send final details']],
    ];
    const boxW = CONTENT_W;
    const boxH = 78;
    boxes.forEach(([title, items]) => {
      fc(PAL.box); doc.rect(MARGIN, y, boxW, boxH, 'F');
      let iy = y + 14;
      doc.setFont(F.script, 'normal'); doc.setFontSize(22); tc(PAL.ink);
      doc.text(title, MARGIN + 8, iy); iy += 10;
      const colW = (boxW - 16) / 2;
      items.forEach((it, i) => {
        const ix = MARGIN + 8 + (i % 2) * colW;
        const cyy = iy + Math.floor(i / 2) * 12;
        dc(PAL.mute); doc.setLineWidth(0.4);
        doc.rect(ix, cyy - 3, 3.4, 3.4, 'S');
        doc.setFont(F.body, 'normal'); doc.setFontSize(9.5); tc(PAL.soft);
        doc.text(it, ix + 6, cyy);
      });
      y += boxH + 10;
    });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 14. ACCOMMODATIONS (one page per entry)
  // ════════════════════════════════════════════════════════════════════
  for (const acc of accList) {
    page();
    let y = MARGIN + 8;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(28); tc(PAL.ink);
    doc.text(acc.name ?? 'Accommodations', MARGIN, y); y += 12;
    const desc = (acc.description && acc.description.trim())
      || `A comfortable retreat at ${name} for getting ready and staying close to the celebration. Ask us about availability for your date.`;
    const lineH = 5.4, gap = 12;
    const descLines = wrap(desc, CONTENT_W, 11, F.body);
    const descBlockH = descLines.length * lineH;
    const photoH = Math.max(150, H - 16 - y - descBlockH - gap);
    imgCover(getImg(acc.image_url) ?? nextPhoto(), FRAME, y, W - 2 * FRAME, photoH);
    const dy = y + photoH + gap;
    const maxLines = Math.max(1, Math.floor((H - 16 - dy) / lineH));
    doc.setFont(F.body, 'normal'); doc.setFontSize(11); tc(PAL.soft);
    doc.text(descLines.slice(0, maxLines), MARGIN, dy);
    footer();
  }

  // ════════════════════════════════════════════════════════════════════
  // 15. FAQ
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    const fReqX = scriptInitial('F', MARGIN, 44, 56, PAL.ink);
    tracked('REQUENTLY', fReqX, 38, 22, 1.2, PAL.ink, F.serif, 'normal', 'left');
    tracked('ASKED QUESTIONS', fReqX, 50, 22, 1.2, PAL.ink, F.serif, 'normal', 'left');
    let y = 60;
    dc(PAL.rule); doc.setLineWidth(0.4); doc.line(MARGIN, y, W - MARGIN, y); y += 12;

    faqs.slice(0, 4).forEach(([q, a], i) => {
      tracked(`0${i + 1}`, MARGIN, y, 12, 1.5, PAL.faint, F.bodySemi, 'normal', 'left');
      doc.setFont(F.serif, 'normal'); doc.setFontSize(13); tc(PAL.ink);
      const qLines = wrap(q, CONTENT_W - 14, 13, F.serif);
      doc.text(qLines, MARGIN + 14, y);
      let yy = y + qLines.length * 6 + 2;
      doc.setFont(F.body, 'normal'); doc.setFontSize(10); tc(PAL.soft);
      const aLines = wrap(a, CONTENT_W - 14, 10, F.body);
      doc.text(aLines, MARGIN + 14, yy);
      yy += aLines.length * 5;
      y = yy + 10;
    });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // 16. GET IN TOUCH
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    let y = MARGIN + 18;
    tracked('GET IN TOUCH', MARGIN, y, 22, 1.5, PAL.ink, F.serif, 'normal', 'left'); y += 12;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(20); tc(PAL.ink);
    doc.text(name, MARGIN, y); y += 9;
    doc.setFont(F.script, 'normal'); doc.setFontSize(24); tc(PAL.mute);
    doc.text('Wedding Venue', MARGIN, y); y += 12;

    doc.setFont(F.body, 'normal'); doc.setFontSize(10.5); tc(PAL.soft);
    const blurb = wrap(
      `We would love to host your celebration. Reach out and we will help you picture the day, check your date, and book a tour.`,
      CONTENT_W, 10.5, F.body,
    );
    doc.text(blurb, MARGIN, y); y += blurb.length * 5.2 + 8;

    imgCover(nextPhoto(), MARGIN, y, CONTENT_W, 90); y += 90 + 14;

    [phoneStr, emailStr, websiteStr].filter(Boolean).forEach((line) => {
      tracked(line.toUpperCase(), MARGIN, y, 9, 1.4, PAL.ink, F.bodySemi, 'normal', 'left');
      y += 8;
    });
  }
  footer();
  // overwrite the default footer text with a custom connect line for this page
  {
    doc.setFont(F.script, 'normal'); doc.setFontSize(16); tc(PAL.mute);
    doc.text("Let's connect", CX, H - 12, { align: 'center' });
    if (cityState) {
      tracked(`BASED IN ${cityState.toUpperCase()}`, CX, H - 6, 6.5, 1.2, PAL.faint, F.body, 'normal', 'center');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 17. THANK YOU — no page-number footer
  // ════════════════════════════════════════════════════════════════════
  page();
  {
    imgCover(nextPhoto() ?? getImg(coverSrc), 0, 0, W, H);
    overlay(0, 0, W, H, 0.4);
    frame();
    doc.setFont(F.script, 'normal'); doc.setFontSize(72); tc(PAL.white);
    doc.text('Thank You', CX, H * 0.46, { align: 'center' });
    tracked(name.toUpperCase(), CX, H * 0.46 + 16, 11, 2.2, PAL.white, F.serif, 'normal', 'center');
    const contact = [phoneStr, emailStr, websiteStr].filter(Boolean).join('   ·   ');
    if (contact) {
      fitTracked(contact.toUpperCase(), CX, H - 24, 8, 1.3, CONTENT_W, PAL.white, F.body, 'center');
    }
  }

  // ── Return raw bytes ─────────────────────────────────────────────────
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
