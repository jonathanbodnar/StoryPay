import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { safeNextPath, sameSecret, stagingAccessToken, stagingOpenPath, STAGING_ACCESS_COOKIE } from '@/lib/staging-access';
import robots from '@/app/robots';

afterEach(() => vi.unstubAllEnvs());

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, 'https://staging.example.test'), { headers });

describe('staging access helpers', () => {
  it('opens only webhooks, timers, the password page and static files', () => {
    for (const p of ['/staging-access', '/api/webhooks/stripe', '/api/cron/installments', '/logo.png', '/robots.txt']) {
      expect(stagingOpenPath(p), p).toBe(true);
    }
    for (const p of ['/', '/dashboard', '/api/leads', '/api/public/leads', '/admin', '/proposal/abc']) {
      expect(stagingOpenPath(p), p).toBe(false);
    }
  });

  it('only redirects to same-site paths after signing in', () => {
    expect(safeNextPath('/dashboard?tab=1')).toBe('/dashboard?tab=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '', null, undefined]) expect(safeNextPath(bad)).toBe('/');
  });

  it('derives a stable cookie from the password', async () => {
    const a = await stagingAccessToken('pw-1');
    expect(a).toBe(await stagingAccessToken('pw-1'));
    expect(a).not.toBe(await stagingAccessToken('pw-2'));
    expect(a).not.toContain('pw-1');
    expect(sameSecret(a, a)).toBe(true);
    expect(sameSecret(a, a.slice(1))).toBe(false);
  });
});

describe('proxy in the test copy', () => {
  const stage = () => {
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('STAGING_PASSWORD', 'correct horse');
    // No session secrets: the session check passes requests through untouched.
    for (const k of ['SESSION_SECRET', 'NEXTAUTH_SECRET', 'ADMIN_SECRET', 'LEAD_WEBHOOK_SECRET']) vi.stubEnv(k, '');
  };

  it('sends pages to the password page', async () => {
    stage();
    const res = await proxy(req('/dashboard?x=1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://staging.example.test/staging-access?next=%2Fdashboard%3Fx%3D1');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('refuses API calls without the password', async () => {
    stage();
    const res = await proxy(req('/api/public/leads'));
    expect(res.status).toBe(401);
  });

  it('lets webhooks through, marked noindex', async () => {
    stage();
    const res = await proxy(req('/api/webhooks/stripe'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('lets in the access cookie and the x-staging-key header, but not a wrong one', async () => {
    stage();
    const cookie = `${STAGING_ACCESS_COOKIE}=${await stagingAccessToken('correct horse')}`;
    expect((await proxy(req('/dashboard', { cookie }))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(req('/api/leads', { 'x-staging-key': 'correct horse' }))).headers.get('x-middleware-next')).toBe('1');
    expect((await proxy(req('/api/leads', { 'x-staging-key': 'wrong' }))).status).toBe(401);
    expect((await proxy(req('/dashboard', { cookie: `${STAGING_ACCESS_COOKIE}=forged` }))).status).toBe(307);
  });

  it('stays locked when no password is set up', async () => {
    stage();
    vi.stubEnv('STAGING_PASSWORD', '');
    expect((await proxy(req('/api/leads', { 'x-staging-key': '' }))).status).toBe(401);
  });

  it('changes nothing on the live site', async () => {
    vi.stubEnv('APP_ENV', '');
    for (const k of ['SESSION_SECRET', 'NEXTAUTH_SECRET', 'ADMIN_SECRET', 'LEAD_WEBHOOK_SECRET']) vi.stubEnv(k, '');
    const res = await proxy(req('/dashboard'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('x-robots-tag')).toBeNull();
  });
});

describe('robots.txt', () => {
  it('blocks everything in the test copy only', () => {
    vi.stubEnv('APP_ENV', 'staging');
    expect(robots().rules).toEqual([{ userAgent: '*', disallow: '/' }]);
    vi.stubEnv('APP_ENV', '');
    expect(JSON.stringify(robots().rules)).toContain('/dashboard');
  });
});
