/**
 * The couple's copy of what they signed. SERVER-ONLY.
 *
 *   • signedContractPdf  — the PDF for a signed proposal (downloaded from the
 *     proposal page or the venue's booking page).
 *   • emailSignedContract — right after signing, email the couple a copy.
 */

import { formatInTimeZone } from 'date-fns-tz';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveVenueTimezone } from '@/lib/venue-timezone';
import { renderSignedContractPdf } from '@/lib/signed-contract-pdf';
import { planPayments, toYmd } from '@/lib/payment-plan';
import { sendEmail } from '@/lib/email';
import { buildEmailHtml, fillTemplate } from '@/lib/email-templates';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');

interface SignedProposal {
  id: string;
  public_token: string;
  venue_id: string;
  status: string;
  is_invoice: boolean | null;
  proposal_number: number | null;
  customer_name: string | null;
  customer_email: string | null;
  content: string | null;
  price: number | null;
  payment_type: string | null;
  payment_config: unknown;
  collect_manually: boolean | null;
  /** The signing form's values, keyed `${field_type}_${sort_order}` (older rows: a single data URL). */
  signature_data: unknown;
  signature_fields: unknown;
  signed_at: string | null;
  signer_ip: string | null;
  signer_consent_text: string | null;
  signed_content_hash: string | null;
}

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** The PDF of a signed proposal, or null when there's no signed contract to show. */
export async function signedContractPdf(by: { token?: string; id?: string }): Promise<{
  pdf: Buffer;
  filename: string;
  proposal: SignedProposal;
  venue: { name: string; email: string | null; brand_color: string | null; brand_logo_url: string | null };
} | null> {
  let q = supabaseAdmin
    .from('proposals')
    .select(
      'id, public_token, venue_id, status, is_invoice, proposal_number, customer_name, customer_email, content, price, ' +
        'payment_type, payment_config, collect_manually, signature_data, signature_fields, signed_at, signer_ip, signer_consent_text, signed_content_hash',
    );
  q = by.token ? q.eq('public_token', by.token) : q.eq('id', by.id as string);
  const { data } = await q.maybeSingle();
  const p = data as unknown as SignedProposal | null;
  if (!p || p.is_invoice === true || !p.signed_at) return null;

  const { data: v } = await supabaseAdmin
    .from('venues')
    .select('name, email, brand_email, brand_color, brand_logo_url, timezone')
    .eq('id', p.venue_id)
    .maybeSingle();
  const venue = (v ?? {}) as { name?: string | null; email?: string | null; brand_email?: string | null; brand_color?: string | null; brand_logo_url?: string | null; timezone?: string | null };
  const venueName = venue.name || 'Your venue';
  const tz = resolveVenueTimezone(venue.timezone);

  const schedule = p.payment_type === 'installment'
    ? planPayments(p.payment_config).map((s, i) => ({ amount: s.amount, date: i === 0 ? null : (toYmd(s.date) ? longDate(toYmd(s.date) as string) : null) }))
    : [];

  // The signing form: drawn signatures, and the other fields (name, date…) by their labels.
  const values: Record<string, unknown> =
    typeof p.signature_data === 'string'
      ? { signature_0: p.signature_data }
      : p.signature_data && typeof p.signature_data === 'object'
        ? (p.signature_data as Record<string, unknown>)
        : {};
  type FieldDef = { field_type?: string; label?: string; sort_order?: number };
  const defs: FieldDef[] = Array.isArray(p.signature_fields) && p.signature_fields.length
    ? (p.signature_fields as FieldDef[])
    : [
        { field_type: 'signature', label: 'Client Signature', sort_order: 0 },
        { field_type: 'name', label: 'Printed Name', sort_order: 1 },
        { field_type: 'date', label: 'Date', sort_order: 2 },
      ];
  const signatures: Array<{ label: string; image: string | null }> = [];
  const fields: Array<{ label: string; value: string }> = [];
  for (const d of [...defs].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const value = values[`${d.field_type}_${d.sort_order}`];
    if (typeof value !== 'string' || !value.trim()) continue;
    const label = d.label || (d.field_type === 'signature' ? 'Signature' : 'Field');
    if (d.field_type === 'signature') signatures.push({ label, image: value });
    else fields.push({ label, value: d.field_type === 'date' && toYmd(value) ? longDate(toYmd(value) as string) : value.trim() });
  }

  const pdf = await renderSignedContractPdf({
    venueName,
    brandColor: venue.brand_color || '#1b1b1b',
    documentNumber: p.proposal_number != null ? `#${p.proposal_number}` : null,
    customerName: p.customer_name || 'Client',
    customerEmail: p.customer_email,
    contentHtml: p.content || '',
    priceCents: Math.round(Number(p.price) || 0),
    schedule,
    signatures,
    fields,
    signedAtLabel: formatInTimeZone(new Date(p.signed_at), tz, "MMMM d, yyyy 'at' h:mm a zzz"),
    signerIp: p.signer_ip,
    consentText: p.signer_consent_text,
    contentHash: p.signed_content_hash,
  });

  const safeName = venueName.replace(/[\\/:*?"<>|]+/g, '').trim() || 'venue';
  return {
    pdf,
    filename: `Signed contract - ${safeName}.pdf`,
    proposal: p,
    venue: { name: venueName, email: venue.brand_email || venue.email || null, brand_color: venue.brand_color ?? null, brand_logo_url: venue.brand_logo_url ?? null },
  };
}

/** Right after the couple signs: email them a copy of the signed contract. */
export async function emailSignedContract(proposalId: string): Promise<boolean> {
  const r = await signedContractPdf({ id: proposalId });
  const to = r?.proposal.customer_email?.trim();
  if (!r || !to) return false;
  const { proposal: p, venue } = r;

  const nextStep = p.collect_manually === true
    ? `${venue.name} will be in touch about payment.`
    : p.status === 'paid'
      ? 'Your payment is complete. Thank you!'
      : 'Your next step is your payment, which you can complete from your proposal anytime.';
  const vars: Record<string, string> = { organization: venue.name, customer_name: p.customer_name || 'there', next_step: nextStep };
  const template = {
    type: 'signed_contract_copy',
    subject: 'Your signed contract with {{organization}}',
    heading: 'You’re all signed',
    body: 'Hi {{customer_name}},\n\nThank you for signing your contract with {{organization}}. A copy is attached for your records.\n\n{{next_step}}',
    button_text: 'View your proposal',
    footer: null,
    enabled: true,
  };
  const res = await sendEmail({
    to,
    subject: fillTemplate(template.subject, vars),
    html: buildEmailHtml({
      template,
      vars,
      actionUrl: `${APP_URL}/proposal/${p.public_token}`,
      brandColor: venue.brand_color || '#1b1b1b',
      logoUrl: venue.brand_logo_url || undefined,
      venueName: venue.name,
    }),
    from: { name: venue.name },
    replyTo: venue.email || undefined,
    attachments: [{ filename: r.filename, content: r.pdf.toString('base64') }],
  });
  if (!res.success) console.error('[signed-contract] email failed:', res.error);
  return res.success;
}
