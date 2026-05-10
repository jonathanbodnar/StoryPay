/**
 * Server-side pricing guide PDF generator.
 *
 * Identical output to pricing-guide-pdf.ts (the browser version) but
 * replaces the two DOM-only helpers:
 *
 *   fetchImageAsDataUrl  →  fetch + Buffer.from(arrayBuffer).toString('base64')
 *   loadImageDimensions  →  PNG header reader | JPEG SOF parser | 4:3 fallback
 *
 * Returns a Buffer containing the raw PDF bytes. The caller is responsible
 * for setting the correct Content-Type / Content-Disposition headers.
 *
 * Runs in any Node.js environment — no browser globals required.
 */

// ─── Shared types (mirrors pricing-guide-pdf.ts) ─────────────────────────

type GalleryItem  = { url: string; caption?: string };
type ReviewItem   = { author?: string; location?: string; body?: string; rating?: number };
type Space        = { id: string; name: string | null; description: string | null; capacity: string | null; image_url: string | null };
type Package      = { id: string; name: string | null; price_label: string | null; description: string | null; included_items: string[] };

export interface GuideData {
  cover_image_url:          string | null;
  cover_source_image_url:   string | null;
  congratulatory_message:   string | null;
  gallery:                  GalleryItem[];
  about_photos:             GalleryItem[];
  about_venue:              string | null;
  accommodations_text:      string | null;
  accommodations_image_url: string | null;
  pricing_intro:            string | null;
  reviews:                  ReviewItem[];
  availability_text:        string | null;
  availability_image_url:   string | null;
  cta_headline:             string | null;
  cta_body:                 string | null;
  cta_button_label:         string;
  spaces:                   Space[];
  packages:                 Package[];
}

export interface VenueInfo {
  name:           string | null;
  location_city:  string | null;
  location_state: string | null;
  logo_url:       string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────

const PAGE_W    = 210;
const PAGE_H    = 297;
const MARGIN    = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;
const DARK      = '#1b1b1b';

// ─── Server-safe image helpers ──────────────────────────────────────────

/**
 * Fetch a remote image and return a base64 data-URL string.
 * Returns null if the request fails or the URL is empty.
 */
async function fetchImageAsDataUrlServer(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = contentType.split(';')[0].trim();
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Fetch a remote image and return both the data-URL and the detected
 * pixel dimensions.  Falls back to a 4:3 aspect ratio when dimensions
 * cannot be read from the image header.
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
 * Returns { w: number; h: number } — falls back to 4:3 (1200×900) on failure.
 */
function readImageDimensions(buf: Buffer, mime: string): { w: number; h: number } {
  try {
    if (mime.includes('png') && buf.length >= 24) {
      // PNG: 8-byte signature + 4-byte length + "IHDR" + 4-byte width + 4-byte height
      const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (PNG_SIG.every((b, i) => buf[i] === b)) {
        return {
          w: buf.readUInt32BE(16),
          h: buf.readUInt32BE(20),
        };
      }
    }
    if ((mime.includes('jpeg') || mime.includes('jpg')) && buf.length >= 4) {
      // JPEG: find SOF0/SOF2 marker (0xFFC0 or 0xFFC2), read height/width from it
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          // SOF: 2-byte length, 1-byte precision, 2-byte height, 2-byte width
          const h = buf.readUInt16BE(i + 5);
          const w = buf.readUInt16BE(i + 7);
          if (w > 0 && h > 0) return { w, h };
        }
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
    }
  } catch { /* fall through */ }
  // Fallback: assume 4:3 landscape
  return { w: 1200, h: 900 };
}

// ─── jsPDF helpers ───────────────────────────────────────────────────────

type JsPDF = import('jspdf').jsPDF;

function wrapText(doc: JsPDF, text: string, maxWidth: number, fontSize: number): string[] {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(text, maxWidth) as string[];
}

// Solid white "magazine" frame applied to every page. Width is a touch under
// 1 mm — at A4/72 dpi this reads as roughly 2 px on screen, which is what the
// design ask was for.
const PAGE_BORDER = 0.8; // mm

function drawPageBorder(doc: JsPDF) {
  doc.setFillColor(255, 255, 255);
  // Top, bottom, left, right strips drawn over whatever is on the page.
  doc.rect(0, 0, PAGE_W, PAGE_BORDER, 'F');
  doc.rect(0, PAGE_H - PAGE_BORDER, PAGE_W, PAGE_BORDER, 'F');
  doc.rect(0, 0, PAGE_BORDER, PAGE_H, 'F');
  doc.rect(PAGE_W - PAGE_BORDER, 0, PAGE_BORDER, PAGE_H, 'F');
}

/**
 * Embed Playfair Display Regular into a jsPDF document (server-side).
 *
 * jsPDF can ONLY parse TTF (not WOFF/WOFF2), so we pull the static TTF
 * directly from the official Google Fonts repo via jsDelivr's GitHub mirror.
 * Falls back to the built-in "times" font on any failure (network, parse,
 * or text-rendering test).
 */
async function loadPlayfairDisplayServer(doc: JsPDF): Promise<string> {
  const TTF_URL =
    'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/playfairdisplay/static/PlayfairDisplay-Regular.ttf';
  try {
    const res = await fetch(TTF_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn('[pricing-guide-pdf] Playfair TTF fetch returned', res.status);
      return 'times';
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString('base64');
    (doc as unknown as { addFileToVFS: (n: string, d: string) => void }).addFileToVFS(
      'PlayfairDisplay-Regular.ttf',
      b64,
    );
    (doc as unknown as { addFont: (f: string, n: string, s: string) => void }).addFont(
      'PlayfairDisplay-Regular.ttf',
      'PlayfairDisplay',
      'normal',
    );
    // Smoke-test: jsPDF only fails on a bad font when text() is actually called,
    // so do a no-op render to verify the font is usable. Any throw here forces
    // us to fall back to the safe built-in "times".
    try {
      doc.setFont('PlayfairDisplay', 'normal');
      doc.setFontSize(12);
      doc.getTextWidth('test');
    } catch (testErr) {
      console.warn('[pricing-guide-pdf] Playfair font failed validation', testErr);
      return 'times';
    }
    return 'PlayfairDisplay';
  } catch (err) {
    console.warn('[pricing-guide-pdf] Playfair font load failed', err);
    return 'times';
  }
}

/** Embed Open Sans Regular for body text. Falls back to 'helvetica'. */
async function loadOpenSansServer(doc: JsPDF): Promise<string> {
  const TTF_URL =
    'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/opensans/static/OpenSans-Regular.ttf';
  try {
    const res = await fetch(TTF_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 'helvetica';
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString('base64');
    (doc as unknown as { addFileToVFS: (n: string, d: string) => void }).addFileToVFS(
      'OpenSans-Regular.ttf', b64,
    );
    (doc as unknown as { addFont: (f: string, n: string, s: string) => void }).addFont(
      'OpenSans-Regular.ttf', 'OpenSans', 'normal',
    );
    try {
      doc.setFont('OpenSans', 'normal');
      doc.setFontSize(12);
      doc.getTextWidth('test');
    } catch {
      return 'helvetica';
    }
    return 'OpenSans';
  } catch {
    return 'helvetica';
  }
}

/**
 * Draw an image cropped to fill a cell exactly (CSS object-fit: cover).
 * Uses a raw PDF clipping rectangle so nothing bleeds outside the cell.
 */
function drawClippedImage(
  doc: JsPDF,
  dataUrl: string,
  cellX: number, cellY: number, cellW: number, cellH: number,
  imgW: number, imgH: number,
) {
  // Cover-scale: enlarge until both dimensions fill the cell, then centre.
  const scale = Math.max(cellW / imgW, cellH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const dx    = cellX - (drawW - cellW) / 2;
  const dy    = cellY - (drawH - cellH) / 2;

  // Raw PDF clipping rect.  jsPDF works in mm but internal PDF uses pt
  // with a bottom-up y-axis, so we convert manually.
  const k   = (doc as unknown as { internal: { scaleFactor: number } }).internal.scaleFactor;
  const pgH = PAGE_H * k;
  const xp  = (cellX * k).toFixed(3);
  const yp  = (pgH - (cellY + cellH) * k).toFixed(3);
  const wp  = (cellW * k).toFixed(3);
  const hp  = (cellH * k).toFixed(3);

  const out = (doc as unknown as { internal: { out: (s: string) => void } }).internal.out;
  out(`q ${xp} ${yp} ${wp} ${hp} re W n`);

  const fmt = dataUrl.startsWith('data:image/png') ? 'PNG'
            : dataUrl.startsWith('data:image/webp') ? 'WEBP'
            : 'JPEG';
  try { doc.addImage(dataUrl, fmt, dx, dy, drawW, drawH); } catch { /* skip */ }

  out('Q');
}

// ─── Main server generator ───────────────────────────────────────────────

export async function generatePricingGuidePdfServer(
  guide: GuideData,
  venue: VenueInfo,
): Promise<Buffer> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const venueName     = venue.name ?? 'Our Venue';
  const centerX       = PAGE_W / 2;

  // ── Embed fonts in parallel (Playfair + Open Sans) ───────────────────
  const [playfairFamily, openSansFamily] = await Promise.all([
    loadPlayfairDisplayServer(doc),
    loadOpenSansServer(doc),
  ]);

  // ── Pre-fetch all images ──────────────────────────────────────────────
  const imageCache = new Map<string, { dataUrl: string; w: number; h: number } | null>();

  async function getImage(url: string | null) {
    if (!url) return null;
    if (imageCache.has(url)) return imageCache.get(url)!;
    const result = await fetchImageWithDims(url);
    imageCache.set(url, result);
    return result;
  }

  async function getImageDataUrl(url: string | null): Promise<string | null> {
    if (!url) return null;
    const r = await getImage(url);
    return r?.dataUrl ?? null;
  }

  const coverSrc = guide.cover_image_url ?? guide.cover_source_image_url ?? guide.gallery[0]?.url ?? null;
  const [coverResult, logoDataUrl] = await Promise.all([
    getImage(coverSrc),
    getImageDataUrl(venue.logo_url),
  ]);

  const galleryResults = await Promise.all(guide.gallery.slice(0, 9).map(g => getImage(g.url)));
  const galleryItems   = galleryResults.filter((r): r is NonNullable<typeof r> => r !== null);

  const spaceResults = new Map<string, { dataUrl: string; w: number; h: number }>();
  await Promise.all(guide.spaces.map(async (s) => {
    if (s.image_url) {
      const r = await getImage(s.image_url);
      if (r) spaceResults.set(s.id, r);
    }
  }));

  const [accommodationsResult, availabilityResult] = await Promise.all([
    getImage(guide.accommodations_image_url),
    getImage(guide.availability_image_url),
  ]);

  // Fetch about-page photos (separate from gallery, max 4)
  const aboutPhotoResults = await Promise.all(
    (guide.about_photos ?? []).slice(0, 4).map(g => getImage(g.url))
  );
  const aboutPhotoItems = aboutPhotoResults.filter((r): r is NonNullable<typeof r> => r !== null);

  // ── Page 1: Cover ─────────────────────────────────────────────────────
  // Full-bleed photo, uniform dark overlay, refined 2px-style border,
  // then centered: logo → title → rule → venue name.

  // Photo fills the whole page.
  if (coverResult) {
    const { dataUrl, w, h } = coverResult;
    const imgRatio  = w / h;
    const pageRatio = PAGE_W / PAGE_H;
    let sw = PAGE_W, sh = PAGE_H, sx = 0, sy = 0;
    if (imgRatio > pageRatio) {
      sh = PAGE_H; sw = PAGE_H * imgRatio; sx = (PAGE_W - sw) / 2;
    } else {
      sw = PAGE_W; sh = PAGE_W / imgRatio; sy = (PAGE_H - sh) / 2;
    }
    try { doc.addImage(dataUrl, 'JPEG', sx, sy, sw, sh); } catch { /* skip */ }
  } else {
    doc.setFillColor(245, 243, 240);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  }

  // Uniform semi-transparent overlay.
  doc.setFillColor(0, 0, 0);
  (doc as unknown as { setGState?: (g: unknown) => void }).setGState?.(
    new (doc as unknown as { GState: new (o: unknown) => unknown }).GState({ opacity: 0.28 }),
  );
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  (doc as unknown as { setGState?: (g: unknown) => void }).setGState?.(
    new (doc as unknown as { GState: new (o: unknown) => unknown }).GState({ opacity: 1 }),
  );

  // Refined thin border (same weight as inner pages) drawn on top.
  drawPageBorder(doc);

  // ── Cover text block: logo → heading (nothing else) ──────────────────
  doc.setFont(playfairFamily, 'normal');
  doc.setFontSize(26);
  const titleLines = wrapText(doc, 'Pricing & Availability Guide', PAGE_W - 50, 26);
  const titleLineH = 10;

  const LOGO_H = 13; // mm — ≈ half the visual height of the 26pt heading
  const LOGO_GAP = 16; // mm gap between logo bottom and title baseline

  const logoResult = logoDataUrl ? await getImage(venue.logo_url) : null;
  const hasLogo = !!(logoDataUrl && logoResult);

  // Vertical centre the entire block (logo + gap + title).
  const blockH = (hasLogo ? LOGO_H + LOGO_GAP : 0) + titleLines.length * titleLineH;
  let ty = PAGE_H / 2 - blockH / 2 + (hasLogo ? LOGO_H : titleLineH);

  // ── Logo ──────────────────────────────────────────────────────────────
  if (hasLogo && logoDataUrl && logoResult) {
    const logoW = (logoResult.w / logoResult.h) * LOGO_H;
    const formatMatch = logoDataUrl.match(/^data:image\/(png|jpeg|jpg|webp)/i);
    const formats = formatMatch ? [formatMatch[1].toUpperCase()] : ['PNG', 'JPEG'];
    let drawn = false;
    for (const fmt of formats) {
      try {
        doc.addImage(logoDataUrl, fmt, centerX - logoW / 2, ty - LOGO_H, logoW, LOGO_H);
        drawn = true;
        break;
      } catch (err) {
        console.warn('[pricing-guide-pdf] logo addImage failed', fmt, err);
      }
    }
    ty += drawn ? LOGO_GAP : -LOGO_H + LOGO_GAP; // collapse if logo failed
  }

  // ── Title ─────────────────────────────────────────────────────────────
  doc.setFont(playfairFamily, 'normal');
  doc.setFontSize(26);
  doc.setTextColor(255, 255, 255);
  doc.text(titleLines, centerX, ty, { align: 'center' });

  // ── Page 2: Welcome ───────────────────────────────────────────────────
  if (guide.congratulatory_message?.trim()) {
    doc.addPage(); drawPageBorder(doc);

    // Heading: "Congratulations on your engagement." — Playfair Display
    const HEADING_FONT_SIZE = 24;
    const HEADING_LINE_H    = 9;  // mm per line at 24pt
    const BODY_FONT_SIZE    = 11;
    const BODY_LINE_H       = 6;  // mm per line at 11pt
    const GAP               = 10; // mm between heading and body
    const TEXT_W            = CONTENT_W - 20; // comfortable reading width

    doc.setFont(playfairFamily, 'normal');
    doc.setFontSize(HEADING_FONT_SIZE);
    const headingLines = wrapText(doc, 'Congratulations on your engagement.', TEXT_W, HEADING_FONT_SIZE);

    doc.setFont(openSansFamily, 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    const bodyLines = wrapText(doc, guide.congratulatory_message, TEXT_W, BODY_FONT_SIZE);

    // Calculate total block height and centre it vertically.
    const blockH = headingLines.length * HEADING_LINE_H + GAP + bodyLines.length * BODY_LINE_H;
    let y = PAGE_H / 2 - blockH / 2 + HEADING_LINE_H;

    // Heading
    doc.setFont(playfairFamily, 'normal');
    doc.setFontSize(HEADING_FONT_SIZE);
    doc.setTextColor(27, 27, 27);
    doc.text(headingLines, centerX, y, { align: 'center' });
    y += (headingLines.length - 1) * HEADING_LINE_H + GAP;

    // Body text
    doc.setFont(openSansFamily, 'normal');
    doc.setFontSize(BODY_FONT_SIZE);
    doc.setTextColor(80, 80, 80);
    doc.text(bodyLines, centerX, y, { align: 'center', maxWidth: TEXT_W });

    drawPageBorder(doc);
  }

  // ── Page 3: Gallery (pinterest grid — no title, no footer) ───────────
  // Ideal photo count: 9. Layout: 4 rows, mixed wide/narrow columns.
  // Row 1: [2/3 wide | 1/3]   Row 2: [1/3 | 2/3 wide]
  // Row 3: [1/3 | 1/3 | 1/3] Row 4: [1/2 | 1/2]
  let galleryPageNum = -1;
  if (galleryItems.length > 0) {
    doc.addPage();
    galleryPageNum = doc.getNumberOfPages();

    const GM  = PAGE_BORDER;            // images bleed to the border edge
    const G   = PAGE_BORDER;           // gutter = border width so all gaps look identical (~2px)
    const uW  = PAGE_W - 2 * GM;       // usable width
    const uH  = PAGE_H - 2 * GM;       // usable height
    const TW  = (uW - 2 * G) / 3;     // 1/3-column width
    const FW  = 2 * TW + G;            // 2/3-column width (incl. one gutter)
    const HW  = (uW - G) / 2;         // half-column width
    const RH  = (uH - 3 * G) / 4;     // row height (equal for all 4 rows)

    // 9 predefined cells: [x, y, w, h]
    const cells: Array<[number, number, number, number]> = [
      // Row 1
      [GM,              GM,                  FW, RH],
      [GM + FW + G,     GM,                  TW, RH],
      // Row 2
      [GM,              GM + RH + G,         TW, RH],
      [GM + TW + G,     GM + RH + G,         FW, RH],
      // Row 3
      [GM,              GM + 2*(RH+G),       TW, RH],
      [GM + TW + G,     GM + 2*(RH+G),       TW, RH],
      [GM + 2*(TW+G),   GM + 2*(RH+G),       TW, RH],
      // Row 4
      [GM,              GM + 3*(RH+G),       HW, RH],
      [GM + HW + G,     GM + 3*(RH+G),       HW, RH],
    ];

    cells.forEach(([cx, cy, cw, ch], idx) => {
      const item = galleryItems[idx];
      if (!item) return;
      drawClippedImage(doc, item.dataUrl, cx, cy, cw, ch, item.w, item.h);
    });

    // Thin white border on top of photos
    drawPageBorder(doc);
  }

  // ── Page 4: About ─────────────────────────────────────────────────────
  // Layout budget (A4, mm):
  //   heading block  ≈ 38mm
  //   gap            ≈  8mm
  //   2×2 photo grid ≈ 136mm  (two 66mm-tall rows + 4mm gutter)
  //   footer area    ≈ 15mm
  //   ──────────────────────
  //   available for text ≈ 100mm  →  ~700 chars max for a perfect single page
  const ABOUT_PHOTO_GAP = 4;  // mm between photo cells
  const ABOUT_PHOTO_W   = (CONTENT_W - ABOUT_PHOTO_GAP) / 2;
  const ABOUT_PHOTO_H   = ABOUT_PHOTO_W * 0.75;  // 4:3

  if (guide.about_venue?.trim()) {
    doc.addPage(); drawPageBorder(doc);
    let y = MARGIN + 10;

    // "ABOUT" label — unchanged
    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('ABOUT', MARGIN, y); y += 10;

    // Venue name — Playfair Display (thin look)
    doc.setTextColor(DARK);
    doc.setFont(playfairFamily, 'normal');
    doc.setFontSize(26);
    doc.text(venueName, MARGIN, y); y += 8;

    // Thin rule
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + 16, y); y += 12;

    // Body text — Open Sans
    doc.setTextColor(55, 65, 81);
    doc.setFont(openSansFamily, 'normal');
    doc.setFontSize(11);
    const aboutLines = wrapText(doc, guide.about_venue, CONTENT_W, 11);
    doc.text(aboutLines, MARGIN, y);

    // Approximate how many mm the text block occupies (≈4.7mm per line at 11pt)
    const textBlockH = aboutLines.length * 4.7;
    const photoGridH = 2 * ABOUT_PHOTO_H + ABOUT_PHOTO_GAP;
    const gridStartY = y + textBlockH + 10; // 10mm breathing gap after text

    // Only render the 2×2 photo grid if it fits on this page
    const gridEndY = gridStartY + photoGridH;
    const pageBottom = PAGE_H - MARGIN - 10; // leave room for footer

    if (gridEndY <= pageBottom && aboutPhotoItems.length >= 1) {
      const photos = aboutPhotoItems.slice(0, 4);
      const positions: Array<[number, number]> = [
        [MARGIN,                        gridStartY],
        [MARGIN + ABOUT_PHOTO_W + ABOUT_PHOTO_GAP, gridStartY],
        [MARGIN,                        gridStartY + ABOUT_PHOTO_H + ABOUT_PHOTO_GAP],
        [MARGIN + ABOUT_PHOTO_W + ABOUT_PHOTO_GAP, gridStartY + ABOUT_PHOTO_H + ABOUT_PHOTO_GAP],
      ];
      photos.forEach((item, i) => {
        const [px, py] = positions[i];
        drawClippedImage(doc, item.dataUrl, px, py, ABOUT_PHOTO_W, ABOUT_PHOTO_H, item.w, item.h);
      });
    }
  }

  // ── Page 5: Spaces ────────────────────────────────────────────────────
  if (guide.spaces.length > 0) {
    doc.addPage(); drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Our Spaces', MARGIN, y + 6); y += 18;

    for (const space of guide.spaces) {
      if (y > PAGE_H - MARGIN - 40) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }

      const imgW = 35;
      const imgH = imgW * 3 / 4;
      const spaceImg = spaceResults.get(space.id);
      const textX = spaceImg ? MARGIN + imgW + 6 : MARGIN;
      const textW = spaceImg ? CONTENT_W - imgW - 6 : CONTENT_W;

      if (spaceImg) {
        try { doc.addImage(spaceImg.dataUrl, 'JPEG', MARGIN, y, imgW, imgH); } catch { /* skip */ }
      }

      doc.setTextColor(DARK);
      doc.setFont('times', 'bold');
      doc.setFontSize(13);
      doc.text(space.name ?? 'Untitled space', textX, y + 5);

      let ty = y + 10;
      if (space.capacity) {
        doc.setTextColor(107, 114, 128);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(space.capacity.toUpperCase(), textX, ty); ty += 6;
      }
      if (space.description) {
        doc.setTextColor(55, 65, 81);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const descLines = wrapText(doc, space.description, textW, 10);
        doc.text(descLines, textX, ty); ty += descLines.length * 4.5;
      }
      y = Math.max(y + imgH, ty) + 8;
    }
  }

  // ── Page 6: Accommodations ────────────────────────────────────────────
  if (guide.accommodations_text?.trim()) {
    doc.addPage(); drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Accommodations', MARGIN, y + 6); y += 16;

    if (accommodationsResult) {
      const imgW = CONTENT_W;
      const imgH = imgW * 9 / 16;
      try { doc.addImage(accommodationsResult.dataUrl, 'JPEG', MARGIN, y, imgW, imgH); } catch { /* skip */ }
      y += imgH + 8;
    }

    doc.setTextColor(55, 65, 81);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const accLines = wrapText(doc, guide.accommodations_text, CONTENT_W, 11);
    doc.text(accLines, MARGIN, y);
  }

  // ── Page 7: Pricing & Packages ────────────────────────────────────────
  if (guide.pricing_intro?.trim() || guide.packages.length > 0) {
    doc.addPage(); drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Pricing & Packages', MARGIN, y + 6); y += 16;

    if (guide.pricing_intro) {
      doc.setTextColor(107, 114, 128);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const introLines = wrapText(doc, guide.pricing_intro, CONTENT_W, 10);
      doc.text(introLines, MARGIN, y); y += introLines.length * 4.5 + 8;
    }

    for (const pkg of guide.packages) {
      if (y > PAGE_H - MARGIN - 50) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }
      y += 8;

      doc.setTextColor(DARK);
      doc.setFont('times', 'bold');
      doc.setFontSize(14);
      doc.text(pkg.name ?? 'Untitled package', MARGIN + 6, y);

      if (pkg.price_label) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        const priceW = doc.getTextWidth(pkg.price_label);
        doc.text(pkg.price_label, PAGE_W - MARGIN - 6 - priceW, y);
      }
      y += 8;

      if (pkg.description) {
        doc.setTextColor(107, 114, 128);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const descLines = wrapText(doc, pkg.description, CONTENT_W - 12, 10);
        doc.text(descLines, MARGIN + 6, y); y += descLines.length * 4.5 + 3;
      }

      for (const item of pkg.included_items) {
        if (y > PAGE_H - MARGIN - 10) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }
        doc.setFillColor(27, 27, 27);
        doc.circle(MARGIN + 9, y - 1.2, 0.8, 'F');
        doc.setTextColor(55, 65, 81);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(item, MARGIN + 14, y); y += 5;
      }

      y += 4;
      doc.setDrawColor(229, 229, 229);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 6;
    }
  }

  // ── Page 8: Reviews ───────────────────────────────────────────────────
  if (guide.reviews.length > 0) {
    doc.addPage(); drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('From Our Couples', MARGIN, y + 6); y += 18;

    for (const review of guide.reviews) {
      if (y > PAGE_H - MARGIN - 40) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }

      if ((review.rating ?? 0) > 0) {
        doc.setFontSize(10);
        doc.setTextColor(217, 169, 26);
        doc.text('\u2605'.repeat(review.rating ?? 5), MARGIN, y); y += 7;
      }

      if (review.body) {
        doc.setTextColor(31, 41, 55);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(11);
        const bodyLines = wrapText(doc, `\u201C${review.body}\u201D`, CONTENT_W, 11);
        doc.text(bodyLines, MARGIN, y); y += bodyLines.length * 5 + 3;
      }

      const authorLine = [review.author, review.author && review.location ? ' · ' : '', review.location].filter(Boolean).join('');
      if (authorLine) {
        doc.setTextColor(107, 114, 128);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(authorLine.toUpperCase(), MARGIN, y); y += 6;
      }

      doc.setDrawColor(229, 229, 229);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 8;
    }
  }

  // ── Page 9: Availability ──────────────────────────────────────────────
  if (guide.availability_text?.trim()) {
    doc.addPage(); drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('\u25FB  AVAILABILITY', MARGIN, y + 4); y += 14;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Find your date', MARGIN, y + 6); y += 16;

    if (availabilityResult) {
      const imgW = CONTENT_W;
      const imgH = imgW * 9 / 16;
      try { doc.addImage(availabilityResult.dataUrl, 'JPEG', MARGIN, y, imgW, imgH); } catch { /* skip */ }
      y += imgH + 8;
    }

    doc.setTextColor(55, 65, 81);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const availLines = wrapText(doc, guide.availability_text, CONTENT_W, 11);
    doc.text(availLines, MARGIN, y);
  }

  // ── Page 10: CTA ─────────────────────────────────────────────────────
  if (guide.cta_headline?.trim() || guide.cta_body?.trim()) {
    doc.addPage(); drawPageBorder(doc);
    let y = 80;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('SAVE THE DATE', centerX, y, { align: 'center' }); y += 16;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(24);
    const headline = guide.cta_headline ?? 'Ready to walk the property?';
    const headlineLines = wrapText(doc, headline, CONTENT_W - 40, 24);
    doc.text(headlineLines, centerX, y, { align: 'center' }); y += headlineLines.length * 10 + 10;

    if (guide.cta_body) {
      doc.setTextColor(55, 65, 81);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      const bodyLines = wrapText(doc, guide.cta_body, CONTENT_W - 40, 11);
      doc.text(bodyLines, centerX, y, { align: 'center' }); y += bodyLines.length * 5 + 12;
    }

    const btnLabel = guide.cta_button_label || 'Schedule a tour';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const btnW = doc.getTextWidth(btnLabel) + 20;
    const btnX = centerX - btnW / 2;
    doc.setFillColor(27, 27, 27);
    doc.roundedRect(btnX, y, btnW, 10, 5, 5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(btnLabel, centerX, y + 6.5, { align: 'center' }); y += 20;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(venueName, centerX, y, { align: 'center' });
  }

  // ── Footer on every page except cover and gallery ────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    if (i === galleryPageNum) continue; // gallery page: images only, no footer
    doc.setPage(i);
    doc.setTextColor(180, 180, 180);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${venueName} · Pricing & Availability Guide`, centerX, PAGE_H - 8, { align: 'center' });
  }

  // ── Return raw bytes ──────────────────────────────────────────────────
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
