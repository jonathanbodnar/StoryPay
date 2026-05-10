/**
 * Generate a magazine-style A4 portrait PDF of the Pricing & Availability
 * Guide — the exact same PDF that brides will download from the public listing.
 *
 * Uses jsPDF with embedded images. Standard serif/sans fonts approximate
 * Playfair Display and Open Sans.
 */

import type { jsPDF } from 'jspdf';

// ─── Shared types (mirrored from the preview modal) ─────────────────────

type GalleryItem = { url: string; caption?: string };
type ReviewItem = { author?: string; location?: string; body?: string; rating?: number };
type Space = { id: string; name: string | null; description: string | null; capacity: string | null; image_url: string | null };
type Package = { id: string; name: string | null; price_label: string | null; description: string | null; included_items: string[] };

export interface GuideData {
  cover_image_url: string | null;
  cover_source_image_url: string | null;
  congratulatory_message: string | null;
  gallery: GalleryItem[];
  about_venue: string | null;
  accommodations_text: string | null;
  accommodations_image_url: string | null;
  pricing_intro: string | null;
  reviews: ReviewItem[];
  availability_text: string | null;
  availability_image_url: string | null;
  cta_headline: string | null;
  cta_body: string | null;
  cta_button_label: string;
  spaces: Space[];
  packages: Package[];
}

export interface VenueInfo {
  name: string | null;
  location_city: string | null;
  location_state: string | null;
  logo_url: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────

const PAGE_W = 210; // A4 width mm
const PAGE_H = 297; // A4 height mm
const MARGIN = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;
const DARK = '#1b1b1b';
const GREY = '#6b7280';
const LIGHT_GREY = '#f5f5f4';
const BORDER = '#e5e5e5';

// ─── Image loader ───────────────────────────────────────────────────────

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function loadImageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

// ─── Text helpers ───────────────────────────────────────────────────────

function wrapText(doc: jsPDF, text: string, maxWidth: number, fontSize: number): string[] {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(text, maxWidth) as string[];
}

// ─── Font loader ────────────────────────────────────────────────────────

/**
 * Attempt to embed Playfair Display Regular (400) into a jsPDF document.
 * Falls back silently to the built-in "times" font if the fetch fails.
 * Returns the font family name to use in setFont() calls.
 */
async function loadPlayfairDisplay(doc: import('jspdf').jsPDF): Promise<string> {
  try {
    // jsDelivr mirrors @fontsource packages which ship plain TTF files.
    const res = await fetch(
      'https://cdn.jsdelivr.net/npm/@fontsource/playfair-display@5.1.1/files/playfair-display-latin-400-normal.woff2',
      { cache: 'force-cache' },
    );
    if (!res.ok) return 'times';
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    // Convert in chunks to avoid stack-overflow on large fonts.
    for (let i = 0; i < bytes.byteLength; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const b64 = btoa(binary);
    (doc as any).addFileToVFS('PlayfairDisplay-Regular.woff2', b64);
    (doc as any).addFont('PlayfairDisplay-Regular.woff2', 'PlayfairDisplay', 'normal');
    return 'PlayfairDisplay';
  } catch {
    return 'times';
  }
}

// ─── Main generator ─────────────────────────────────────────────────────

export async function generatePricingGuidePdf(
  guide: GuideData,
  venue: VenueInfo,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const venueName = venue.name ?? 'Our Venue';
  const venueLocation = [venue.location_city, venue.location_state].filter(Boolean).join(', ');

  // Attempt to embed Playfair Display for the cover page title.
  onProgress?.('Loading fonts…');
  const playfairFamily = await loadPlayfairDisplay(doc);

  // Pre-fetch all images we'll need
  onProgress?.('Loading images…');
  const imageCache = new Map<string, string | null>();

  async function getCachedImage(url: string): Promise<string | null> {
    if (imageCache.has(url)) return imageCache.get(url)!;
    const dataUrl = await fetchImageAsDataUrl(url);
    imageCache.set(url, dataUrl);
    return dataUrl;
  }

  const coverSrc = guide.cover_image_url ?? guide.cover_source_image_url ?? guide.gallery[0]?.url ?? null;
  const logoSrc = venue.logo_url ? await getCachedImage(venue.logo_url) : null;
  const coverImg = coverSrc ? await getCachedImage(coverSrc) : null;

  // Pre-fetch gallery, space, accommodation, availability images
  const galleryImgs: string[] = [];
  for (const g of guide.gallery.slice(0, 6)) {
    const img = await getCachedImage(g.url);
    if (img) galleryImgs.push(img);
  }
  const spaceImgs = new Map<string, string>();
  for (const s of guide.spaces) {
    if (s.image_url) {
      const img = await getCachedImage(s.image_url);
      if (img) spaceImgs.set(s.id, img);
    }
  }
  const accommodationsImg = guide.accommodations_image_url ? await getCachedImage(guide.accommodations_image_url) : null;
  const availabilityImg = guide.availability_image_url ? await getCachedImage(guide.availability_image_url) : null;

  // ─── Page 1: Cover ──────────────────────────────────────────────────
  // Layout mirrors the public listing frontend: full-bleed photo,
  // uniform semi-transparent overlay, title centered exactly in the
  // middle, venue name as the subheadline beneath a thin rule.
  onProgress?.('Rendering cover…');

  if (coverImg) {
    const dims = await loadImageDimensions(coverImg);
    const imgRatio = dims.w / dims.h;
    const pageRatio = PAGE_W / PAGE_H;
    let sw = PAGE_W, sh = PAGE_H, sx = 0, sy = 0;
    if (imgRatio > pageRatio) {
      sh = PAGE_H;
      sw = PAGE_H * imgRatio;
      sx = (PAGE_W - sw) / 2;
    } else {
      sw = PAGE_W;
      sh = PAGE_W / imgRatio;
      sy = (PAGE_H - sh) / 2;
    }
    doc.addImage(coverImg, 'JPEG', sx, sy, sw, sh);
  } else {
    // Warm off-white placeholder when no cover image exists.
    doc.setFillColor(245, 243, 240);
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  }

  // Uniform semi-transparent overlay (matches frontend bg-black/25).
  doc.setFillColor(0, 0, 0);
  (doc as any).setGState?.(new (doc as any).GState({ opacity: 0.28 }));
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  (doc as any).setGState?.(new (doc as any).GState({ opacity: 1 }));

  const centerX = PAGE_W / 2;

  // ── Measure text block so we can center it perfectly ──────────────
  // Title: "Pricing & Availability Guide"
  doc.setFont(playfairFamily, 'normal');
  doc.setFontSize(26);
  const titleLines = wrapText(doc, 'Pricing & Availability Guide', PAGE_W - 50, 26);
  const titleLineH = 10; // mm per line at 26 pt

  // Subheadline: venue name (letter-spaced caps)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const subLines = wrapText(doc, venueName.toUpperCase(), PAGE_W - 60, 8);
  const subLineH = 5;

  // Layout: title block + 14 mm gap (divider + spacing) + sub block
  const blockH = titleLines.length * titleLineH + 14 + subLines.length * subLineH;
  let ty = PAGE_H / 2 - blockH / 2 + titleLineH; // start at vertical centre

  // ── Title ─────────────────────────────────────────────────────────
  doc.setFont(playfairFamily, 'normal');
  doc.setFontSize(26);
  doc.setTextColor(255, 255, 255);
  doc.text(titleLines, centerX, ty, { align: 'center' });
  ty += (titleLines.length - 1) * titleLineH + 10;

  // ── Thin rule ─────────────────────────────────────────────────────
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.25);
  doc.line(centerX - 10, ty, centerX + 10, ty);
  ty += 8;

  // ── Venue name subheadline ─────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(240, 240, 240);
  doc.text(subLines, centerX, ty, { align: 'center' });

  // ─── Page 2: Welcome ───────────────────────────────────────────────
  if (guide.congratulatory_message?.trim()) {
    onProgress?.('Rendering welcome…');
    doc.addPage();
    drawPageBorder(doc);
    let y = 50;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('A NOTE FROM', centerX, y, { align: 'center' });
    y += 12;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(26);
    doc.text(venueName, centerX, y, { align: 'center' });
    y += 8;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(centerX - 8, y, centerX + 8, y);
    y += 14;

    doc.setTextColor(55, 65, 81);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const msgLines = wrapText(doc, guide.congratulatory_message, CONTENT_W - 20, 11);
    doc.text(msgLines, centerX, y, { align: 'center', maxWidth: CONTENT_W - 20 });
  }

  // ─── Page 3: Photo Gallery ─────────────────────────────────────────
  if (galleryImgs.length > 0) {
    onProgress?.('Rendering gallery…');
    doc.addPage();
    drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('The Property', MARGIN, y + 6);
    y += 20;

    // Layout: first image full width, rest in a 2-col grid
    const gap = 4;
    if (galleryImgs.length >= 1) {
      const imgW = CONTENT_W;
      const imgH = imgW * 9 / 16;
      try {
        const dims = await loadImageDimensions(galleryImgs[0]);
        doc.addImage(galleryImgs[0], 'JPEG', MARGIN, y, imgW, imgH);
      } catch { /* skip */ }
      y += imgH + gap;
    }

    // Remaining images in a 2-col grid
    const colW = (CONTENT_W - gap) / 2;
    const colH = colW * 3 / 4;
    let col = 0;
    for (let i = 1; i < galleryImgs.length && y + colH < PAGE_H - MARGIN; i++) {
      try {
        doc.addImage(galleryImgs[i], 'JPEG', MARGIN + col * (colW + gap), y, colW, colH);
      } catch { /* skip */ }
      col++;
      if (col >= 2) {
        col = 0;
        y += colH + gap;
      }
    }
  }

  // ─── Page 4: About the Venue ───────────────────────────────────────
  if (guide.about_venue?.trim()) {
    onProgress?.('Rendering about…');
    doc.addPage();
    drawPageBorder(doc);
    let y = MARGIN + 10;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('ABOUT', MARGIN, y);
    y += 10;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(26);
    doc.text(venueName, MARGIN, y);
    y += 8;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, MARGIN + 16, y);
    y += 12;

    doc.setTextColor(55, 65, 81);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const aboutLines = wrapText(doc, guide.about_venue, CONTENT_W, 11);
    doc.text(aboutLines, MARGIN, y);
  }

  // ─── Page 5: Our Spaces ────────────────────────────────────────────
  if (guide.spaces.length > 0) {
    onProgress?.('Rendering spaces…');
    doc.addPage();
    drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Our Spaces', MARGIN, y + 6);
    y += 18;

    for (const space of guide.spaces) {
      if (y > PAGE_H - MARGIN - 40) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }

      const imgW = 35;
      const imgH = imgW * 3 / 4;
      const textX = space.image_url ? MARGIN + imgW + 6 : MARGIN;
      const textW = space.image_url ? CONTENT_W - imgW - 6 : CONTENT_W;

      if (space.image_url && spaceImgs.has(space.id)) {
        try {
          doc.addImage(spaceImgs.get(space.id)!, 'JPEG', MARGIN, y, imgW, imgH);
        } catch { /* skip */ }
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
        doc.text(space.capacity.toUpperCase(), textX, ty);
        ty += 6;
      }
      if (space.description) {
        doc.setTextColor(55, 65, 81);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const descLines = wrapText(doc, space.description, textW, 10);
        doc.text(descLines, textX, ty);
        ty += descLines.length * 4.5;
      }
      y = Math.max(y + imgH, ty) + 8;
    }
  }

  // ─── Page 6: Accommodations ────────────────────────────────────────
  if (guide.accommodations_text?.trim()) {
    onProgress?.('Rendering accommodations…');
    doc.addPage();
    drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Accommodations', MARGIN, y + 6);
    y += 16;

    if (accommodationsImg) {
      const imgW = CONTENT_W;
      const imgH = imgW * 9 / 16;
      try {
        doc.addImage(accommodationsImg, 'JPEG', MARGIN, y, imgW, imgH);
      } catch { /* skip */ }
      y += imgH + 8;
    }

    doc.setTextColor(55, 65, 81);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const accLines = wrapText(doc, guide.accommodations_text, CONTENT_W, 11);
    doc.text(accLines, MARGIN, y);
  }

  // ─── Page 7: Pricing & Packages ────────────────────────────────────
  if (guide.pricing_intro?.trim() || guide.packages.length > 0) {
    onProgress?.('Rendering pricing…');
    doc.addPage();
    drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Pricing & Packages', MARGIN, y + 6);
    y += 16;

    if (guide.pricing_intro) {
      doc.setTextColor(107, 114, 128);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const introLines = wrapText(doc, guide.pricing_intro, CONTENT_W, 10);
      doc.text(introLines, MARGIN, y);
      y += introLines.length * 4.5 + 8;
    }

    for (const pkg of guide.packages) {
      if (y > PAGE_H - MARGIN - 50) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }

      // Package card background
      doc.setFillColor(245, 245, 244);
      doc.setDrawColor(229, 229, 229);
      const cardStartY = y;
      y += 8;

      // Package name + price
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
        doc.text(descLines, MARGIN + 6, y);
        y += descLines.length * 4.5 + 3;
      }

      // Included items
      for (const item of pkg.included_items) {
        if (y > PAGE_H - MARGIN - 10) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }
        doc.setFillColor(27, 27, 27);
        doc.circle(MARGIN + 9, y - 1.2, 0.8, 'F');
        doc.setTextColor(55, 65, 81);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(item, MARGIN + 14, y);
        y += 5;
      }

      // Draw card background (needs to be behind, so we draw it now and redraw content)
      // Actually, draw card bg first by going back — simpler: just draw a bottom border line
      y += 4;
      doc.setDrawColor(229, 229, 229);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      y += 6;
    }
  }

  // ─── Page 8: Reviews ───────────────────────────────────────────────
  if (guide.reviews.length > 0) {
    onProgress?.('Rendering reviews…');
    doc.addPage();
    drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('From Our Couples', MARGIN, y + 6);
    y += 18;

    for (const review of guide.reviews) {
      if (y > PAGE_H - MARGIN - 40) { doc.addPage(); drawPageBorder(doc); y = MARGIN; }

      // Stars
      if ((review.rating ?? 0) > 0) {
        doc.setFontSize(10);
        doc.setTextColor(217, 169, 26);
        doc.text('\u2605'.repeat(review.rating ?? 5), MARGIN, y);
        y += 7;
      }

      if (review.body) {
        doc.setTextColor(31, 41, 55);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(11);
        const bodyLines = wrapText(doc, `\u201C${review.body}\u201D`, CONTENT_W, 11);
        doc.text(bodyLines, MARGIN, y);
        y += bodyLines.length * 5 + 3;
      }

      const authorLine = [review.author, review.author && review.location ? ' · ' : '', review.location].filter(Boolean).join('');
      if (authorLine) {
        doc.setTextColor(107, 114, 128);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(authorLine.toUpperCase(), MARGIN, y);
        y += 6;
      }

      doc.setDrawColor(229, 229, 229);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      y += 8;
    }
  }

  // ─── Page 9: Availability ──────────────────────────────────────────
  if (guide.availability_text?.trim()) {
    onProgress?.('Rendering availability…');
    doc.addPage();
    drawPageBorder(doc);
    let y = MARGIN;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('\u25FB  AVAILABILITY', MARGIN, y + 4);
    y += 14;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.text('Find your date', MARGIN, y + 6);
    y += 16;

    if (availabilityImg) {
      const imgW = CONTENT_W;
      const imgH = imgW * 9 / 16;
      try {
        doc.addImage(availabilityImg, 'JPEG', MARGIN, y, imgW, imgH);
      } catch { /* skip */ }
      y += imgH + 8;
    }

    doc.setTextColor(55, 65, 81);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const availLines = wrapText(doc, guide.availability_text, CONTENT_W, 11);
    doc.text(availLines, MARGIN, y);
  }

  // ─── Page 10: Save the Date / CTA ─────────────────────────────────
  if (guide.cta_headline?.trim() || guide.cta_body?.trim()) {
    onProgress?.('Rendering CTA…');
    doc.addPage();
    drawPageBorder(doc);

    let y = 80;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('SAVE THE DATE', centerX, y, { align: 'center' });
    y += 16;

    doc.setTextColor(DARK);
    doc.setFont('times', 'bold');
    doc.setFontSize(24);
    const headline = guide.cta_headline ?? 'Ready to walk the property?';
    const headlineLines = wrapText(doc, headline, CONTENT_W - 40, 24);
    doc.text(headlineLines, centerX, y, { align: 'center' });
    y += headlineLines.length * 10 + 10;

    if (guide.cta_body) {
      doc.setTextColor(55, 65, 81);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      const bodyLines = wrapText(doc, guide.cta_body, CONTENT_W - 40, 11);
      doc.text(bodyLines, centerX, y, { align: 'center' });
      y += bodyLines.length * 5 + 12;
    }

    // CTA button
    const btnLabel = guide.cta_button_label || 'Schedule a tour';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const btnW = doc.getTextWidth(btnLabel) + 20;
    const btnX = centerX - btnW / 2;
    doc.setFillColor(27, 27, 27);
    doc.roundedRect(btnX, y, btnW, 10, 5, 5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(btnLabel, centerX, y + 6.5, { align: 'center' });
    y += 20;

    doc.setTextColor(160, 160, 160);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(venueName, centerX, y, { align: 'center' });
  }

  // ─── Footer on every page ──────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setTextColor(180, 180, 180);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${venueName} · Pricing & Availability Guide`, centerX, PAGE_H - 8, { align: 'center' });
  }

  onProgress?.('Saving…');
  const fileName = `${venueName.replace(/[^a-zA-Z0-9]/g, '_')}_Pricing_Guide.pdf`;
  doc.save(fileName);
}

// ─── Decorative helpers ─────────────────────────────────────────────────

function drawPageBorder(doc: jsPDF) {
  doc.setDrawColor(240, 240, 240);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN - 2, MARGIN - 2, PAGE_W - (MARGIN - 2) * 2, PAGE_H - (MARGIN - 2) * 2);
}
