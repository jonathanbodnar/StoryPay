import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installStagingFetchGuard,
  isStaging,
  stagingBlocksHost,
  stagingConfigProblems,
  stagingEmailFilter,
} from '@/lib/staging';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (globalThis as { __stagingFetchGuard?: boolean }).__stagingFetchGuard;
});

describe('isStaging', () => {
  it('is off unless APP_ENV is staging', () => {
    vi.stubEnv('APP_ENV', '');
    expect(isStaging()).toBe(false);
    vi.stubEnv('APP_ENV', 'production');
    expect(isStaging()).toBe(false);
    vi.stubEnv('APP_ENV', 'staging');
    expect(isStaging()).toBe(true);
  });
});

describe('stagingConfigProblems', () => {
  const clean = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://stagingref.supabase.co',
    SUPABASE_DB_URL: 'postgresql://postgres.stagingref:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres',
    STRIPE_SECRET_KEY: 'sk_test_abc',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_abc',
  };

  it('accepts a clean test setup', () => {
    expect(stagingConfigProblems(clean)).toEqual([]);
  });

  it('refuses the live database', () => {
    const p = stagingConfigProblems({ ...clean, NEXT_PUBLIC_SUPABASE_URL: 'https://brnxhsaakmhgwcthcapd.supabase.co' });
    expect(p).toEqual(['NEXT_PUBLIC_SUPABASE_URL points at the live database']);
    expect(stagingConfigProblems({ ...clean, DATABASE_URL: 'postgresql://postgres.brnxhsaakmhgwcthcapd:pw@host/db' })).toHaveLength(1);
  });

  it('refuses live Stripe keys but takes test keys', () => {
    expect(stagingConfigProblems({ ...clean, STRIPE_SECRET_KEY: 'sk_live_123' })).toEqual(['STRIPE_SECRET_KEY is a live Stripe key']);
    expect(stagingConfigProblems({ ...clean, STRIPE_SECRET_KEY: 'rk_live_123' })).toHaveLength(1);
    expect(stagingConfigProblems({ ...clean, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_1' })).toHaveLength(1);
  });

  it('refuses LunarPay, GHL agency/owner, Meta pixel and Slack settings', () => {
    for (const name of ['LP_AGENCY_KEY', 'STORYPAY_HQ_LUNARPAY_SK', 'STORYPAY_HQ_LUNARPAY_PK', 'GHL_AGENCY_API_KEY', 'OWNER_GHL_PIT_TOKEN', 'NEXT_PUBLIC_META_PIXEL_ID', 'SLACK_SUPPORT_WEBHOOK_URL']) {
      expect(stagingConfigProblems({ ...clean, [name]: 'x' })).toEqual([`${name} is set`]);
    }
    expect(stagingConfigProblems({ ...clean, LP_AGENCY_KEY: '   ' })).toEqual([]);
  });

  it('never repeats a secret value in its messages', () => {
    const secret = 'sk_live_SUPERSECRET';
    expect(stagingConfigProblems({ ...clean, STRIPE_SECRET_KEY: secret }).join(' ')).not.toContain('SUPERSECRET');
  });
});

describe('stagingEmailFilter', () => {
  it('lets everything through on the live site', () => {
    vi.stubEnv('APP_ENV', '');
    expect(stagingEmailFilter(['a@x.com', 'b@y.com'])).toEqual({ allowed: ['a@x.com', 'b@y.com'], blocked: [] });
  });

  it('in the test copy, allows only listed addresses and domains', () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('STAGING_EMAIL_ALLOWLIST', 'owner@example.org, @tests.example.com');
    const r = stagingEmailFilter(['Owner@Example.org', 'Jane <jane@tests.example.com>', 'bride@gmail.com', 'x@evil-tests.example.com.fake']);
    expect(r.allowed).toEqual(['Owner@Example.org', 'Jane <jane@tests.example.com>']);
    expect(r.blocked).toEqual(['bride@gmail.com', 'x@evil-tests.example.com.fake']);
  });

  it('blocks everyone when the allowlist is empty', () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('STAGING_EMAIL_ALLOWLIST', '');
    expect(stagingEmailFilter(['a@x.com']).allowed).toEqual([]);
  });
});

describe('stagingBlocksHost', () => {
  it('blocks texting, payments, push, Slack and the live site', () => {
    for (const h of [
      'services.leadconnectorhq.com', 'rest.gohighlevel.com', 'app.lunarpay.com', 'fcm.googleapis.com',
      'api.push.apple.com', 'hooks.slack.com', 'storyvenue.com', 'app.storyvenue.com', 'www.storyvenue.com',
      'storypay.io', 'APP.STORYVENUE.COM', 'storyvenue.com.',
    ]) expect(stagingBlocksHost(h), h).toBe(true);
  });

  it('allows email, Stripe test mode, AI and the test database', () => {
    for (const h of ['api.resend.com', 'api.stripe.com', 'api.openai.com', 'api.anthropic.com', 'stagingref.supabase.co', 'evilstoryvenue.com']) {
      expect(stagingBlocksHost(h), h).toBe(false);
    }
  });
});

describe('installStagingFetchGuard', () => {
  it('does nothing on the live site', () => {
    vi.stubEnv('APP_ENV', '');
    const fake = vi.fn();
    vi.stubGlobal('fetch', fake);
    installStagingFetchGuard();
    expect(globalThis.fetch).toBe(fake);
  });

  it('in the test copy, fails requests to blocked hosts, answers texting with the stand-in, passes the rest through', async () => {
    vi.stubEnv('APP_ENV', 'staging');
    const fake = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fake);
    installStagingFetchGuard();
    const text = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', body: JSON.stringify({ contactId: 'nobody', message: 'hi' }) });
    expect(text.status).toBe(400); // the stand-in's "Contact not found"; nothing reached GHL
    await expect(fetch(new Request('https://app.storyvenue.com/api/x'))).rejects.toThrow('app.storyvenue.com');
    expect(fake).not.toHaveBeenCalled();
    const res = await fetch('https://api.resend.com/emails');
    expect(await res.text()).toBe('ok');
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('installs only once', () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubGlobal('fetch', vi.fn());
    installStagingFetchGuard();
    const first = globalThis.fetch;
    installStagingFetchGuard();
    expect(globalThis.fetch).toBe(first);
  });
});
