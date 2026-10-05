import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain logic module shared with the release gate scripts
import { laneFor, routeToken, sensitiveFiles, sleepsDuring, targetedFlowFiles, trailingBase } from '../../scripts/staging/lanes.mjs';

// The release gate's lanes: a commit that ships nothing runs the smoke lane;
// anything shipped runs the full suite, with the changed area's flow tests
// first. These rules decide what guards a release, so they're held still here.
describe('release lanes', () => {
  it('only a change that ships nothing earns the smoke lane', () => {
    expect(laneFor(['scripts/shots/capture.mjs', 'tests/unit/shots.test.ts', 'docs/NOTES.md', 'README.md', '.gitignore'])).toBe('smoke');
    expect(laneFor(['scripts/staging/check-deploy.mjs'])).toBe('smoke');
    for (const shipped of ['src/lib/email.ts', 'migrations/277_x.sql', 'package-lock.json', 'public/sw.js', 'next.config.ts', 'homepage/src/app/page.tsx']) {
      expect(laneFor(['scripts/shots/capture.mjs', shipped]), shipped).toBe('full');
    }
  });

  it('an unknown or empty diff runs the full suite', () => {
    expect(laneFor(null)).toBe('full');
    expect(laneFor([])).toBe('full');
  });

  it('a changed screen is matched by the address it answers on', () => {
    expect(routeToken('src/app/api/admin/couples/[id]/impersonate/route.ts')).toBe('/api/admin/couples');
    expect(routeToken('src/app/couple/signin-link/page.tsx')).toBe('/couple/signin-link');
    expect(routeToken('src/app/(public)/login/page.tsx')).toBe('/login');
    expect(routeToken('src/app/page.tsx')).toBeNull(); // the root would match everything
    expect(routeToken('src/lib/email.ts')).toBeNull();
  });

  it('the sensitive areas refuse a hot release; front-facing work does not', () => {
    // Money, messages to real people, sign-in, the database: full gate always.
    for (const f of [
      'migrations/277_anything.sql', 'package-lock.json',
      'src/lib/stripe/installments-cron.ts', 'src/lib/payment-plan.ts', 'src/app/api/proposals/public/[token]/pay/route.ts',
      'src/app/api/webhooks/stripe/route.ts', 'src/lib/service-fee.ts',
      'src/lib/ghl.ts', 'src/lib/ai-concierge/send-cron.ts', 'src/lib/marketing-email-worker.ts', 'src/lib/sms-consent.ts',
      'src/proxy.ts', 'src/lib/session.ts', 'src/app/api/auth/sign-in/route.ts', 'src/app/api/admin/login/route.ts',
    ]) {
      expect(sensitiveFiles([f]), f).toEqual([f]);
    }
    // The work hot mode exists for ships hot.
    for (const f of [
      'src/app/page.tsx', 'src/app/venue/[slug]/page.tsx', 'src/app/dashboard/leads/page.tsx',
      'src/components/Sidebar.tsx', 'src/app/couple/signin-link/page.tsx', 'src/lib/venue-seo.ts', 'public/storyvenue-logo.png',
    ]) {
      expect(sensitiveFiles([f]), f).toEqual([]);
    }
    // One sensitive file makes the whole release sensitive.
    expect(sensitiveFiles(['src/app/page.tsx', 'migrations/277_x.sql'])).toEqual(['migrations/277_x.sql']);
  });

  it('the changed area pulls in the flow tests that call it, plus changed test files', () => {
    const flowTests = [
      { name: 'admin-console.test.ts', source: 'team.fetch(`/api/admin/couples/${id}/impersonate`)' },
      { name: 'leads.test.ts', source: 'fetch(`${env.base}/api/leads`)' },
    ];
    expect(targetedFlowFiles(['src/app/api/admin/couples/[id]/impersonate/route.ts'], flowTests)).toEqual(['admin-console.test.ts']);
    expect(targetedFlowFiles(['tests/flows/leads.test.ts'], flowTests)).toEqual(['leads.test.ts']);
    expect(targetedFlowFiles(['src/lib/email.ts'], flowTests)).toEqual([]);
    // The shared test kit affects every flow: nothing to single out.
    expect(targetedFlowFiles(['tests/flows/helpers.ts', 'tests/flows/leads.test.ts'], flowTests)).toEqual([]);
  });

  // Fix-forward: the fix goes live over the red release. Its own check has to
  // cover that release too, or a fix that only touches a test would close the
  // red with a smoke run (Oct 4 2026: exactly that case).
  it('a fix over a red release is checked for everything since the last version that passed', () => {
    type Hot = { prevSha: string; trailing?: string };
    const hot: Record<string, Hot> = {
      b: { prevSha: 'a', trailing: 'pass' },
      c: { prevSha: 'b', trailing: 'fail' },
      d: { prevSha: 'c', trailing: 'interrupted' },
      e: { prevSha: 'd' }, // its check never ran
    };
    const record = (sha: string) => hot[sha] ?? null;
    // Over a clean release (hot and passed, or through the full gate): just the usual.
    expect(trailingBase('b', record)).toEqual({ base: 'b', superseded: [] });
    expect(trailingBase('a', record)).toEqual({ base: 'a', superseded: [] });
    // Over a red one: back to the last clean version.
    expect(trailingBase('c', record)).toEqual({ base: 'b', superseded: ['c'] });
    // Over a chain of them (failed, slept through, never checked): all the way back.
    expect(trailingBase('e', record)).toEqual({ base: 'b', superseded: ['e', 'd', 'c'] });
    // A loop in the records can't hang the check.
    const loop = (sha: string) => ({ prevSha: sha === 'x' ? 'y' : 'x', trailing: 'fail' });
    expect(trailingBase('x', loop).superseded).toHaveLength(50);
  });

  // Oct 4 2026: the laptop lid was closed four minutes into a trailing check.
  // Twelve tests "failed" on timeouts and dropped connections, none of it the
  // code. A run that slept is recorded as interrupted and run again.
  it('a run this computer slept through is noticed, from the Mac power log', () => {
    const log = [
      "2026-10-04 17:20:01 -0400 Sleep               \tEntering Sleep state due to 'Maintenance Sleep':TCPKeepAlive=active Using Batt (Charge:63%) 2 secs",
      '2026-10-04 17:24:00 -0400 Assertions          \tPID 501(caffeinate) Created PreventUserIdleSystemSleep "caffeinate command-line tool"',
      "2026-10-04 17:28:09 -0400 Sleep               \tEntering Sleep state due to 'Clamshell Sleep':TCPKeepAlive=active Using Batt (Charge:63%) 13 secs",
      '2026-10-04 17:28:22 -0400 DarkWake            \tDarkWake from Deep Idle [CDNP] : due to smc.sysState.Wake(0x70070000) wifibt Using BATT (Charge:63%) 121 secs',
      "2026-10-04 17:30:23 -0400 Sleep               \tEntering Sleep state due to 'Maintenance Sleep':TCPKeepAlive=active Using Batt (Charge:63%) 462 secs",
      '2026-10-04 19:01:01 -0400 Wake                \tWake from Deep Idle [CDNVA] : due to smc.sysState.Wake(0x70070000) lid HID Activity Using BATT (Charge:63%)',
      "2026-10-04 19:11:03 -0400 Sleep               \tEntering Sleep state due to 'Clamshell Sleep':TCPKeepAlive=active Using Batt (Charge:60%) 3 secs",
    ].join('\n');
    const at = (t: string) => Date.parse(`2026-10-04T${t}-04:00`);
    // The run: 17:24 to 19:10. Two sleeps inside it; the ones before and after don't count.
    expect(sleepsDuring(log, at('17:24:00'), at('19:10:49'))).toBe(2);
    // The log's own time zone is read, so the same moments in UTC give the same answer.
    expect(sleepsDuring(log, Date.parse('2026-10-04T21:24:00Z'), Date.parse('2026-10-04T23:10:49Z'))).toBe(2);
    // An awake run, and a computer with no such log, read as no sleep.
    expect(sleepsDuring(log, at('18:00:00'), at('19:00:00'))).toBe(0);
    for (const nothing of ['', null, undefined, 'pmset: command not found']) expect(sleepsDuring(nothing, 0, Date.now())).toBe(0);
  });
});
