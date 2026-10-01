import { createHmac, randomUUID } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { ABSOLUTE_MAX_SECONDS, IDLE_SECONDS, signSessionValue, venuePrincipalFromMeta } from '@/lib/venue-session';

// The login gate (proxy.ts) against a stand-in database: each test gets fresh
// ids because the gate caches account lookups for a minute.

const SECRET = 'session-secret-for-tests';
type Row = { session_invalidated_before?: string | null; venue_id?: string | null; status?: string | null };
let rows: Record<string, Row | null>;
let teams: Record<string, boolean>;

beforeEach(() => {
  vi.stubEnv('APP_ENV', '');
  vi.stubEnv('SESSION_SECRET', SECRET);
  vi.stubEnv('NEXTAUTH_SECRET', '');
  vi.stubEnv('ADMIN_SECRET', '');
  vi.stubEnv('LEAD_WEBHOOK_SECRET', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
  rows = {};
  teams = {};
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const u = new URL(input);
    const table = u.pathname.split('/').pop()!;
    const venueFilter = u.searchParams.get('venue_id');
    if (venueFilter) return Response.json(teams[venueFilter.replace(/^eq\./, '')] ? [{ id: 'x' }] : []);
    const row = rows[`${table}:${(u.searchParams.get('id') ?? '').replace(/^eq\./, '')}`];
    return Response.json(row ? [row] : []);
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const now = () => Math.floor(Date.now() / 1000);
const hmac = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('base64url');

function cookies(id: string, value: string, meta: string, secret = SECRET): string {
  return `${id}=${value}; ${id}_meta=${meta}; ${id}_sig=${hmac(secret, `${id}=${value}.${meta}`)}`;
}

async function gate(cookie: string) {
  const res = await proxy(new NextRequest('https://app.storyvenue.com/dashboard', { headers: { cookie } }));
  // What the app sees: "unchanged", or the cookie header the gate passed on.
  const override = res.headers.get('x-middleware-override-headers');
  const forwarded = override === null ? 'unchanged' : override.split(',').includes('cookie') ? (res.headers.get('x-middleware-request-cookie') ?? '') : '';
  return { res, forwarded };
}

function ownerSession(venueId: string, iat = now(), secret = SECRET) {
  rows[`venues:${venueId}`] = { session_invalidated_before: null };
  return cookies('venue_id', venueId, `${iat}.${IDLE_SECONDS}.${ABSOLUTE_MAX_SECONDS}.o`, secret);
}

describe('signing and checking agree', () => {
  it('the gate accepts exactly what the sign-in code signs', () => {
    const meta = `${now()}.${IDLE_SECONDS}.${ABSOLUTE_MAX_SECONDS}.o`;
    expect(signSessionValue('venue_id', 'abc', meta)).toBe(hmac(SECRET, `venue_id=abc.${meta}`));
  });

  it('reads who signed in from the session', () => {
    expect(venuePrincipalFromMeta('1.2.3.o')).toEqual({ kind: 'owner' });
    expect(venuePrincipalFromMeta('1.2.3.m-abc')).toEqual({ kind: 'member', memberId: 'abc' });
    expect(venuePrincipalFromMeta('1.2.3')).toEqual({ kind: 'legacy' });
    expect(venuePrincipalFromMeta('1.2.3.m-')).toEqual({ kind: 'legacy' });
    expect(venuePrincipalFromMeta(null)).toEqual({ kind: 'legacy' });
  });
});

describe('the login gate', () => {
  it('lets a valid owner session through and refreshes it', async () => {
    const v = randomUUID();
    const { res, forwarded } = await gate(ownerSession(v));
    expect(forwarded).toContain(`venue_id=${v}`);
    expect(res.headers.get('set-cookie')).toContain(`venue_id=${v}`);
  });

  it('passes visitors without a session untouched', async () => {
    expect((await gate('theme=dark')).forwarded).toBe('unchanged');
  });

  it('drops a session whose venue id was swapped', async () => {
    const real = randomUUID();
    const other = randomUUID();
    rows[`venues:${other}`] = {};
    const forged = ownerSession(real).replace(`venue_id=${real};`, `venue_id=${other};`);
    expect((await gate(forged)).forwarded).not.toContain('venue_id=');
  });

  it('drops a session signed with the wrong secret', async () => {
    expect((await gate(ownerSession(randomUUID(), now(), 'not-the-secret'))).forwarded).not.toContain('venue_id=');
  });

  it('drops a session past its 7-day cap', async () => {
    expect((await gate(ownerSession(randomUUID(), now() - ABSOLUTE_MAX_SECONDS - 60))).forwarded).not.toContain('venue_id=');
  });

  it('drops a session signed out from the server, and one for a deleted account', async () => {
    const v = randomUUID();
    const iat = now() - 600;
    const c = ownerSession(v, iat);
    rows[`venues:${v}`] = { session_invalidated_before: new Date((iat + 60) * 1000).toISOString() };
    expect((await gate(c)).forwarded).not.toContain('venue_id=');
    const gone = randomUUID();
    const c2 = ownerSession(gone);
    rows[`venues:${gone}`] = null;
    expect((await gate(c2)).forwarded).not.toContain('venue_id=');
  });

  it('ends a team member’s session once they are removed', async () => {
    const v = randomUUID();
    const active = randomUUID();
    const removed = randomUUID();
    rows[`venues:${v}`] = {};
    rows[`venue_team_members:${active}`] = { venue_id: v, status: 'active' };
    rows[`venue_team_members:${removed}`] = { venue_id: v, status: 'removed' };
    const memberCookies = (m: string) => [
      cookies('venue_id', v, `${now()}.${IDLE_SECONDS}.${ABSOLUTE_MAX_SECONDS}.m-${m}`),
      cookies('member_id', m, `${now()}.${IDLE_SECONDS}.${ABSOLUTE_MAX_SECONDS}`),
    ].join('; ');
    expect((await gate(memberCookies(active))).forwarded).toContain(`venue_id=${v}`);
    const out = (await gate(memberCookies(removed))).forwarded;
    expect(out).not.toContain('venue_id=');
    expect(out).not.toContain('member_id=');
  });

  it('accepts the old shared secret until Oct 8, 2026 12:00 UTC, then not', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'old-shared-secret');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T11:59:00Z'));
    expect((await gate(ownerSession(randomUUID(), now(), 'old-shared-secret'))).forwarded).toContain('venue_id=');
    vi.setSystemTime(new Date('2026-10-08T12:01:00Z'));
    expect((await gate(ownerSession(randomUUID(), now(), 'old-shared-secret'))).forwarded).not.toContain('venue_id=');
    expect((await gate(ownerSession(randomUUID()))).forwarded).toContain('venue_id=');
  });
});
