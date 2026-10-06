import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { issuedAt, SESSION_ENDED_COOKIE, sessionIsOver, sessionsEndedAt, sessionsEndedValue } from '@/lib/session-ended';

// Logout that sticks. Found Oct 5 2026: the proxy renews a session's cookies
// on every signed-in answer, and an answer still on its way when Logout was
// pressed arrived after it and put them back. On the test copy the browser
// was still signed in 3 times out of 3 when Logout was pressed within a second
// of a page opening, and 8 out of 8 while the server was busy. Ending a
// session (and starting one) now leaves a marker, "sessions before now are
// over", and the proxy holds every session against it.

const NOW = 1_800_000_000;
const marker = (at: number, readAt = at + 1) => sessionsEndedAt(sessionsEndedValue(at), readAt);

describe('"sessions before now are over"', () => {
  it('a session from before the logout is over, however its cookies got back', () => {
    const ended = marker(NOW);
    expect(sessionIsOver(NOW - 3600, ended)).toBe(true);
    expect(sessionIsOver(NOW - 10, ended)).toBe(true);
    // A renewed session keeps its issue time, so months later it is still over.
    expect(sessionIsOver(NOW - 10, sessionsEndedAt(sessionsEndedValue(NOW), NOW + 80 * 86_400))).toBe(true);
  });

  it('a sign-in after it is fine: at once, in the same second, or on a server whose clock is a second behind', () => {
    const ended = marker(NOW);
    expect(sessionIsOver(NOW + 30, ended)).toBe(false);
    expect(sessionIsOver(NOW, ended)).toBe(false);
    expect(sessionIsOver(NOW - 1, ended)).toBe(false);
    expect(sessionIsOver(NOW - 2, ended)).toBe(false);
    expect(sessionIsOver(NOW - 3, ended)).toBe(true);
  });

  // Found by running the fix: with only the two seconds' slack, a session
  // issued a moment before Logout was spared. Logging out knows which
  // sessions it is ending, so they are over whatever their age.
  it('the session being logged out of is over even if it is a moment old; a sign-in right after still works', () => {
    const justIssued = NOW;
    const ended = sessionsEndedAt(sessionsEndedValue(NOW, [justIssued, null]), NOW);
    expect(ended).toBe(NOW + 1);
    expect(sessionIsOver(justIssued, ended)).toBe(true);
    // The new sign-in writes its own marker in the same answer (below), so it is never held to this one.
    // Older sessions being ended change nothing: the slack already covers them.
    expect(sessionsEndedValue(NOW, [NOW - 500, NOW - 9000])).toBe(String(NOW - 2));
    // An issue time far in the future is not built on.
    expect(Number(sessionsEndedValue(NOW, [NOW + 86_400]))).toBeLessThanOrEqual(NOW + 60);
  });

  it('a session’s issue time is read from its meta cookie, or not at all', () => {
    expect(issuedAt(`${NOW}.28800.604800.o`)).toBe(NOW);
    expect(issuedAt(`${NOW}.28800`)).toBe(NOW);
    for (const junk of [undefined, null, '', 'abc.1.2', '-4.1.2', '0.1.2', '3e2.1.2x']) expect(issuedAt(junk), String(junk)).toBeNull();
  });

  it('no marker, junk, or a time this app could not have written: nothing is refused', () => {
    for (const value of [undefined, null, '', 'abc', '-5', '1.5', '0', '12e3', ' 1800000000', String(NOW + 3600), '9'.repeat(13)]) {
      const ended = sessionsEndedAt(value as string | null | undefined, NOW);
      expect(ended, String(value)).toBe(0);
      expect(sessionIsOver(NOW - 99_999, ended), String(value)).toBe(false);
    }
    // A marker a few seconds ahead (another server's clock) still counts.
    expect(sessionsEndedAt(String(NOW + 5), NOW)).toBe(NOW + 5);
  });

  it('the oldest cookie format has no issue time: over once this browser has signed out, fine before', () => {
    expect(sessionIsOver(null, marker(NOW))).toBe(true);
    expect(sessionIsOver(null, 0)).toBe(false);
    expect(sessionIsOver(Number.NaN, marker(NOW))).toBe(true);
  });
});

describe('where the marker is written and read', () => {
  const root = join(__dirname, '..', '..');
  const read = (file: string) => readFileSync(join(root, file), 'utf8');

  type Set = { name: string; value: string; maxAge?: number; httpOnly?: boolean };
  const fakeResponse = () => {
    const sets: Set[] = [];
    return { sets, res: { cookies: { set: (name: string, value: string, o: { maxAge?: number; httpOnly?: boolean } = {}) => { sets.push({ name, value, ...o }); } } } };
  };

  it('ending the venue sessions clears both, with their companions, and leaves the marker past the sessions it ended', async () => {
    process.env.SESSION_SECRET ||= 'unit-test-secret';
    const { endVenueSessions } = await import('@/lib/venue-session');
    const { sets, res } = fakeResponse();
    const now = Math.floor(Date.now() / 1000);
    const held = new Map([['venue_id_meta', { value: `${now}.28800.604800.m-7` }], ['member_id_meta', { value: `${now - 1}.28800.604800` }]]);
    endVenueSessions(res as never, held);
    expect(sessionIsOver(now, sessionsEndedAt(sets.find((s) => s.name === SESSION_ENDED_COOKIE)!.value, now))).toBe(true);
    for (const name of ['venue_id', 'venue_id_meta', 'venue_id_sig', 'member_id', 'member_id_meta', 'member_id_sig']) {
      expect(sets.find((s) => s.name === name), name).toMatchObject({ value: '', maxAge: 0 });
    }
    const left = sets.find((s) => s.name === SESSION_ENDED_COOKIE)!;
    expect(left).toMatchObject({ httpOnly: true, maxAge: 60 * 60 * 24 * 90 });
    expect(sessionsEndedAt(left.value, Math.floor(Date.now() / 1000))).toBeGreaterThan(0);
  });

  it('starting a session leaves it too, and the session it starts is never older than it', async () => {
    process.env.SESSION_SECRET ||= 'unit-test-secret';
    const { setSignedCookie } = await import('@/lib/venue-session');
    const { sets, res } = fakeResponse();
    setSignedCookie(res as never, 'venue_id', 'venue-1', { path: '/' }, { principal: 'owner' });
    const iat = Number(sets.find((s) => s.name === 'venue_id_meta')!.value.split('.')[0]);
    const ended = sessionsEndedAt(sets.find((s) => s.name === SESSION_ENDED_COOKIE)!.value, iat);
    expect(ended).toBeGreaterThan(0);
    expect(sessionIsOver(iat, ended)).toBe(false);
    // …while whatever this browser was signed in to a minute earlier is.
    expect(sessionIsOver(iat - 60, ended)).toBe(true);
  });

  it('the proxy holds every session against it, in both cookie formats, before it renews anything', () => {
    const proxy = read('src/proxy.ts');
    expect(proxy).toMatch(/const endedAt = sessionsEndedAt\(request\.cookies\.get\(SESSION_ENDED_COOKIE\)\?\.value, nowSecs\);/);
    expect(proxy).toMatch(/if \(sessionIsOver\(iat, endedAt\)\) \{\s*strip\(\);/);
    expect(proxy).toMatch(/if \(sessionIsOver\(null, endedAt\)\) \{\s*strip\(\);/);
    // Both checks come before the session is queued for renewal.
    expect(proxy.indexOf('sessionIsOver(iat, endedAt)')).toBeLessThan(proxy.indexOf('reissue.push({ id, value, iat, idle, absCap, principal })'));
    expect(proxy.indexOf('sessionIsOver(null, endedAt)')).toBeLessThan(proxy.indexOf('reissue.push({ id, value, iat: nowSecs'));
  });

  it('nothing ends a venue session by clearing its cookie alone', () => {
    expect(read('src/app/api/auth/logout/route.ts')).toMatch(/endVenueSessions\(res, await cookies\(\)\);/);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.tsx?$/.test(entry)) continue;
        const text = readFileSync(path, 'utf8');
        if (/\.delete\(\s*['"]venue_id['"]\s*\)|clearSignedCookie\(\s*\w+,\s*['"]venue_id['"]/.test(text)) offenders.push(path.slice(root.length + 1));
      }
    };
    walk(join(root, 'src'));
    expect(offenders).toEqual(['src/lib/venue-session.ts']);
  });
});
