import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_WRITE_TABS, adminRequestAllowed } from '@/lib/admin-route-tabs';
import { ADMIN_TAB_KEY_SET } from '@/lib/admin-tabs-registry';

// A StoryVenue team member who isn't a full admin reads the admin API as
// before, but changes only what their tabs cover.
describe('what a limited team member may change in the admin', () => {
  const support = new Set(['support']);

  it('reads anywhere', () => {
    expect(adminRequestAllowed('GET /api/admin/subscriptions', support)).toBe(true);
    expect(adminRequestAllowed('GET /api/admin/venues/abc/payments', new Set())).toBe(true);
  });

  it('changes only behind their tabs', () => {
    expect(adminRequestAllowed('POST /api/admin/support/tickets/1/reply', support)).toBe(true);
    expect(adminRequestAllowed('POST /api/admin/venues/abc/billing-action', support)).toBe(false);
    expect(adminRequestAllowed('POST /api/admin/venues/abc/billing-action', new Set(['venues']))).toBe(true);
    expect(adminRequestAllowed('PATCH /api/admin/ai-concierge/kill-switch', support)).toBe(false);
    expect(adminRequestAllowed('PUT /api/admin/payment-fees', new Set(['directory-plans']))).toBe(true);
  });

  it('"View as venue" from the screens that offer it; leaving it always works', () => {
    expect(adminRequestAllowed('POST /api/admin/impersonate', support)).toBe(true);
    expect(adminRequestAllowed('POST /api/admin/impersonate', new Set(['blog']))).toBe(false);
    expect(adminRequestAllowed('POST /api/admin/impersonate/exit', new Set())).toBe(true);
  });

  it('a section not on the list, an unknown request or a lookalike path is full admins only', () => {
    expect(adminRequestAllowed('POST /api/admin/storypay-hq/onboard', new Set(ADMIN_TAB_KEY_SET))).toBe(false);
    expect(adminRequestAllowed(null, new Set(ADMIN_TAB_KEY_SET))).toBe(false);
    expect(adminRequestAllowed('POST /api/admin/supportive', support)).toBe(false);
    expect(adminRequestAllowed('POST /api/help/seed-embeddings', new Set(ADMIN_TAB_KEY_SET))).toBe(false);
  });

  it('every section on the list exists and every tab is a real tab', () => {
    for (const [prefix, tabs] of ADMIN_WRITE_TABS) {
      expect(existsSync(join(__dirname, '..', '..', 'src', 'app', 'api', 'admin', prefix)), prefix).toBe(true);
      for (const t of tabs) if (t !== '*') expect(ADMIN_TAB_KEY_SET.has(t), `${prefix}: ${t}`).toBe(true);
    }
  });
});
