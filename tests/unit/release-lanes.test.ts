import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain logic module shared with the release gate scripts
import { laneFor, routeToken, sensitiveFiles, targetedFlowFiles } from '../../scripts/staging/lanes.mjs';

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
});
