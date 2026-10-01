import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from '@/lib/email';
import { sendPushToVenue, sendToSubscriptions } from '@/lib/push';
import { sendNativePush } from '@/lib/native-push';
import { getOwnerGhlConfig } from '@/lib/owner-ghl-sync';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function captureResend() {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  }));
  vi.stubEnv('RESEND_API_KEY', 're_test');
  return calls;
}

describe('sendEmail', () => {
  it('in the test copy, skips recipients off the allowlist and reports success', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('STAGING_EMAIL_ALLOWLIST', '@tests.example.com');
    const calls = captureResend();
    const r = await sendEmail({ to: 'bride@gmail.com', subject: 'Your invoice', html: '<p>Hi</p>' });
    expect(r).toEqual({ success: true, id: 'staging-not-sent' });
    expect(calls).toHaveLength(0);
  });

  it('in the test copy, sends to allowed recipients only, marked [TEST]', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('STAGING_EMAIL_ALLOWLIST', '@tests.example.com');
    const calls = captureResend();
    await sendEmail({ to: ['ok@tests.example.com', 'bride@gmail.com'], cc: ['cc@gmail.com'], subject: 'Your invoice', html: '<p>Hi</p>' });
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toEqual(['ok@tests.example.com']);
    expect(calls[0].cc).toBeUndefined();
    expect(calls[0].subject).toBe('[TEST] Your invoice');
  });

  it('on the live site, sends to everyone with the subject unchanged', async () => {
    vi.stubEnv('APP_ENV', '');
    const calls = captureResend();
    await sendEmail({ to: 'bride@gmail.com', subject: 'Your invoice', html: '<p>Hi</p>' });
    expect(calls[0].to).toEqual(['bride@gmail.com']);
    expect(calls[0].subject).toBe('Your invoice');
  });
});

describe('app notifications', () => {
  it('never go out from the test copy', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    // No database settings: reaching the database would throw, so these prove the early exit.
    const none = { sent: 0, pruned: 0, failed: 0 };
    expect(await sendPushToVenue('venue-1', { title: 't', body: 'b' })).toEqual(none);
    expect(await sendToSubscriptions([], { title: 't', body: 'b' })).toEqual(none);
    expect(await sendNativePush('venue-1', { title: 't', body: 'b' })).toEqual(none);
  });
});

describe('getOwnerGhlConfig', () => {
  it('is off in the test copy even when its settings exist', () => {
    vi.stubEnv('OWNER_GHL_LOCATION_ID', 'loc');
    vi.stubEnv('OWNER_GHL_PIT_TOKEN', 'pit-token');
    vi.stubEnv('APP_ENV', '');
    expect(getOwnerGhlConfig()).not.toBeNull();
    vi.stubEnv('APP_ENV', 'staging');
    expect(getOwnerGhlConfig()).toBeNull();
  });
});

describe('getStripe', () => {
  it('refuses a live key in the test copy and takes a test key', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_123');
    const live = await import('@/lib/stripe/client');
    expect(() => live.getStripe()).toThrow('test key');
    vi.resetModules();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
    const test = await import('@/lib/stripe/client');
    expect(test.getStripe()).toBeTruthy();
  });

  it('takes a live key on the live site', async () => {
    vi.stubEnv('APP_ENV', '');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_123');
    const { getStripe } = await import('@/lib/stripe/client');
    expect(getStripe()).toBeTruthy();
  });
});
