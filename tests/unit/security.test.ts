import { afterEach, describe, expect, it, vi } from 'vitest';
import { csvEscape, csvRow, neutralizeFormula, parseCsv } from '@/lib/csv';
import { getClientIp, isCloudflareIp, peekRateLimit, rateLimit, rateLimitAny } from '@/lib/rate-limit';
import { isPrivateAddress } from '@/lib/safe-outbound-fetch';
import { signGuideInviteToken, verifyGuideInviteToken } from '@/lib/guide-invite-token';
import { topicAllowed } from '@/lib/realtime/topic';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('spreadsheet exports', () => {
  it('turns anything a spreadsheet would run as a formula into text', () => {
    for (const s of ['=HYPERLINK("http://x")', '+1+1', '@SUM(A1)', '\tx', '\rx', '-2+3', '-x']) expect(neutralizeFormula(s), s).toBe(`'${s}`);
  });

  it('leaves ordinary text and negative numbers alone', () => {
    for (const s of ['Jane Smith', '-42', '-3.5', '2026-10-01', 'a=b', '']) expect(neutralizeFormula(s), s).toBe(s);
  });

  it('quotes commas, quotes and line breaks, and round-trips', () => {
    expect(csvEscape('Smith, Jane')).toBe('"Smith, Jane"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvRow(['=cmd', 'a,b', 'ok'])).toBe(`'=cmd,"a,b",ok`);
    expect(parseCsv('name,notes\n"Smith, Jane","said ""hi"""\n\nBob,x')).toEqual([['name', 'notes'], ['Smith, Jane', 'said "hi"'], ['Bob', 'x']]);
  });
});

describe('visitor IP (rate limits)', () => {
  const req = (h: Record<string, string>) => new Request('https://app.storyvenue.com/x', { headers: h });

  it('knows Cloudflare’s edge servers', () => {
    expect(isCloudflareIp('104.16.1.1')).toBe(true);
    expect(isCloudflareIp('172.71.255.1')).toBe(true);
    expect(isCloudflareIp('2606:4700::1')).toBe(true);
    expect(isCloudflareIp('8.8.8.8')).toBe(false);
    expect(isCloudflareIp('2001:4860::8888')).toBe(false);
    expect(isCloudflareIp('not-an-ip')).toBe(false);
  });

  it('trusts CF-Connecting-IP only when the request came through Cloudflare', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '104.16.1.1', 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '1.2.3.4' }))).toBe('198.51.100.7');
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }))).toBe('198.51.100.7');
    expect(getClientIp(req({ 'x-real-ip': '198.51.100.8' }))).toBe('198.51.100.8');
    expect(getClientIp(req({}))).toBe('unknown');
  });

  it('allows the limit, then refuses with a retry time, then recovers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 60_000 });
    vi.advanceTimersByTime(60_001);
    expect(rateLimit(key, 3, 60_000).allowed).toBe(true);
  });

  it('peeks without counting, and checks every bucket together', () => {
    const ip = `ip:${Math.random()}`;
    const email = `email:${Math.random()}`;
    expect(peekRateLimit(ip, 1, 60_000).allowed).toBe(true);
    expect(peekRateLimit(ip, 1, 60_000).allowed).toBe(true);
    expect(rateLimitAny([{ key: ip, limit: 1, windowMs: 60_000 }, { key: email, limit: 5, windowMs: 60_000 }]).allowed).toBe(true);
    expect(rateLimitAny([{ key: ip, limit: 1, windowMs: 60_000 }, { key: email, limit: 5, windowMs: 60_000 }]).allowed).toBe(false);
  });
});

describe('link previews only reach public addresses', () => {
  it('blocks private, local and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'garbage']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '104.16.1.1', '172.32.0.1', '2606:4700::1', '::ffff:8.8.8.8']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe('"Send me my guide" links', () => {
  const lead = '11111111-2222-4333-8444-555555555555';
  const venue = '66666666-7777-4888-9999-000000000000';

  it('verify for the lead and venue they were made for', () => {
    vi.stubEnv('MARKETING_EMAIL_TOKEN_SECRET', 'test-secret');
    const token = signGuideInviteToken(lead, venue)!;
    expect(verifyGuideInviteToken(token)).toEqual({ leadId: lead, venueId: venue });
  });

  it('expire after 90 days', () => {
    vi.stubEnv('MARKETING_EMAIL_TOKEN_SECRET', 'test-secret');
    const issued = new Date('2026-01-01T00:00:00Z');
    const token = signGuideInviteToken(lead, venue, issued)!;
    expect(verifyGuideInviteToken(token, new Date('2026-03-31T00:00:00Z'))).not.toBeNull();
    expect(verifyGuideInviteToken(token, new Date('2026-04-02T00:00:00Z'))).toBeNull();
  });

  it('reject tampering, another secret, and missing secrets', () => {
    vi.stubEnv('MARKETING_EMAIL_TOKEN_SECRET', 'test-secret');
    const token = signGuideInviteToken(lead, venue)!;
    const [p, payload, sig] = token.split('.');
    const forged = Buffer.from(Buffer.from(payload, 'base64url').toString().replace(lead, '99999999-2222-4333-8444-555555555555')).toString('base64url');
    expect(verifyGuideInviteToken(`${p}.${forged}.${sig}`)).toBeNull();
    expect(verifyGuideInviteToken(token.slice(0, -2))).toBeNull();
    expect(verifyGuideInviteToken('gi1.x')).toBeNull();
    vi.stubEnv('MARKETING_EMAIL_TOKEN_SECRET', 'other-secret');
    expect(verifyGuideInviteToken(token)).toBeNull();
    vi.stubEnv('MARKETING_EMAIL_TOKEN_SECRET', '');
    vi.stubEnv('MARKETING_CRON_SECRET', '');
    vi.stubEnv('CRON_SECRET', '');
    expect(signGuideInviteToken(lead, venue)).toBeNull();
    expect(verifyGuideInviteToken(token)).toBeNull();
  });

  it('are only made for real ids', () => {
    vi.stubEnv('MARKETING_EMAIL_TOKEN_SECRET', 'test-secret');
    expect(signGuideInviteToken('not-a-uuid', venue)).toBeNull();
  });
});

describe('live-update channels', () => {
  const venue = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('a venue may listen only to its own channels', () => {
    const caller = { admin: false, venueId: venue };
    for (const ch of [`venue:${venue}:leads`, `venue:${venue}:conversations`, `venue:${venue}:thread:abc-123`]) expect(topicAllowed(ch, caller), ch).toBe(true);
    for (const ch of [`venue:other-venue:leads`, `venue:${venue}:secrets`, 'support:bride-inbox', 'admin:error-feed', `venue:${venue}:thread:a/b`]) expect(topicAllowed(ch, caller), ch).toBe(false);
  });

  it('admins may listen to support channels and any venue', () => {
    const admin = { admin: true, venueId: null };
    for (const ch of ['support:bride-inbox', 'admin:error-feed', `venue:${venue}:leads`, 'presence:thread:t-1']) expect(topicAllowed(ch, admin), ch).toBe(true);
    expect(topicAllowed('support:everything', admin)).toBe(false);
  });

  it('nobody without a session, and no oversized names', () => {
    expect(topicAllowed(`venue:${venue}:leads`, { admin: false, venueId: null })).toBe(false);
    expect(topicAllowed('x'.repeat(201), { admin: true, venueId: null })).toBe(false);
  });
});
