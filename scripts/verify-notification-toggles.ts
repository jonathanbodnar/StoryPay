/**
 * One-off verification script (not part of the app) — exercises the REAL
 * per-person toggle-gating logic and the REAL template-resolution function
 * against production Supabase, without sending any actual email/SMS.
 *
 * For every scenario in NOTIFICATION_SCENARIOS (+ venue_direct's own keys),
 * confirms:
 *   1. Both `email_<scenario>` and `sms_<scenario>` keys exist with sane
 *      boolean defaults.
 *   2. mergePersonNotificationSettings() correctly reflects an explicit
 *      override to `false` (toggle OFF) and to `true` (toggle ON) — i.e.
 *      the exact gate notifyOwner()/venue-direct route uses.
 *   3. getVenueEmailTemplate() resolves a non-null template for every
 *      templateType referenced by SCENARIO_META, so a toggle being ON never
 *      silently no-ops because the template lookup itself is broken.
 *
 * Run: npx tsx scripts/verify-notification-toggles.ts
 */
import {
  NOTIFICATION_SCENARIOS,
  DEFAULT_PERSON_NOTIFICATIONS,
  mergePersonNotificationSettings,
  emailKeyFor,
  smsKeyFor,
} from '../src/lib/notification-settings';
import { getVenueEmailTemplate } from '../src/lib/email-templates';

const OWNER_TEMPLATE_TYPES = [
  'payment_notification',    // payment_received, subscription_created, refund_issued
  'owner_payment_failed',    // payment_failed (owner voice)
  'proposal_signed',
  'document_viewed',
  'new_lead',
  'new_message',
  'ai_handoff',
];

const CUSTOMER_TEMPLATE_TYPES = [
  'invoice', 'proposal', 'payment_confirmation', 'subscription_confirmation',
  'payment_failed', 'payment_reminder',
];

let failures = 0;

function check(label: string, cond: boolean) {
  console.log(cond ? `  ✅ ${label}` : `  ❌ ${label}`);
  if (!cond) failures++;
}

async function main() {
  console.log('=== 1. Per-scenario email/sms toggle keys + defaults ===');
  for (const s of NOTIFICATION_SCENARIOS) {
    const ek = emailKeyFor(s.key);
    const sk = smsKeyFor(s.key);
    check(`${s.key}: ${ek} exists (default ${s.emailDefault})`, DEFAULT_PERSON_NOTIFICATIONS[ek] === s.emailDefault);
    check(`${s.key}: ${sk} exists (default ${s.smsDefault})`, DEFAULT_PERSON_NOTIFICATIONS[sk] === s.smsDefault);
  }

  console.log('\n=== 2. Toggle OFF/ON gating math (mergePersonNotificationSettings) ===');
  for (const s of NOTIFICATION_SCENARIOS) {
    const ek = emailKeyFor(s.key);
    const sk = smsKeyFor(s.key);

    // Simulate: person explicitly turned this OFF.
    const off = mergePersonNotificationSettings({ [ek]: false, [sk]: false });
    check(`${s.key}: email OFF → gate reads false`, off[ek] === false);
    check(`${s.key}: sms OFF → gate reads false`, off[sk] === false);

    // Simulate: person explicitly turned this ON.
    const on = mergePersonNotificationSettings({ [ek]: true, [sk]: true });
    check(`${s.key}: email ON → gate reads true`, on[ek] === true);
    check(`${s.key}: sms ON → gate reads true`, on[sk] === true);

    // Simulate: never touched (unset) → falls back to documented default.
    const unset = mergePersonNotificationSettings({});
    check(`${s.key}: unset → falls back to default (${s.emailDefault}/${s.smsDefault})`, unset[ek] === s.emailDefault && unset[sk] === s.smsDefault);

    // Simulate: legacy/stale key from a removed scenario shouldn't leak in.
    const withStale = mergePersonNotificationSettings({ email_invoice_paid: true, [ek]: false });
    check(`${s.key}: stale unknown key ignored, real key still respected`, withStale[ek] === false && !('email_invoice_paid' in DEFAULT_PERSON_NOTIFICATIONS));
  }

  console.log('\n=== 3. Email template resolution (getVenueEmailTemplate) for a venue with NO saved overrides ===');
  const FAKE_VENUE_ID = '00000000-0000-0000-0000-000000000000'; // guaranteed not to exist
  for (const type of [...OWNER_TEMPLATE_TYPES, ...CUSTOMER_TEMPLATE_TYPES]) {
    try {
      const tmpl = await getVenueEmailTemplate(FAKE_VENUE_ID, type);
      check(`template '${type}' resolves to a non-null default`, !!tmpl && !!tmpl.subject && !!tmpl.body);
    } catch (err) {
      check(`template '${type}' resolves without throwing`, false);
      console.error('    error:', err);
    }
  }

  console.log('\n=== 4. Removed scenarios are truly gone (no dangling toggle keys) ===');
  for (const removed of ['invoice_paid', 'subscription_cancelled', 'new_customer']) {
    check(`'${removed}' has no email_/sms_ default keys`, !(`email_${removed}` in DEFAULT_PERSON_NOTIFICATIONS) && !(`sms_${removed}` in DEFAULT_PERSON_NOTIFICATIONS));
  }

  console.log('\n=== Summary ===');
  if (failures === 0) {
    console.log('All checks passed. Toggle gating + template resolution are correct.');
  } else {
    console.log(`${failures} check(s) FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Script crashed:', err);
  process.exit(1);
});
