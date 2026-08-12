/**
 * One-off verification (not part of the app): loads REAL recipients for a
 * real venue via loadNotificationRecipients(), then simulates the exact
 * filter notifyOwner()/venue-direct route uses for a couple of scenarios —
 * confirming toggle ON includes the recipient and toggle OFF excludes them,
 * using live production data. Read-only: does not send anything or write
 * anything back to the DB.
 *
 * Run: npx tsx scripts/verify-notification-recipients.ts <venueId>
 */
import { loadNotificationRecipients, emailKeyFor, smsKeyFor } from '../src/lib/notification-settings';

async function main() {
  const venueId = process.argv[2];
  if (!venueId) {
    console.error('Usage: npx tsx scripts/verify-notification-recipients.ts <venueId>');
    process.exit(1);
  }

  const recipients = await loadNotificationRecipients(venueId);
  console.log(`Loaded ${recipients.length} recipient(s) for venue ${venueId}:`);
  for (const r of recipients) {
    console.log(`  - [${r.kind}] ${r.name ?? '(no name)'} | email=${r.email ?? '—'} | phone=${r.phone ?? '—'}`);
  }

  for (const scenario of ['payment_received', 'ai_handoff', 'refund_issued', 'venue_direct']) {
    const emailKey = emailKeyFor(scenario);
    const smsKey = smsKeyFor(scenario);
    console.log(`\nScenario: ${scenario}`);
    for (const r of recipients) {
      const emailOn = r.settings[emailKey] === true;
      const smsOn = r.settings[smsKey] === true;
      const wouldSendEmail = !!r.email && emailOn;
      const wouldSendSms = !!r.phone && smsOn;
      console.log(
        `  - ${r.name ?? r.kind}: email toggle=${emailOn} (${r.email ? 'has email' : 'NO EMAIL'}) → would send email: ${wouldSendEmail} | sms toggle=${smsOn} (${r.phone ? 'has phone' : 'NO PHONE'}) → would send sms: ${wouldSendSms}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('Script crashed:', err);
  process.exit(1);
});
