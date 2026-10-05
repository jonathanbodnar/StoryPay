import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Billing never texts a venue (owner's rule, Oct 5 2026: "Only send them an
// email, no text ever for billing"). The trial-ending heads-up and the
// card-declined notice used to go out as texts as well as emails.
describe('StoryVenue billing a venue', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'saas-billing-notifications.ts'), 'utf8');
  // What the file does, without its comments (which explain the rule in words).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('its notices cannot text: the file has no way to send one', () => {
    expect(code).not.toMatch(/@\/lib\/ghl\b/);
    expect(code).not.toMatch(/@\/lib\/(sms|texting|concierge-sms)/);
    expect(code).not.toMatch(/sendSms|sendOwnerSms|sendText/i);
    // It doesn't even read the owner's phone number.
    expect(code).not.toMatch(/notification_phone|\bphone\b/);
  });

  it('every notice it has sends an email', () => {
    const notices = [...code.matchAll(/export async function (notifyVenue\w+)\([\s\S]*?\n}\n/g)];
    expect(notices.map((m) => m[1]).sort()).toEqual([
      'notifyVenueCardDeclined', 'notifyVenueDowngradedToFree', 'notifyVenueSubscriptionCharged',
      'notifyVenueTrialEndedNoCard', 'notifyVenueTrialEndingNoCard', 'notifyVenueTrialEndingSoon',
    ]);
    for (const [body, name] of notices) expect(body, name).toContain('sendEmail(');
  });
});
