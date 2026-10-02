import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signOAuthState, verifyOAuthState } from '@/lib/oauth-state';

// Connect flows (Google Calendar, QuickBooks/FreshBooks) only accept a state
// this server signed, for that flow, within the hour.
describe('signed connect-flow state', () => {
  beforeEach(() => { vi.stubEnv('NEXTAUTH_SECRET', 'state-secret-for-tests'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('round-trips the venue and extras', () => {
    const s = signOAuthState('accounting', 'venue-1', { provider: 'quickbooks' });
    expect(verifyOAuthState('accounting', s)).toEqual({ venueId: 'venue-1', extra: { provider: 'quickbooks' } });
  });

  it('refuses a raw venue ID, the old unsigned state, and a tampered one', () => {
    expect(verifyOAuthState('google-calendar', 'venue-1')).toBeNull();
    expect(verifyOAuthState('accounting', Buffer.from(JSON.stringify({ venueId: 'v', provider: 'quickbooks' })).toString('base64url'))).toBeNull();
    const s = signOAuthState('google-calendar', 'venue-1');
    const forged = Buffer.from(JSON.stringify({ v: 'venue-2', t: Date.now(), x: {} })).toString('base64url') + '.' + s.split('.')[1];
    expect(verifyOAuthState('google-calendar', forged)).toBeNull();
  });

  it('refuses a state from another flow, or signed with another secret', () => {
    expect(verifyOAuthState('accounting', signOAuthState('google-calendar', 'venue-1'))).toBeNull();
    const s = signOAuthState('google-calendar', 'venue-1');
    vi.stubEnv('NEXTAUTH_SECRET', 'a-different-secret');
    expect(verifyOAuthState('google-calendar', s)).toBeNull();
  });

  it('expires after an hour', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const s = signOAuthState('google-calendar', 'venue-1');
    vi.setSystemTime(new Date('2026-10-02T12:59:00Z'));
    expect(verifyOAuthState('google-calendar', s)?.venueId).toBe('venue-1');
    vi.setSystemTime(new Date('2026-10-02T13:01:00Z'));
    expect(verifyOAuthState('google-calendar', s)).toBeNull();
  });
});
