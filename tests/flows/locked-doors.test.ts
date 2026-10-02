import { describe, expect, it } from 'vitest';
import { env } from './helpers';
import { fill, ROUTES } from './routes';

// Locked doors: every route in the app refuses a stranger (no session, no
// key), except the ones below, which are public on purpose. The route list is
// read from the code, so a new route is checked the day it's added: if it's
// meant to be public, add it here with the reason.
const PUBLIC: Record<string, string> = {};
function allow(reason: string, ...keys: string[]) {
  for (const k of keys) PUBLIC[k] = reason;
}

allow('test copy only (404 on the live site)',
  'GET /api/staging/outbox', 'DELETE /api/staging/outbox', 'GET /api/staging/sms', 'POST /api/staging/sms', 'DELETE /api/staging/sms',
  'GET /staging-access', 'POST /staging-access');
allow('webhook that checks its sender’s signature',
  'POST /api/webhooks/stripe', 'POST /api/webhooks/stripe-connect', 'POST /api/webhooks/resend', 'GET /api/webhooks/ghl-workflow-inbound');
allow('webhook whose signature check is still watch-only (GHL_WEBHOOK_ENFORCE_SIGNATURE / CALENDLY_WEBHOOK_ENFORCE_SIGNATURE)',
  'GET /api/webhooks/ghl', 'POST /api/webhooks/ghl', 'GET /api/webhooks/calendly', 'POST /api/webhooks/calendly');
allow('opened from a private link (a token or a signed link)',
  'GET /api/availability/[token]', 'GET /api/calendar/ical', 'GET /api/card-update/[token]', 'POST /api/card-update/[token]/save',
  'POST /api/card-update/[token]/stripe-save', 'POST /api/card-update/[token]/stripe-setup', 'GET /api/couple/accept-invite',
  'POST /api/couple/accept-invite', 'GET /api/invite/[token]', 'GET /api/proposals/public/[token]',
  'GET /api/proposals/public/[token]/contract-pdf', 'POST /api/proposals/public/[token]/checkout', 'POST /api/proposals/public/[token]/pay',
  'POST /api/proposals/public/[token]/payment-intent', 'POST /api/proposals/public/[token]/sign', 'POST /api/proposals/public/[token]/stripe-pay',
  'POST /api/proposals/public/[token]/verify-payment', 'GET /api/public/couple-invite/unsubscribe', 'POST /api/public/couple-invite/unsubscribe',
  'GET /api/public/lead-link/[code]', 'GET /api/public/marketing/preferences', 'POST /api/public/marketing/preferences',
  'GET /api/public/marketing/resubscribe', 'GET /api/public/marketing/unsubscribe', 'POST /api/public/marketing/unsubscribe',
  'POST /api/public/get-guide', 'GET /api/rsvp/[token]', 'POST /api/rsvp/[token]', 'GET /g/[code]', 'GET /t/[code]');
allow('the couple’s invoice page, by the proposal’s unguessable id', 'GET /api/invoices/[proposalId]');
allow('signing in, signing up, signing out or resetting a password',
  'POST /api/auth/sign-in', 'POST /api/auth/signup', 'POST /api/auth/request-login', 'POST /api/auth/venue/forgot', 'POST /api/auth/venue/reset',
  'POST /api/auth/couple/forgot', 'POST /api/auth/member/reset', 'POST /api/auth/resend-verification', 'GET /api/auth/logout',
  'GET /api/auth/venue/[token]', 'GET /api/auth/admin-venue/[token]', 'GET /api/auth/verify-email/[token]', 'GET /api/auth/ghl/[locationId]',
  'POST /api/admin/login', 'DELETE /api/admin/login', 'POST /api/admin/auth/forgot', 'POST /api/admin/auth/reset', 'POST /api/admin/auth/verify-otp',
  'POST /api/admin/support/login', 'POST /api/admin/support/logout', 'GET /api/admin/support/me', 'POST /api/couple/signup');
allow('return page from Google, Pinterest, GoHighLevel, accounting or Stripe (signed state where it links an account)',
  'GET /api/calendar/google/callback', 'GET /api/couple/integrations/pinterest/callback', 'GET /api/integrations/callback',
  'GET /api/messaging/callback', 'GET /api/payments/stripe/connect/refresh', 'GET /api/payments/stripe/connect/return',
  'GET /api/venue-billing/stripe/checkout-return');
allow('public form (lead forms are signed or token-scoped)',
  'POST /api/public/forms/[token]/submit', 'GET /api/waitlist', 'POST /api/waitlist');
allow('anonymous tracking or logging (rate limited where it writes)',
  'GET /api/public/marketing/email-open', 'POST /api/analytics/track', 'POST /api/help/log-search', 'POST /api/help/rate-article',
  'POST /api/listing-track', 'POST /api/log-error', 'POST /api/public/venue/[venueId]/guide-view');
allow('public website or directory data',
  'GET /api/admin/addon-prices', 'GET /api/announcements', 'GET /api/blog', 'GET /api/embed/[venueSlug]', 'GET /api/fonts/google',
  'GET /api/page-seo', 'GET /api/public/directory/seo-index', 'GET /api/public/directory/venues', 'GET /api/public/location-suggestions',
  'GET /api/public/minisite/[slug]', 'GET /api/public/minisite/[slug]/guestbook', 'GET /api/public/recent-signups',
  'GET /api/public/venue/[venueId]/pricing-guide', 'GET /api/public/venues/[slug]');
allow('answers “signed out” (no data) to visitors',
  'GET /api/admin/impersonate/status', 'GET /api/auth/2fa/status', 'POST /api/auth/2fa/disable', 'POST /api/auth/2fa/enable',
  'POST /api/auth/2fa/setup', 'POST /api/auth/2fa/verify', 'GET /api/auth/impersonation-status', 'GET /api/conversations/venue-direct/unread-count',
  'GET /api/couple/favorites/check', 'GET /api/lunarpay/active', 'GET /api/notifications/badge-count', 'GET /api/push/vapid-public-key',
  'GET /api/venue-billing/signup-checkout/verify', 'GET /api/venue-concierge/unread', 'POST /api/realtime/topics');
allow('retired (always answers 410)', 'POST /api/lunarpay/onboard', 'POST /api/lunarpay/register', 'POST /api/venues/onboard');

const REFUSED = new Set([401, 403, 405]);
const all = ROUTES.flatMap((r) => r.methods.map((m) => `${m} ${r.path}`));

describe('locked doors', () => {
  it('every public route on the list still exists', () => {
    expect(Object.keys(PUBLIC).filter((k) => !all.includes(k))).toEqual([]);
  });

  it('every other route refuses a stranger', async () => {
    const todo = all.filter((k) => !(k in PUBLIC));
    const open: string[] = [];
    let next = 0;
    async function worker() {
      while (next < todo.length) {
        const key = todo[next++];
        const [method, path] = key.split(' ');
        const hasBody = method !== 'GET' && method !== 'DELETE';
        const res = await fetch(env.base + fill(path), {
          method,
          headers: { 'x-staging-key': env.stagingKey, ...(hasBody ? { 'content-type': 'application/json' } : {}) },
          body: hasBody ? '{}' : undefined,
          redirect: 'manual',
        });
        if (!REFUSED.has(res.status)) open.push(`${key} → ${res.status} ${(await res.text()).slice(0, 80)}`);
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    // A route listed here answered a stranger: lock it, or add it to PUBLIC with the reason.
    expect(open.sort()).toEqual([]);
  }, 240_000);
});
