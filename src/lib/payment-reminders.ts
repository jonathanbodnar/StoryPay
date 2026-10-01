import { formatInTimeZone } from 'date-fns-tz';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { resolveVenueTimezone, wallClockToUtc } from '@/lib/venue-timezone';
import {
  type ReminderOffset,
  DEFAULT_PAYMENT_REMINDER_OFFSETS,
  normalizePaymentReminderOffsets,
} from '@/lib/reminder-offsets';
import { getVenueEmailTemplate, buildEmailHtml, fillTemplate } from '@/lib/email-templates';
import { loadVenueEmailBrand } from '@/lib/venue-email-brand';
import { sumManualPayments } from '@/lib/proposal-payments';
import { planPayments, toYmd } from '@/lib/payment-plan';

export { DEFAULT_PAYMENT_REMINDER_OFFSETS, normalizePaymentReminderOffsets };

/** send_at = due_at + offset (fires AFTER the due date). */
function computeReminderSendAfter(dueAt: Date, o: ReminderOffset): Date {
  const ms = ((o.d * 24 + o.h) * 60 + o.m) * 60 * 1000;
  return new Date(dueAt.getTime() + ms);
}

function formatOffsetLabel(o: ReminderOffset): string {
  const parts: string[] = [];
  if (o.d > 0) parts.push(`${o.d} day${o.d === 1 ? '' : 's'}`);
  if (o.h > 0) parts.push(`${o.h} hour${o.h === 1 ? '' : 's'}`);
  if (o.m > 0) parts.push(`${o.m} minute${o.m === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : '0';
}

/** No reminders for these: not sent yet, or the deal is off or refunded. */
const NO_REMINDERS = ['draft', 'cancelled', 'declined', 'expired', 'refunded', 'partial_refund'];

interface ReminderProposal {
  status: string | null;
  price: number | null;
  payment_type: string | null;
  payment_config: unknown;
  collect_manually: boolean | null;
}

/**
 * The payments a client can be reminded about, with how much is due through
 * each one (cumulative). A payment plan's later payments are left out when
 * they're charged automatically: the couple gets a heads-up before each
 * charge and a card-update link if one fails, so an "overdue" email would
 * only confuse them.
 */
function remindableSchedule(p: ReminderProposal): Array<{ index: number; amount: number; date: string; dueThrough: number }> {
  const out: Array<{ index: number; amount: number; date: string; dueThrough: number }> = [];
  if (p.payment_type === 'installment') {
    let running = 0;
    planPayments(p.payment_config).forEach((inst, index) => {
      if (!Number.isFinite(inst.amount) || inst.amount <= 0) return;
      running += inst.amount;
      const date = toYmd(inst.date);
      if (!date) return;
      if (index > 0 && p.collect_manually !== true) return;
      out.push({ index, amount: inst.amount, date, dueThrough: running });
    });
  } else if ((p.payment_type || 'full') === 'full') {
    const due = toYmd((p.payment_config as { due_date?: unknown } | null)?.due_date);
    const price = Math.round(Number(p.price) || 0);
    if (due && price > 0) out.push({ index: 0, amount: price, date: due, dueThrough: price });
  }
  return out;
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
      'id, venue_id, status, price, payment_type, payment_config, collect_manually, customer_email, customer_name, signed_at, public_token',
    )
    .eq('id', proposalId)
    .maybeSingle();

  if (pErr || !proposal) {
    console.error('[payment-reminders] load proposal', pErr);
    return;
  }

  const status = String((proposal as { status?: string }).status || '');
  if (NO_REMINDERS.includes(status)) return;

  // Invoices are marked signed when they're sent.
  if (!(proposal as { signed_at?: string | null }).signed_at) return;

  const email = String((proposal as { customer_email?: string | null }).customer_email || '').trim();
  if (!email) return;

  const schedule = remindableSchedule(proposal as unknown as ReminderProposal);
  if (!schedule.length) return;

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

  schedule.forEach((inst) => {
    const instIdx = inst.index;
    const dueAt = installmentDueInstant(inst.date, tz);
    if (dueAt.getTime() <= now) return;

    offsets.forEach((o, rIdx) => {
      const sendAt = computeReminderSendAfter(dueAt, o);
      if (sendAt.getTime() <= now) return;
      // Must be strictly after the due date.
      if (sendAt.getTime() <= dueAt.getTime()) return;
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
        installment_amount_cents: inst.amount,
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
    .in('payment_type', ['installment', 'full'])
    .not('status', 'in', `(${[...NO_REMINDERS, 'paid'].join(',')})`);

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
    .select('customer_email, customer_name, status, price, payment_type, payment_config, collect_manually, signed_at, public_token')
    .eq('id', row.proposal_id)
    .maybeSingle();

  if (!proposal || NO_REMINDERS.includes(String((proposal as { status?: string }).status || ''))) {
    return { ok: false, error: 'proposal_gone' };
  }
  if (!(proposal as { signed_at?: string | null }).signed_at) {
    return { ok: false, error: 'not_signed' };
  }

  // Only remind someone who still owes: everything due through this payment
  // must not already be in the payment ledger (online, cash or check).
  const p = proposal as unknown as ReminderProposal;
  if ((p.payment_type || 'full') === 'full' && p.status === 'paid') return { ok: false, error: 'already_paid' };
  const slot = remindableSchedule(p).find((s) => s.index === row.installment_index);
  if (!slot) return { ok: false, error: 'proposal_gone' };
  const paidCents = await sumManualPayments(row.proposal_id);
  const stillDue = Math.min(slot.amount, slot.dueThrough - paidCents);
  if (stillDue <= 0) return { ok: false, error: 'already_paid' };

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
  const amountStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(stillDue / 100);

  const token = String((proposal as { public_token?: string }).public_token || '');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';
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
    amount:        amountStr,
    due_date:      when,
    // offset_label now reflects how long AFTER the due date this reminder fires.
    offset_label:  formatOffsetLabel(o),
  };

  const subject = fillTemplate(tmpl.subject, vars);
  const html = buildEmailHtml({
    template:   tmpl,
    vars,
    actionUrl:  payLink,
    brandColor: (venue as { brand_color?: string | null } | null)?.brand_color || '#1b1b1b',
    venueBrand: await loadVenueEmailBrand(row.venue_id),
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
      if (result.error === 'proposal_gone' || result.error === 'no_email' || result.error === 'not_signed' || result.error === 'already_paid') {
        await supabaseAdmin.from('proposal_payment_reminders').delete().eq('id', row.id);
      } else {
        errors++;
      }
    }
  }

  return { processed: (due ?? []).length, sent, errors };
}
