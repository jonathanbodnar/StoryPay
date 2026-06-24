/**
 * Server-side pricing guide PDF generator — editorial magazine layout.
 *
 * jsPDF v4.2.1, unit mm, A4. Runs in any Node.js environment (no browser
 * globals). The two server-safe image helpers (fetchImageWithDims +
 * readImageDimensions) and the runtime TTF font loaders are kept.
 *
 * Typography: Playfair Display (titles), Open Sans (body), Playfair Display
 * Italic (accents/eyebrows). No script font, no oversized drop-cap initials.
 * Every interior page title renders at one fixed size; only the cover is larger.
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
  owner_name?:    string | null;   // registrant name for the Welcome signature
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
  doc: JsPDF, url: string, file: string, family: string, style: string, fallback: string,
): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return fallback;
    const buf = Buffer.from(await res.arrayBuffer());
    (doc as unknown as { addFileToVFS: (n: string, d: string) => void })
      .addFileToVFS(file, buf.toString('base64'));
    (doc as unknown as { addFont: (f: string, n: string, s: string) => void })
      .addFont(file, family, style);
    try {
      doc.setFont(family, style);
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

/** Playfair Display Regular — the editorial serif used for all titles. */
async function loadPlayfairDisplayServer(doc: JsPDF): Promise<string> {
  return registerTtf(
    doc,
    `${FONT_BASE}/ofl/playfairdisplay/static/PlayfairDisplay-Regular.ttf`,
    'PlayfairDisplay-Regular.ttf',
    'PlayfairDisplay',
    'normal',
    'times',
  );
}

/**
 * Playfair Display Italic — registered as its own family so accent / eyebrow
 * lines render in true italic. Falls back to the regular serif family (which
 * simply renders upright) so setFont never throws.
 */
async function loadPlayfairItalicServer(doc: JsPDF, fallback: string): Promise<string> {
  return registerTtf(
    doc,
    `${FONT_BASE}/ofl/playfairdisplay/static/PlayfairDisplay-Italic.ttf`,
    'PlayfairDisplay-Italic.ttf',
    'PlayfairItalic',
    'normal',
    fallback,
  );
}

/** Open Sans Regular — body copy. Falls back to "helvetica". */
async function loadOpenSansServer(doc: JsPDF): Promise<string> {
  return registerTtf(
    doc,
    `${FONT_BASE}/apache/opensans/static/OpenSans-Regular.ttf`,
    'OpenSans-Regular.ttf',
    'OpenSans',
    'normal',
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
    'normal',
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

  // ── Resolve the font families up front ───────────────────────────────
  const [serifFam, bodyFam] = await Promise.all([
    loadPlayfairDisplayServer(doc),
    loadOpenSansServer(doc),
  ]);
  const [bodySemiFam, italicFam] = await Promise.all([
    loadOpenSansSemiServer(doc, bodyFam),
    loadPlayfairItalicServer(doc, serifFam),
  ]);
  const F = {
    serif:    serifFam,
    body:     bodyFam,
    bodySemi: bodySemiFam,
    italic:   italicFam,
  };

  // ── Geometry & palette ───────────────────────────────────────────────
  const W = 210, H = 297, MARGIN = 22, CONTENT_W = 166, CX = 105, FRAME = 0.8;
  const BOTTOM = H - MARGIN; // bottom content boundary
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

  // ── One fixed type scale. Interior titles never vary. ────────────────
  const T = {
    cover:    38,  // cover title (the only larger size)
    title:    26,  // every interior page title
    eyebrow:   9,  // tracked label above titles
    accent:   13,  // playfair italic subtitle / accent
    lead:   11.5,  // intro / lead paragraph
    body:   10.5,  // body copy
    small:     9,  // captions / fine print
  };
  const LH = 5.6; // body line height at T.body

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
  /** CSS object-fit:cover into a clip rect. Placeholder when im is null. */
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

  function shortRule(x: number, y: number, w = 16) {
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

  function wrap(text: string, w: number, size: number, font: string, style: 'normal' = 'normal'): string[] {
    doc.setFont(font, style);
    doc.setFontSize(size);
    return doc.splitTextToSize(text, w) as string[];
  }

  /** Trim text to a hard cap, cleanly at a sentence boundary (never mid-word). */
  function trimToSentence(text: string, cap: number): string {
    const t = text.trim();
    if (t.length <= cap) return t;
    const slice = t.slice(0, cap);
    const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    if (lastStop > cap * 0.45) return slice.slice(0, lastStop + 1).trim();
    const lastSpace = slice.lastIndexOf(' ');
    return `${slice.slice(0, lastSpace > 0 ? lastSpace : cap).trim()}…`;
  }

  /**
   * Wrap text, then avoid a "widow" — a last line of only one or two words —
   * by pulling words down from the previous line. Deterministic; never leaves a
   * single word stranded on its own line.
   */
  function wrapNoWidow(text: string, w: number, size: number, font: string): string[] {
    const lines = wrap(text, w, size, font);
    if (lines.length < 2) return lines;
    const last = lines[lines.length - 1].trim().split(/\s+/);
    if (last.length > 2) return lines;
    const prev = lines[lines.length - 2].trim().split(/\s+/);
    while (last.length < 3 && prev.length > 1) last.unshift(prev.pop() as string);
    const newPrev = prev.join(' ');
    const newLast = last.join(' ');
    doc.setFont(font, 'normal');
    doc.setFontSize(size);
    if (doc.getTextWidth(newLast) > w) return lines; // can't fit — leave as-is
    return [...lines.slice(0, -2), newPrev, newLast];
  }

  /** Build the longest prefix of whole sentences that fits within maxLines. */
  function fitSentences(text: string, w: number, size: number, font: string, maxLines: number): string {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    let acc = '';
    for (const s of sentences) {
      const trial = `${acc}${s}`.trim();
      if (wrap(trial, w, size, font).length > maxLines) break;
      acc = `${trial} `;
    }
    const fitted = acc.trim();
    if (fitted) return fitted;
    // Single very long sentence: fall back to a clean sentence-cap trim.
    return wrap(trimToSentence(text, maxLines * 70), w, size, font).join(' ');
  }

  /** Draw a row of n filled five-pointed stars centered on cx at baseline y. */
  function drawStars(cx: number, y: number, n: number, r: number, gap: number, color: readonly number[]) {
    const star = (sx: number, sy: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r : r * 0.42;
        pts.push([sx + rad * Math.cos(ang), sy + rad * Math.sin(ang)]);
      }
      const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]] as [number, number]);
      fc(color);
      doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'F', true);
    };
    const total = n * 2 * r + (n - 1) * gap;
    let x = cx - total / 2 + r;
    for (let i = 0; i < n; i++) { star(x, y); x += 2 * r + gap; }
  }

  // ── Contact line values ──────────────────────────────────────────────
  const phoneStr   = fmtPhone(venue.phone);
  const emailStr   = (venue.email ?? '').trim();
  const websiteStr = (venue.website ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '').trim();
  const cityState  = [venue.location_city, venue.location_state].filter(Boolean).join(', ');
  const ownerName  = (venue.owner_name ?? '').trim();

  // ── Page bookkeeping ─────────────────────────────────────────────────
  let PP = 1; // the cover sits on jsPDF's initial page
  const paper = () => { fc(PAL.paper); doc.rect(0, 0, W, H, 'F'); };
  const page  = () => { doc.addPage(); paper(); PP += 1; };
  const footer = () => {
    dc(PAL.rule);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, H - 14, W - MARGIN, H - 14);
    doc.setFont(F.body, 'normal');
    doc.setFontSize(8);
    tc(PAL.mute);
    doc.text(String(PP).padStart(2, '0'), W - MARGIN, H - 9.5, { align: 'right' });
    tracked(name.toUpperCase(), MARGIN, H - 9.8, 7, 1.1, PAL.mute, F.body, 'normal', 'left');
  };

  /**
   * Uniform interior page header. Eyebrow (italic accent) over a Playfair
   * title at the fixed interior size, with a short rule. Returns the y below.
   */
  function pageHeader(opts: {
    eyebrow?: string; title: string; align?: 'left' | 'center'; top?: number;
  }): number {
    const align = opts.align ?? 'left';
    const x = align === 'center' ? CX : MARGIN;
    let y = opts.top ?? MARGIN + 8;
    if (opts.eyebrow) {
      doc.setFont(F.italic, 'normal');
      doc.setFontSize(T.accent);
      tc(PAL.mute);
      doc.text(opts.eyebrow, x, y, { align: align === 'center' ? 'center' : 'left' });
      y += 9;
    }
    doc.setFont(F.serif, 'normal');
    doc.setFontSize(T.title);
    tc(PAL.ink);
    doc.text(opts.title, x, y, { align: align === 'center' ? 'center' : 'left' });
    y += 6;
    if (align === 'center') shortRule(CX - 9, y, 18);
    else shortRule(MARGIN, y, 18);
    return y + 9;
  }

  /** Even photo grid that fills (cols×rows) cells with no empty slots. */
  function photoGrid(imgs: Img[], x: number, y: number, w: number, h: number, cols: number, rows: number, gap = 2) {
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (h - gap * (rows - 1)) / rows;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const im = imgs.length ? imgs[i % imgs.length] : null;
        imgCover(im, x + c * (cw + gap), y + r * (ch + gap), cw, ch);
        i++;
      }
    }
  }

  /** Pick a balanced (cols, rows, count) for n images up to a max. */
  function gridShape(n: number, max: number): { cols: number; rows: number; count: number } {
    const k = Math.min(n, max);
    if (k >= 9) return { cols: 3, rows: 3, count: 9 };
    if (k >= 6) return { cols: 3, rows: 2, count: 6 };
    if (k >= 4) return { cols: 2, rows: 2, count: 4 };
    if (k >= 3) return { cols: 3, rows: 1, count: 3 };
    if (k >= 2) return { cols: 2, rows: 1, count: 2 };
    return { cols: 1, rows: 1, count: 1 };
  }

  // ── FAQ: owner-entered only ──────────────────────────────────────────
  // The FAQ page is NEVER auto-generated. It renders only when the owner has
  // manually added questions in the pricing-guide editor (and an answer is
  // present). Onboarding does not seed these.
  const faqs: [string, string][] = (guide.faqs ?? [])
    .map((f) => [String(f?.[0] ?? '').trim(), String(f?.[1] ?? '').trim()] as [string, string])
    .filter(([q, a]) => q.length > 0 && a.length > 0)
    .slice(0, 6);

  // "What's Included" prefers the package's editable items so the PDF mirrors
  // what the owner can change in the editor; then venue features; then evergreen.
  const includedItems: string[] = (() => {
    const pkgItems = (guide.packages[0]?.included_items ?? []).filter((s) => !!s && s.trim());
    if (pkgItems.length) return pkgItems.slice(0, 8);
    if (venue.features && venue.features.length) return venue.features.slice(0, 8);
    return [
      'Exclusive venue access', 'Tables and chairs', 'On-site parking',
      'Getting-ready space', 'Event coordination', 'Setup and cleanup',
      'Flexible vendor policy', 'Scenic photo spots',
    ];
  })();

  // ════════════════════════════════════════════════════════════════════
  // COVER (page 1)
  // ════════════════════════════════════════════════════════════════════
  imgCover(getImg(coverSrc), 0, 0, W, H);
  overlay(0, 0, W, H, 0.36);
  frame();
  tracked(name.toUpperCase(), CX, 46, 12, 2.6, PAL.white, F.body, 'normal', 'center');
  {
    const titleLines = wrap('Pricing & Planning Guide', CONTENT_W, T.cover, F.serif);
    doc.setFont(F.serif, 'normal'); doc.setFontSize(T.cover); tc(PAL.white);
    let ty = H * 0.5 - (titleLines.length - 1) * 9;
    titleLines.forEach((ln) => { doc.text(ln, CX, ty, { align: 'center' }); ty += T.cover * 0.42; });
  }
  {
    const contact = [phoneStr, emailStr, websiteStr].filter(Boolean).join('   ·   ');
    if (contact) fitTracked(contact.toUpperCase(), CX, H - 26, 8.5, 1.4, CONTENT_W, PAL.white, F.body, 'center');
  }

  // ════════════════════════════════════════════════════════════════════
  // Section registry → drives both the TOC numbering and the render order
  // ════════════════════════════════════════════════════════════════════
  const fiveStar = (guide.reviews ?? []).filter((r) => (r.rating ?? 0) >= 5 && (r.body ?? '').trim());
  const hasStories = fiveStar.length > 0;

  type Section = { label: string; render: () => void };
  const sections: Section[] = [];
  const addSection = (label: string, render: () => void) => sections.push({ label, render });

  // ── Welcome ──────────────────────────────────────────────────────────
  addSection('Welcome', () => {
    page();
    let y = pageHeader({ eyebrow: 'Our Venue, Your Story', title: 'Welcome', align: 'center' });
    const msg = guide.congratulatory_message?.trim()
      || `Welcome to ${name}. We are so glad you found us. This guide walks you through the spaces, the pricing, and the details that make your day feel effortless.`;
    const lines = wrap(msg, CONTENT_W - 24, T.lead, F.body);
    doc.setFont(F.body, 'normal'); doc.setFontSize(T.lead); tc(PAL.soft);
    doc.text(lines, CX, y + 2, { align: 'center' });
    y += 2 + lines.length * 6 + 12;

    // Signature block — never render an empty line.
    doc.setFont(F.italic, 'normal'); doc.setFontSize(15); tc(PAL.soft);
    doc.text('Warmly,', CX, y, { align: 'center' }); y += 9;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(15); tc(PAL.ink);
    if (ownerName) { doc.text(ownerName, CX, y, { align: 'center' }); y += 7; }
    tracked(name.toUpperCase(), CX, y, 8.5, 1.8, PAL.mute, F.bodySemi, 'normal', 'center');
    y += 12;

    const ph = BOTTOM - 4 - y;
    if (ph > 40) imgCover(nextPhoto(), MARGIN, y, CONTENT_W, ph);
    footer();
  });

  // ── Gallery (one page, even grid, no empty slots) ────────────────────
  addSection('Gallery', () => {
    page();
    const y = pageHeader({ eyebrow: 'A look around', title: 'Gallery', align: 'center' });
    const galleryImgs = (guide.gallery ?? []).map((g) => getImg(g.url)).filter((x): x is Img => !!x);
    const imgs = galleryImgs.length ? galleryImgs : pool;
    const { cols, rows, count } = gridShape(imgs.length, 9);
    const gx = MARGIN, gy = y + 2, gw = CONTENT_W, gh = BOTTOM - 6 - gy;
    photoGrid(imgs.slice(0, count), gx, gy, gw, gh, cols, rows, 2.5);
    footer();
  });

  // ── Our Story (intro + 2x2 about photos) ─────────────────────────────
  addSection('Our Story', () => {
    page();
    let y = pageHeader({ eyebrow: 'About the venue', title: 'Our Story' });
    const body = (guide.about_venue?.trim())
      || `${name} was made for gatherings that matter. The setting, the light, and the room all work together so your celebration feels effortless and entirely yours.`;
    const lines = wrap(body, CONTENT_W, T.body, F.body).slice(0, 7);
    doc.setFont(F.body, 'normal'); doc.setFontSize(T.body); tc(PAL.soft);
    doc.text(lines, MARGIN, y);
    y += lines.length * LH + 10;

    const aboutImgs = (guide.about_photos ?? []).map((g) => getImg(g.url)).filter((x): x is Img => !!x);
    const filled = [...aboutImgs];
    let gp = 0;
    while (filled.length < 4 && pool.length) { const im = pool[gp++ % pool.length]; if (im) filled.push(im); if (gp > 16) break; }
    const { cols, rows, count } = gridShape(filled.length || 1, 4);
    photoGrid(filled.slice(0, count), MARGIN, y, CONTENT_W, BOTTOM - 6 - y, cols, rows, 2.5);
    footer();
  });

  // ── The Spaces (single balanced page) ────────────────────────────────
  addSection('The Spaces', () => {
    page();
    const space = guide.spaces[0];
    let y = pageHeader({ eyebrow: 'Where it happens', title: space?.name?.trim() || 'The Spaces' });
    if (space?.capacity) {
      tracked(space.capacity.toUpperCase(), MARGIN, y - 3, 9, 1.8, PAL.mute, F.bodySemi, 'normal', 'left');
      y += 6;
    }
    const desc = (space?.description?.trim())
      || `A versatile space at ${name}, ready for your ceremony, dinner, and dancing. The room flexes from a seated ceremony to a full reception, with space for your guests, the dance floor, and the details that make the day yours. Ask us how it can be arranged for your celebration.`;
    const gap = 12;
    const minPhotoH = 92;
    // How many full lines fit if the photo sits at its minimum height.
    const maxLines = Math.max(2, Math.floor((BOTTOM - 4 - (y + minPhotoH + gap)) / LH));
    // Show whole sentences only — never a clipped, unfinished sentence.
    const shown = wrap(fitSentences(desc, CONTENT_W, T.body, F.body, maxLines), CONTENT_W, T.body, F.body);
    const descBlockH = shown.length * LH;
    const photoH = BOTTOM - 4 - y - descBlockH - gap; // photo fills the rest
    imgCover(getImg(space?.image_url ?? null) ?? nextPhoto(), FRAME, y, W - 2 * FRAME, photoH);
    doc.setFont(F.body, 'normal'); doc.setFontSize(T.body); tc(PAL.soft);
    doc.text(shown, MARGIN, y + photoH + gap);
    footer();
  });

  // ── Pricing (Packages + What's Included merged) ──────────────────────
  addSection('Pricing', () => {
    page();
    let y = pageHeader({ eyebrow: 'Plan with confidence', title: 'Pricing', align: 'center' });
    const pkg = guide.packages[0];
    doc.setFont(F.serif, 'normal'); doc.setFontSize(18); tc(PAL.ink);
    doc.text(pkg?.name?.trim() || 'Starting Package', CX, y, { align: 'center' }); y += 9;
    doc.setFont(F.italic, 'normal'); doc.setFontSize(14); tc(PAL.soft);
    doc.text(pkg?.price_label?.trim() || 'Contact us for pricing', CX, y, { align: 'center' }); y += 12;

    const narrative = guide.pricing_intro?.trim()
      || `Final pricing depends on your date, your season, and your guest count. A quick call or tour lets us tailor a package to your day and help you plan every detail. We keep it transparent, with no hidden fees.`;
    const nLines = wrap(narrative, CONTENT_W - 16, T.body, F.body);
    doc.setFont(F.body, 'normal'); doc.setFontSize(T.body); tc(PAL.soft);
    doc.text(nLines, CX, y, { align: 'center' });
    y += nLines.length * LH + 12;

    // What's Included list on the same page.
    tracked("WHAT'S INCLUDED", CX, y, 9, 2.2, PAL.mute, F.bodySemi, 'normal', 'center'); y += 10;
    const cols = 2;
    const colW = (CONTENT_W - 16) / cols;
    const rowH = 9.5;
    const rows = Math.ceil(includedItems.length / cols);
    const gridX = MARGIN + 8;
    includedItems.forEach((item, i) => {
      const cxi = gridX + (i % cols) * (colW + 16);
      const cyi = y + Math.floor(i / cols) * rowH;
      dc(PAL.rule); doc.setLineWidth(0.5); doc.circle(cxi + 1.6, cyi - 1.2, 1.4, 'S');
      doc.setFont(F.body, 'normal'); doc.setFontSize(T.body); tc(PAL.ink);
      doc.text(item, cxi + 7, cyi);
    });
    y += rows * rowH + 12;

    // Soft CTA → contact details.
    doc.setFont(F.italic, 'normal'); doc.setFontSize(13); tc(PAL.ink);
    doc.text('Ready to talk dates? Reach out and we will help you plan.', CX, y, { align: 'center' }); y += 8;
    const contact = [phoneStr, emailStr, websiteStr].filter(Boolean).join('   ·   ');
    if (contact) { fitTracked(contact.toUpperCase(), CX, y, 8.5, 1.4, CONTENT_W, PAL.mute, F.bodySemi, 'center'); y += 12; }
    const ph = BOTTOM - 6 - y;
    if (ph > 45) imgCover(nextPhoto(), MARGIN, y, CONTENT_W, ph);
    footer();
  });

  // ── Stories (5-star reviews only — title + reviews, no photos) ───────
  if (hasStories) {
    addSection('Stories', () => {
      page();
      const top = pageHeader({ eyebrow: 'In their words', title: 'Stories', align: 'center' });
      const GOLD = [183, 142, 72] as const;

      const stories = fiveStar.slice(0, 5);
      const count = stories.length;
      const perCap = count >= 5 ? 150 : count >= 4 ? 190 : count >= 3 ? 240 : 320;
      const qSize = count >= 4 ? 12 : 13;
      const qLH = qSize * 0.46;

      // Measure every block so the page distributes them evenly top to bottom.
      const blocks = stories.map((rv) => {
        const quote = `\u201C${trimToSentence(rv.body ?? '', perCap)}\u201D`;
        const qLines = wrapNoWidow(quote, CONTENT_W - 30, qSize, F.italic);
        const h = 6 /*stars*/ + 4 + qLines.length * qLH + 7 /*name*/ + (rv.location ? 5 : 0);
        return { rv, qLines, h };
      });
      const totalH = blocks.reduce((a, b) => a + b.h, 0);
      const avail = BOTTOM - 8 - top;
      const lead = Math.max(8, (avail - totalH) / (count + 1));

      let sy = top + lead;
      blocks.forEach(({ rv, qLines }) => {
        drawStars(CX, sy, 5, 1.9, 1.6, GOLD);
        sy += 10;
        doc.setFont(F.italic, 'normal'); doc.setFontSize(qSize); tc(PAL.ink);
        doc.text(qLines, CX, sy, { align: 'center' });
        sy += qLines.length * qLH + 5;
        if (rv.author) {
          doc.setFont(F.serif, 'normal'); doc.setFontSize(12.5); tc(PAL.soft);
          doc.text(rv.author, CX, sy, { align: 'center' }); sy += 6;
        }
        if (rv.location) {
          tracked(rv.location.toUpperCase(), CX, sy, 8, 1.6, PAL.mute, F.bodySemi, 'normal', 'center');
          sy += 5;
        }
        sy += lead;
      });
      footer();
    });
  }

  // ── FAQ — owner-entered only; never auto-generated ───────────────────
  if (faqs.length) {
    addSection('Questions', () => {
      page();
      const top = pageHeader({ eyebrow: 'Good to know', title: 'Frequently Asked Questions' });
      const items = faqs.slice(0, 6);
      const slotH = (BOTTOM - 8 - top) / items.length;
      items.forEach(([q, a], i) => {
        const y = top + i * slotH;
        tracked(`0${i + 1}`, MARGIN, y, 12, 1.5, PAL.faint, F.bodySemi, 'normal', 'left');
        const qLines = wrap(q, CONTENT_W - 14, 13, F.serif);
        doc.setFont(F.serif, 'normal'); doc.setFontSize(13); tc(PAL.ink);
        doc.text(qLines, MARGIN + 14, y);
        const yy = y + qLines.length * 6 + 2;
        const aLines = wrapNoWidow(a, CONTENT_W - 14, T.body, F.body);
        doc.setFont(F.body, 'normal'); doc.setFontSize(T.body); tc(PAL.soft);
        doc.text(aLines, MARGIN + 14, yy);
      });
      footer();
    });
  }

  // ── Save the Date (full-bleed hero with overlaid text) ───────────────
  addSection('Save the Date', () => {
    page();
    imgCover(nextPhoto() ?? getImg(coverSrc), 0, 0, W, H);
    overlay(0, 0, W, H, 0.42);
    frame();

    doc.setFont(F.italic, 'normal'); doc.setFontSize(15); tc(PAL.white);
    doc.text('We would love to host you', CX, H * 0.42, { align: 'center' });
    doc.setFont(F.serif, 'normal'); doc.setFontSize(34); tc(PAL.white);
    doc.text('Save the Date', CX, H * 0.42 + 16, { align: 'center' });

    doc.setFont(F.body, 'normal'); doc.setFontSize(T.lead); tc(PAL.white);
    const invite = wrap(`Reach out to check your date and book a tour of ${name}.`, CONTENT_W - 30, T.lead, F.body);
    doc.text(invite, CX, H * 0.42 + 30, { align: 'center' });

    let cy = H - 52;
    [phoneStr, emailStr, websiteStr].filter(Boolean).forEach((line) => {
      tracked(line.toUpperCase(), CX, cy, 9, 1.6, PAL.white, F.bodySemi, 'normal', 'center');
      cy += 9;
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // TABLE OF CONTENTS (page 2) — numbered from the real section list
  // ════════════════════════════════════════════════════════════════════
  page();
  imgCover(getImg(coverSrc) ?? nextPhoto(), 0, 0, 84, H);
  frame();
  {
    const rx = 84 + 14;
    let y = MARGIN + 22;
    doc.setFont(F.italic, 'normal'); doc.setFontSize(T.accent); tc(PAL.mute);
    doc.text('Inside this guide', rx, y); y += 11;
    doc.setFont(F.serif, 'normal'); doc.setFontSize(T.title); tc(PAL.ink);
    doc.text('Contents', rx, y); y += 7;
    dc(PAL.rule); doc.setLineWidth(0.4); doc.line(rx, y, W - MARGIN, y); y += 11;
    sections.forEach((s, i) => {
      const pg = 3 + i; // cover=1, TOC=2, sections start at 3
      doc.setFont(F.serif, 'normal'); doc.setFontSize(12.5); tc(PAL.soft);
      doc.text(s.label, rx, y);
      doc.setFont(F.bodySemi, 'normal'); doc.setFontSize(9); tc(PAL.mute);
      doc.text(String(pg).padStart(2, '0'), W - MARGIN, y, { align: 'right' });
      y += 10.5;
    });
  }
  footer();

  // ════════════════════════════════════════════════════════════════════
  // Render every section in order (pages 3+)
  // ════════════════════════════════════════════════════════════════════
  sections.forEach((s) => s.render());

  // ── Return raw bytes ─────────────────────────────────────────────────
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
