import { formatInTimeZone } from 'date-fns-tz';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { resolveVenueTimezone, wallClockToUtc } from '@/lib/venue-timezone';
import {
  type ReminderOffset,
  computeReminderSendAt,
  normalizeReminderOffsets,
} from '@/lib/appointment-reminders';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';

export const DEFAULT_PAYMENT_REMINDER_OFFSETS: ReminderOffset[] = [
  { d: 3, h: 0, m: 0 },
  { d: 1, h: 0, m: 0 },
  { d: 0, h: 2, m: 0 },
];

const MAX_PAYMENT_REMINDER_SLOTS = 3;

/** Normalize and cap at 3 offsets for payment due emails. */
export function normalizePaymentReminderOffsets(raw: unknown): ReminderOffset[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_PAYMENT_REMINDER_OFFSETS];
  const n = normalizeReminderOffsets(raw.slice(0, MAX_PAYMENT_REMINDER_SLOTS));
  return n.length ? n.slice(0, MAX_PAYMENT_REMINDER_SLOTS) : [...DEFAULT_PAYMENT_REMINDER_OFFSETS];
}

function formatOffsetLabel(o: ReminderOffset): string {
  const parts: string[] = [];
  if (o.d > 0) parts.push(`${o.d} day${o.d === 1 ? '' : 's'}`);
  if (o.h > 0) parts.push(`${o.h} hour${o.h === 1 ? '' : 's'}`);
  if (o.m > 0) parts.push(`${o.m} minute${o.m === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : '0';
}

interface InstallmentRow {
  amount: number;
  date: string;
}

function parseYmd(s: string): string | null {
  const t = (s || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

/** Due anchor: 12:00 local on the installment date (venue time zone). */
function installmentDueInstant(ymd: string, timeZone: string): Date {
  const tz = resolveVenueTimezone(timeZone);
  return wallClockToUtc(ymd, '12:00', tz);
}

export async function syncPaymentRemindersForProposal(proposalId: string): Promise<void> {
  await supabaseAdmin.from('proposal_payment_reminders').delete().eq('proposal_id', proposalId);

  const { data: proposal, error: pErr } = await supabaseAdmin
    .from('proposals')
    .select(
      'id, venue_id, status, payment_type, payment_config, customer_email, customer_name, signed_at, public_token',
    )
    .eq('id', proposalId)
    .maybeSingle();

  if (pErr || !proposal) {
    console.error('[payment-reminders] load proposal', pErr);
    return;
  }

  const status = String((proposal as { status?: string }).status || '');
  if (status === 'draft' || status === 'cancelled') return;

  if (!(proposal as { signed_at?: string | null }).signed_at) return;

  if ((proposal as { payment_type?: string }).payment_type !== 'installment') return;

  const email = String((proposal as { customer_email?: string | null }).customer_email || '').trim();
  if (!email) return;

  const cfg = (proposal as { payment_config?: unknown }).payment_config as
    | { installments?: InstallmentRow[] }
    | null
    | undefined;
  const installments = Array.isArray(cfg?.installments) ? cfg!.installments! : [];
  if (!installments.length) return;

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('payment_reminders_enabled, payment_reminder_offsets, name, timezone, brand_email, email')
    .eq('id', (proposal as { venue_id: string }).venue_id)
    .maybeSingle();

  if (!venue) return;
  if ((venue as { payment_reminders_enabled?: boolean }).payment_reminders_enabled === false) return;

  const tz = resolveVenueTimezone((venue as { timezone?: string | null }).timezone);
  const offsets = normalizePaymentReminderOffsets(
    (venue as { payment_reminder_offsets?: unknown }).payment_reminder_offsets,
  );
  if (!offsets.length) return;

  const now = Date.now();
  const rows: Array<{
    proposal_id: string;
    venue_id: string;
    installment_index: number;
    reminder_index: number;
    offset_days: number;
    offset_hours: number;
    offset_minutes: number;
    send_at: string;
    due_at: string;
    installment_amount_cents: number | null;
  }> = [];

  installments.forEach((inst, instIdx) => {
    const ymd = parseYmd(inst.date);
    if (!ymd) return;
    const dueAt = installmentDueInstant(ymd, tz);
    if (dueAt.getTime() <= now) return;

    offsets.forEach((o, rIdx) => {
      const sendAt = computeReminderSendAt(dueAt, o);
      if (sendAt.getTime() <= now) return;
      if (sendAt.getTime() >= dueAt.getTime()) return;
      rows.push({
        proposal_id: proposalId,
        venue_id: (proposal as { venue_id: string }).venue_id,
        installment_index: instIdx,
        reminder_index: rIdx,
        offset_days: o.d,
        offset_hours: o.h,
        offset_minutes: o.m,
        send_at: sendAt.toISOString(),
        due_at: dueAt.toISOString(),
        installment_amount_cents: typeof inst.amount === 'number' ? inst.amount : null,
      });
    });
  });

  if (!rows.length) return;

  const { error: insErr } = await supabaseAdmin.from('proposal_payment_reminders').insert(rows);
  if (insErr) console.error('[payment-reminders] insert', insErr);
}

export async function refreshPaymentRemindersForVenue(venueId: string): Promise<void> {
  const { data: proposals, error } = await supabaseAdmin
    .from('proposals')
    .select('id')
    .eq('venue_id', venueId)
    .not('signed_at', 'is', null)
    .eq('payment_type', 'installment')
    .neq('status', 'draft')
    .neq('status', 'cancelled');

  if (error) {
    console.error('[payment-reminders] list proposals', error);
    return;
  }
  for (const p of proposals ?? []) {
    await syncPaymentRemindersForProposal((p as { id: string }).id);
  }
}

export async function sendPaymentDueReminderEmail(row: {
  id: string;
  send_at: string;
  offset_days: number;
  offset_hours: number;
  offset_minutes: number;
  proposal_id: string;
  venue_id: string;
  installment_index: number;
  due_at: string;
  installment_amount_cents: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const { data: proposal } = await supabaseAdmin
    .from('proposals')
    .select('customer_email, customer_name, status, payment_type, signed_at, public_token')
    .eq('id', row.proposal_id)
    .maybeSingle();

  if (!proposal || (proposal as { status?: string }).status === 'cancelled') {
    return { ok: false, error: 'proposal_gone' };
  }
  if (!(proposal as { signed_at?: string | null }).signed_at) {
    return { ok: false, error: 'not_signed' };
  }

  const to = String((proposal as { customer_email?: string | null }).customer_email || '').trim();
  if (!to) return { ok: false, error: 'no_email' };

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('name, timezone, brand_email, email, brand_color, brand_logo_url')
    .eq('id', row.venue_id)
    .maybeSingle();

  const tz = resolveVenueTimezone((venue as { timezone?: string | null } | null)?.timezone);
  const venueName = (venue as { name?: string } | null)?.name || 'Your venue';
  const dueAt = new Date(row.due_at);
  const when = formatInTimeZone(dueAt, tz, "EEEE, MMMM d, yyyy 'at' h:mm a zzz");
  const o: ReminderOffset = {
    d: row.offset_days,
    h: row.offset_hours,
    m: row.offset_minutes,
  };
  const amountStr =
    row.installment_amount_cents != null
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
          row.installment_amount_cents / 100,
        )
      : '';

  const token = String((proposal as { public_token?: string }).public_token || '');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.storypay.io';
  const payLink = token ? `${appUrl}/proposal/${token}` : appUrl;

  // Load the venue's branded `payment_reminder` email template (or fall back
  // to the canonical defaults defined in `src/lib/email-templates.ts`).
  // If the venue has explicitly disabled this template, skip the send.
  const tmpl = await getVenueEmailTemplate(row.venue_id, 'payment_reminder');
  if (!tmpl) {
    return { ok: false, error: 'template_disabled' };
  }
  const customerName = String((proposal as { customer_name?: string | null }).customer_name || 'there');
  const vars: Record<string, string> = {
    organization:  venueName,
    customer_name: customerName,
    amount:        amountStr || '$0.00',
    due_date:      when,
    offset_label:  formatOffsetLabel(o),
  };

  const subject = fillTemplate(tmpl.subject, vars);
  const html = buildEmailHtml({
    template:   tmpl,
    vars,
    actionUrl:  payLink,
    brandColor: (venue as { brand_color?: string | null } | null)?.brand_color || '#1b1b1b',
    logoUrl:    (venue as { brand_logo_url?: string | null } | null)?.brand_logo_url || undefined,
    venueName,
  });

  const replyTo =
    (venue as { brand_email?: string | null; email?: string | null })?.brand_email ||
    (venue as { email?: string | null })?.email ||
    undefined;

  const r = await sendEmail({
    to,
    subject,
    html,
    replyTo,
    from: { name: venueName },
  });
  return r.success ? { ok: true } : { ok: false, error: r.error };
}

const BATCH = 40;

export async function processPaymentRemindersCron(): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const now = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from('proposal_payment_reminders')
    .select(
      'id, send_at, offset_days, offset_hours, offset_minutes, proposal_id, venue_id, installment_index, due_at, installment_amount_cents',
    )
    .is('sent_at', null)
    .lte('send_at', now)
    .order('send_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error('[cron payment-reminders] query', error);
    return { processed: 0, sent: 0, errors: 1 };
  }

  let sent = 0;
  let errors = 0;

  for (const raw of due ?? []) {
    const row = raw as {
      id: string;
      send_at: string;
      offset_days: number;
      offset_hours: number;
      offset_minutes: number;
      proposal_id: string;
      venue_id: string;
      installment_index: number;
      due_at: string;
      installment_amount_cents: number | null;
    };

    const result = await sendPaymentDueReminderEmail(row);
    if (result.ok) {
      const { error: upErr } = await supabaseAdmin
        .from('proposal_payment_reminders')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('sent_at', null);
      if (!upErr) sent++;
      else errors++;
    } else {
      if (result.error === 'proposal_gone' || result.error === 'no_email' || result.error === 'not_signed') {
        await supabaseAdmin.from('proposal_payment_reminders').delete().eq('id', row.id);
      } else {
        errors++;
      }
    }
  }

  return { processed: (due ?? []).length, sent, errors };
}
