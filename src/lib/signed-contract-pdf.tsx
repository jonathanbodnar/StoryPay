/**
 * The couple's signed contract as a PDF: the contract text, the price and
 * payment schedule, and the signature record (signature, name, date and time,
 * IP address, the electronic-signature consent and the tamper-evident
 * fingerprint of what was signed). Rendered with @react-pdf/renderer.
 * SERVER-ONLY.
 */

import React from 'react';
import sanitizeHtml from 'sanitize-html';
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean };
type Block = { kind: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'quote' | 'hr'; runs: Run[]; bullet?: string };

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', bull: '•', copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The PDF's built-in fonts cover Latin-1 and common punctuation; drop anything else (emoji). */
function printable(s: string): string {
  return s.replace(/[^\u0009\u000A -ÿ–—‘’“”•…€™]/g, '');
}

/** Turn the contract's HTML into paragraphs, headings and list items. */
export function contractBlocks(html: string): Block[] {
  const clean = sanitizeHtml(html || '', {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u',
      'blockquote', 'hr', 'span', 'a', 'table', 'thead', 'tbody', 'tr', 'td', 'th'],
    allowedAttributes: {},
  });
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const style = { bold: 0, italic: 0, underline: 0 };
  const lists: Array<{ ordered: boolean; n: number }> = [];
  const flush = () => {
    if (cur) {
      const b: Block = cur;
      // Trim the block's outer whitespace.
      while (b.runs.length && !b.runs[0].text.trim()) b.runs.shift();
      while (b.runs.length && !b.runs[b.runs.length - 1].text.trim()) b.runs.pop();
      if (b.runs.length) {
        b.runs[0] = { ...b.runs[0], text: b.runs[0].text.replace(/^\s+/, '') };
        const last = b.runs.length - 1;
        b.runs[last] = { ...b.runs[last], text: b.runs[last].text.replace(/\s+$/, '') };
        blocks.push(b);
      }
    }
    cur = null;
  };
  const start = (kind: Block['kind'], bullet?: string) => {
    flush();
    cur = { kind, runs: [], bullet };
  };
  const bump = (key: keyof typeof style, closing: boolean) => {
    style[key] = Math.max(0, style[key] + (closing ? -1 : 1));
  };

  const re = /<(\/?)([a-z0-9]+)[^>]*>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    if (m[3] !== undefined) {
      const text = printable(decodeEntities(m[3]).replace(/\s+/g, ' '));
      if (!text.trim() && !cur) continue;
      if (!cur) start('p');
      (cur as Block | null)?.runs.push({ text, bold: style.bold > 0, italic: style.italic > 0, underline: style.underline > 0 });
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const open = cur as Block | null;
    switch (tag) {
      case 'strong': case 'b': bump('bold', closing); break;
      case 'em': case 'i': bump('italic', closing); break;
      case 'u': bump('underline', closing); break;
      case 'br': open?.runs.push({ text: '\n' }); break;
      case 'hr': flush(); blocks.push({ kind: 'hr', runs: [{ text: ' ' }] }); break;
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        if (closing) flush();
        else start(tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'h3');
        break;
      case 'p': case 'div': case 'tr':
        // A paragraph inside a list item stays part of that item.
        if (open?.kind === 'li') {
          if (closing && open.runs.length) open.runs.push({ text: '\n' });
          break;
        }
        if (closing) flush();
        else start('p');
        break;
      case 'td': case 'th':
        if (!closing && open?.runs.length) open.runs.push({ text: '    ' });
        break;
      case 'blockquote': if (closing) flush(); else start('quote'); break;
      case 'ul': case 'ol':
        if (closing) { lists.pop(); flush(); } else { flush(); lists.push({ ordered: tag === 'ol', n: 0 }); }
        break;
      case 'li': {
        if (closing) { flush(); break; }
        const list = lists[lists.length - 1];
        start('li', list?.ordered ? `${++list.n}.` : '•');
        break;
      }
      default: break;
    }
  }
  flush();
  return blocks;
}

export interface SignedContractInput {
  venueName: string;
  brandColor: string;
  documentNumber: string | null;
  customerName: string;
  customerEmail: string | null;
  contentHtml: string;
  priceCents: number;
  /** Payment plan: payment 1 is due at signing. Empty for pay in full. */
  schedule: Array<{ amount: number; date: string | null }>;
  /** Drawn signatures (image data URLs), with the signing form's labels. */
  signatures: Array<{ label: string; image: string | null }>;
  /** The signing form's other fields (printed name, date…). */
  fields: Array<{ label: string; value: string }>;
  /** Already formatted, e.g. "September 30, 2026 at 3:04 PM CDT". */
  signedAtLabel: string;
  signerIp: string | null;
  consentText: string | null;
  contentHash: string | null;
}

const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, color: '#1f2937' },
  // No lineHeight here or on the page: in @react-pdf it hides the fixed footer
  // (on the page) or doubles the spacing (on a View). The default reads fine.
  body: {},
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', paddingBottom: 12, marginBottom: 16 },
  venue: { fontFamily: 'Helvetica-Bold', fontSize: 18 },
  docLabel: { fontSize: 9, color: '#6b7280', textAlign: 'right' },
  parties: { fontSize: 10, color: '#374151', marginBottom: 16 },
  h1: { fontFamily: 'Helvetica-Bold', fontSize: 15, marginTop: 10, marginBottom: 6 },
  h2: { fontFamily: 'Helvetica-Bold', fontSize: 13, marginTop: 9, marginBottom: 5 },
  h3: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 8, marginBottom: 4 },
  p: { marginBottom: 8 },
  li: { marginBottom: 4, marginLeft: 14 },
  quote: { marginBottom: 6, marginLeft: 12, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#d1d5db', color: '#4b5563' },
  hr: { borderBottomWidth: 1, borderBottomColor: '#e5e7eb', marginVertical: 8 },
  section: { marginTop: 18, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12 },
  sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  muted: { color: '#6b7280', fontSize: 8.5 },
  signature: { width: 200, height: 70, objectFit: 'contain', marginBottom: 6 },
  footer: { position: 'absolute', bottom: 24, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#f3f4f6', paddingTop: 6 },
  footerText: { fontSize: 8, color: '#9ca3af' },
});

function runFont(r: Run): string {
  if (r.bold && r.italic) return 'Helvetica-BoldOblique';
  if (r.bold) return 'Helvetica-Bold';
  if (r.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

function signatureImage(dataUrl: string | null): { data: Buffer; format: 'png' | 'jpg' } | null {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl ?? '');
  if (!m) return null;
  try {
    return { data: Buffer.from(m[2], 'base64'), format: m[1].toLowerCase() === 'png' ? 'png' : 'jpg' };
  } catch {
    return null;
  }
}

function ContractDocument({ c }: { c: SignedContractInput }) {
  const blocks = contractBlocks(c.contentHtml);
  return (
    <Document title={`Signed contract — ${c.venueName}`} author={c.venueName}>
      <Page size="LETTER" style={s.page}>
        {/* Footer on every page */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{printable(c.venueName)} · Signed with StoryVenue</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
        <View style={s.body}>
        <View style={s.header}>
          <Text style={[s.venue, { color: c.brandColor || '#1b1b1b' }]}>{printable(c.venueName)}</Text>
          <View>
            <Text style={s.docLabel}>Signed contract</Text>
            {c.documentNumber ? <Text style={s.docLabel}>Proposal {c.documentNumber}</Text> : null}
          </View>
        </View>
        <Text style={s.parties}>
          Between {printable(c.venueName)} and {printable(c.customerName)}
          {c.customerEmail ? ` (${c.customerEmail})` : ''}.
        </Text>

        {blocks.map((b, i) =>
          b.kind === 'hr' ? (
            <View key={i} style={s.hr} />
          ) : (
            <Text key={i} style={s[b.kind]}>
              {b.bullet ? `${b.bullet}  ` : ''}
              {b.runs.map((r, j) => (
                <Text key={j} style={{ fontFamily: runFont(b.kind.startsWith('h') ? { ...r, bold: true } : r), textDecoration: r.underline ? 'underline' : 'none' }}>
                  {r.text}
                </Text>
              ))}
            </Text>
          ),
        )}

        <View style={s.section} wrap={false}>
          <Text style={s.sectionTitle}>Price and payments</Text>
          <View style={s.row}>
            <Text>Total</Text>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>{usd(c.priceCents)}</Text>
          </View>
          {c.schedule.length > 1 ? (
            c.schedule.map((p, i) => (
              <View key={i} style={s.row}>
                <Text>Payment {i + 1}{i === 0 ? ' (at signing)' : p.date ? ` — ${p.date}` : ''}</Text>
                <Text>{usd(p.amount)}</Text>
              </View>
            ))
          ) : (
            <Text style={s.muted}>One payment for the full amount.</Text>
          )}
        </View>

        <View style={s.section} wrap={false}>
          <Text style={s.sectionTitle}>Signature</Text>
          {c.signatures.map((sg, i) => {
            const img = signatureImage(sg.image);
            return img ? (
              <View key={i}>
                {/* @react-pdf's Image, not an HTML img: PDFs have no alt text. */}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={img} style={s.signature} />
                <Text style={[s.muted, { marginBottom: 6 }]}>{printable(sg.label)}</Text>
              </View>
            ) : null;
          })}
          {c.fields.map((f, i) => (
            <Text key={i}>{printable(f.label)}: {printable(f.value)}</Text>
          ))}
          <Text style={{ marginTop: 6 }}>Signed electronically by {printable(c.customerName)}{c.customerEmail ? ` (${c.customerEmail})` : ''}</Text>
          <Text>on {c.signedAtLabel}</Text>
          {c.signerIp ? <Text style={s.muted}>IP address: {c.signerIp}</Text> : null}
          {c.consentText ? <Text style={[s.muted, { marginTop: 6 }]}>Electronic signature consent: “{printable(c.consentText)}”</Text> : null}
          {c.contentHash ? <Text style={[s.muted, { marginTop: 6 }]}>Document fingerprint (SHA-256): {c.contentHash}</Text> : null}
        </View>
        </View>

      </Page>
    </Document>
  );
}

export async function renderSignedContractPdf(c: SignedContractInput): Promise<Buffer> {
  return renderToBuffer(<ContractDocument c={c} />);
}
