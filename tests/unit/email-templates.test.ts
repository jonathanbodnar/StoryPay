import { describe, expect, it, vi } from 'vitest';
import { buildEmailHtml, buildSystemEmail, fillTemplate, STORYVENUE_DARK_LOGO_URL, type EmailTemplateRow } from '@/lib/email-templates';
import { normalizeServiceFeePct, serviceFeeCents, serviceFeeLabel } from '@/lib/service-fee';
import { capitalizeName } from '@/lib/format-name';
import { isPastDueDate } from '@/lib/utils';

const template = (type: string): EmailTemplateRow => ({
  type,
  subject: 'Invoice from {{organization}}',
  heading: 'Hi {{customer_name}}',
  body: 'You owe {{amount}}.\n\nNote: {{note}}',
  button_text: 'Pay',
  footer: null,
  enabled: true,
});

const logo = { url: 'https://cdn.example.com/logo.png', width: 64, height: 64 };

describe('who an email is branded as', () => {
  it('emails to couples carry the venue’s logo', () => {
    for (const type of ['invoice', 'proposal', 'payment_confirmation', 'payment_failed', 'payment_upcoming', 'payment_reminder', 'signed_contract_copy', 'card_update_link', 'subscription_confirmation']) {
      const html = buildEmailHtml({ template: template(type), vars: {}, venueName: 'Sunset Hill', venueBrand: { name: 'Sunset Hill', logo } });
      expect(html, type).toContain('src="https://cdn.example.com/logo.png" alt="Sunset Hill" width="64" height="64"');
      expect(html, type).not.toContain(STORYVENUE_DARK_LOGO_URL);
    }
  });

  it('without a usable logo, couples see the venue’s name, never StoryVenue’s logo', () => {
    const html = buildEmailHtml({ template: template('invoice'), vars: {}, venueName: 'Rose & Thorn <Barn>' });
    expect(html).toContain('Rose &amp; Thorn &lt;Barn&gt;</p>');
    expect(html).not.toContain(STORYVENUE_DARK_LOGO_URL);
  });

  it('the name the sender passes wins over the brand lookup', () => {
    const html = buildEmailHtml({ template: template('invoice'), vars: {}, venueName: 'Real Name', venueBrand: { name: 'Your Venue', logo: null } });
    expect(html).toContain('Real Name</p>');
    expect(html).not.toContain('Your Venue');
  });

  it('owner alerts and system email keep the StoryVenue logo', () => {
    for (const type of ['new_lead', 'payment_notification', 'proposal_signed', 'new_message', 'owner_payment_failed', 'admin_otp']) {
      const html = buildEmailHtml({ template: template(type), vars: {}, venueName: 'Sunset Hill', venueBrand: { name: 'Sunset Hill', logo } });
      expect(html, type).toContain(STORYVENUE_DARK_LOGO_URL);
      expect(html, type).not.toContain('cdn.example.com/logo.png');
    }
    expect(buildSystemEmail({ bodyHtml: '<p>x</p>' })).toContain(STORYVENUE_DARK_LOGO_URL);
  });
});

describe('email content', () => {
  it('escapes what leads and couples typed', () => {
    const html = buildEmailHtml({ template: template('invoice'), vars: { customer_name: '<script>alert(1)</script>', note: '"><img src=x onerror=alert(1)>' }, venueName: 'V' });
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;Script&gt;');
  });

  it('shows "&" in a couple’s name correctly (never "&Amp;")', () => {
    const t = { ...template('invoice'), body: 'Thanks {{contact.first_name}}, {{couple_name}}' };
    const html = buildEmailHtml({ template: t, vars: { customer_name: 'sarah & mike', couple_name: "o'brien & lee" }, venueName: 'V' });
    expect(html).toContain('Hi Sarah &amp; Mike</p>');
    expect(html).toContain('Thanks Sarah, O&#39;Brien &amp; Lee</p>');
    expect(html).not.toMatch(/&(Amp|Quot|Lt|Gt);/);
  });

  it('capitalizes people’s names', () => {
    expect(fillTemplate('Hi {{customer_name}}', { customer_name: 'jane  smith' })).toBe('Hi Jane Smith');
    expect(fillTemplate('{{customer_name}}', { customer_name: 'jane@example.com' })).toBe('jane@example.com');
    expect(capitalizeName("  o'brien mcdonald ")).toBe("O'Brien Mcdonald");
    expect(capitalizeName(null)).toBe('');
  });

  it('turns blank lines into spacing and adds the button and footer', () => {
    const html = buildEmailHtml({ template: template('invoice'), vars: { amount: '$1,000.00', note: 'thanks' }, venueName: 'V', actionUrl: 'https://app.example.com/invoice/1' });
    expect(html).toContain('You owe $1,000.00.</p>');
    expect(html).toContain('<div style="height:10px"></div>');
    expect(html).toContain('href="https://app.example.com/invoice/1"');
    expect(html).toContain('Sent via StoryVenue on behalf of V');
  });
});

describe('service fee', () => {
  it('defaults to 3.5% and caps at 25%', () => {
    expect(normalizeServiceFeePct(undefined)).toBe(3.5);
    expect(normalizeServiceFeePct('abc')).toBe(3.5);
    expect(normalizeServiceFeePct(-1)).toBe(3.5);
    expect(normalizeServiceFeePct(0)).toBe(0);
    expect(normalizeServiceFeePct('4')).toBe(4);
    expect(normalizeServiceFeePct(3.456)).toBe(3.46);
    expect(normalizeServiceFeePct(30)).toBe(25);
  });

  it('works out to the cent', () => {
    expect(serviceFeeCents(100000, 3.5)).toBe(3500);
    expect(serviceFeeCents(12345, 3.5)).toBe(432);
    expect(serviceFeeCents(-500, 3.5)).toBe(0);
    expect(serviceFeeCents(100000, 0)).toBe(0);
  });

  it('is labelled a service fee, never a card fee', () => {
    expect(serviceFeeLabel(3.5)).toBe('Service fee (3.5%)');
    expect(serviceFeeLabel(4)).toBe('Service fee (4%)');
  });
});

describe('due dates', () => {
  it('a task due today is not overdue anywhere in the US', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 1, 23, 30)); // 11:30 pm local, Oct 1
    expect(isPastDueDate('2026-10-01')).toBe(false);
    expect(isPastDueDate('2026-09-30')).toBe(true);
    expect(isPastDueDate('2026-09-30T23:00:00Z')).toBe(true);
    expect(isPastDueDate(null)).toBe(false);
    expect(isPastDueDate('soon')).toBe(false);
    vi.useRealTimers();
  });
});
