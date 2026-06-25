/**
 * SaaS subscription lifecycle comms to the VENUE OWNER (not their brides).
 *
 * These are distinct from `owner-notifications.ts`, which notifies owners about
 * THEIR customers' payments. This module is StoryPay billing the venue for the
 * Bride Booking System subscription:
 *   • trial ending soon  — the chargeback shield: tell them before we charge
 *   • subscription charged — recognizable receipt so the statement line lands
 *   • card declined       — recoverable revenue, prompt a fix
 *   • downgraded to Free   — confirm what they keep (listing + payments)
 *
 * Transparency here is what keeps dispute rates low (and the platform merchant
 * account alive). Every send is best-effort and never throws.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io').replace(/\/$/, '');
const BILLING_URL = `${APP_URL}/dashboard/settings`;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL?.trim() || 'support@storypay.io';

type OwnerRecipient = {
  venueName: string;
  email: string | null;
  phone: string | null;
  ghlToken: string | null;
  ghlLocationId: string | null;
};

function dollars(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(0)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'soon';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'soon';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

async function loadOwner(venueId: string): Promise<OwnerRecipient | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('name, email, notification_email, notification_phone, ghl_access_token, ghl_location_id')
    .eq('id', venueId)
    .maybeSingle();
  if (!data) return null;
  const v = data as Record<string, unknown>;
  return {
    venueName: String(v.name ?? 'your venue'),
    email: (v.notification_email as string | null) || (v.email as string | null) || null,
    phone: (v.notification_phone as string | null) || null,
    ghlToken: (v.ghl_access_token as string | null) || null,
    ghlLocationId: (v.ghl_location_id as string | null) || null,
  };
}

function wrapHtml(heading: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<a href="${cta.url}" style="display:inline-block;background:#1b1b1b;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;margin-top:8px">${cta.label}</a>`
    : '';
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b1b1b">
    <h1 style="font-size:20px;margin:0 0 12px">${heading}</h1>
    <div style="font-size:15px;line-height:1.6;color:#374151">${bodyHtml}</div>
    <div style="margin-top:20px">${button}</div>
    <p style="font-size:12px;color:#9ca3af;margin-top:28px">Questions? Reply to this email or reach us at ${SUPPORT_EMAIL}.</p>
  </div>`;
}

async function sendOwnerSms(owner: OwnerRecipient, body: string): Promise<void> {
  if (!owner.phone || !owner.ghlToken || !owner.ghlLocationId) return;
  try {
    const { findOrCreateContact, normalizePhone, sendSms } = await import('@/lib/ghl');
    const phone = normalizePhone(owner.phone);
    if (!phone) return;
    const contactId = await findOrCreateContact(owner.ghlToken, owner.ghlLocationId, { phone });
    if (!contactId) return;
    await sendSms(owner.ghlToken, owner.ghlLocationId, String(contactId), body, undefined, phone);
  } catch { /* best-effort */ }
}

/** Day ~11/13: trial ends on `trialEndsAt`, card will be charged `amountCents`. */
export async function notifyVenueTrialEndingSoon(
  venueId: string,
  opts: { trialEndsAt: string | null; amountCents: number; daysLeft: number },
): Promise<void> {
  const owner = await loadOwner(venueId);
  if (!owner?.email) return;
  const when = fmtDate(opts.trialEndsAt);
  const amt = dollars(opts.amountCents);
  const subject = `Your free trial ends ${when} — ${amt}/mo after`;
  const html = wrapHtml(
    `Your Bride Booking System trial ends in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}`,
    `<p>Heads up — your 14-day free trial for <strong>${owner.venueName}</strong> ends on <strong>${when}</strong>.</p>
     <p>On that date your card will be charged <strong>${amt}/mo</strong> and your Bride Booking System keeps running. No action needed to continue.</p>
     <p>Not ready to keep it? You can switch to the Free plan anytime before then and you won't be charged — your listing and payment processing stay on.</p>`,
    { label: 'Manage subscription', url: BILLING_URL },
  );
  await sendEmail({ to: owner.email, subject, html }).catch(() => {});
  await sendOwnerSms(
    owner,
    `${owner.venueName}: your StoryPay free trial ends ${when}. We'll charge ${amt}/mo to keep your Bride Booking System on. Manage or switch to Free: ${BILLING_URL}`,
  );
}

/** Charge succeeded (trial converted or renewal) — recognizable receipt. */
export async function notifyVenueSubscriptionCharged(venueId: string, amountCents: number): Promise<void> {
  const owner = await loadOwner(venueId);
  if (!owner?.email) return;
  const amt = dollars(amountCents);
  const subject = `Payment received — ${amt} for your Bride Booking System`;
  const html = wrapHtml(
    `You're all set — ${amt} received`,
    `<p>Thanks! We charged <strong>${amt}</strong> for your Bride Booking System subscription for <strong>${owner.venueName}</strong>.</p>
     <p>Every bride who taps your link gets your pricing instantly and lands in your inbox. Keep the link in your bio, email signature, and website.</p>`,
    { label: 'Open your dashboard', url: `${APP_URL}/dashboard` },
  );
  await sendEmail({ to: owner.email, subject, html }).catch(() => {});
}

/** Card declined at renewal — recoverable, prompt a fix before downgrade. */
export async function notifyVenueCardDeclined(venueId: string): Promise<void> {
  const owner = await loadOwner(venueId);
  if (!owner?.email) return;
  const subject = `Your card was declined — update it to keep your Bride Booking System`;
  const html = wrapHtml(
    `We couldn't process your payment`,
    `<p>The card on file for <strong>${owner.venueName}</strong> was declined, so your Bride Booking System subscription didn't renew.</p>
     <p>Update your card in the next few days to keep your automated guide and follow-ups running. If it's not updated, your account will move to the Free plan (your listing and payment processing stay on).</p>`,
    { label: 'Update card', url: BILLING_URL },
  );
  await sendEmail({ to: owner.email, subject, html }).catch(() => {});
  await sendOwnerSms(
    owner,
    `${owner.venueName}: your card was declined and your Bride Booking System didn't renew. Update it to keep it on: ${BILLING_URL}`,
  );
}

const WINBACK_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A real bride just requested pricing but the venue is on Free, so the
 * automated guide + speed-to-lead did NOT fire. Nudge the owner to upgrade so
 * they stop leaving leads on the table. Throttled to once per cooldown window.
 */
export async function maybeSendWinbackNudge(venueId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('directory_winback_nudged_at')
    .eq('id', venueId)
    .maybeSingle();
  const last = (data as Record<string, unknown> | null)?.directory_winback_nudged_at as string | null;
  if (last) {
    const lastMs = new Date(last).getTime();
    if (!Number.isNaN(lastMs) && Date.now() - lastMs < WINBACK_COOLDOWN_MS) return;
  }

  const owner = await loadOwner(venueId);
  if (!owner?.email) return;

  const subject = `A bride just requested your pricing — your auto-reply is off`;
  const html = wrapHtml(
    `You just got a lead, but your Booking System is paused`,
    `<p>A bride just requested pricing from <strong>${owner.venueName}</strong>. Because you're on the Free plan, the instant guide and speed-to-lead follow-up didn't send. The lead is in your inbox, but the automatic reply that books brides is off.</p>
     <p>Turn your Bride Booking System back on so the next one gets your pricing in seconds.</p>`,
    { label: 'Turn it back on', url: BILLING_URL },
  );
  await sendEmail({ to: owner.email, subject, html }).catch(() => {});
  await supabaseAdmin
    .from('venues')
    .update({ directory_winback_nudged_at: new Date().toISOString() })
    .eq('id', venueId);
}

/** Settled to Free (chose downgrade, or dunning exhausted). */
export async function notifyVenueDowngradedToFree(venueId: string): Promise<void> {
  const owner = await loadOwner(venueId);
  if (!owner?.email) return;
  const subject = `You're on the Free plan`;
  const html = wrapHtml(
    `Your account moved to Free`,
    `<p><strong>${owner.venueName}</strong> is now on the Free plan. Your directory listing and payment processing stay on, so couples can still find you and pay you.</p>
     <p>The automated Bride Booking System (instant guide delivery and speed-to-lead follow-up) is paused. Turn it back on anytime — it takes one click.</p>`,
    { label: 'Turn the Booking System back on', url: BILLING_URL },
  );
  await sendEmail({ to: owner.email, subject, html }).catch(() => {});
}
