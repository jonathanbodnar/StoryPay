import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, ensureFlowVenue, env, signedInOwner } from './helpers';

// Who can reach what. The demo venue ("Maple Hollow Barn (Test)") is the
// other venue: the flow venue must never see or change its records.
const DEMO_VENUE_ID = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const CRON_JOBS = [
  'ai-activate', 'ai-send', 'appointment-reminders', 'ghl-cold-sweep', 'ghl-contacts-sync', 'ghl-inbound-sync',
  'installments', 'marketing-email', 'payment-reminders', 'private-client-monthly-reminder', 'reengagement-drip',
  'send-booking-reports', 'tag-sweep', 'trial-sweep',
];
// Every job also runs: the test copy is quiet while the tests run, so jobs that
// email venue owners (the demo owner is a real inbox) keep it in the outbox.
const EMAILS_OWNERS = new Set<string>();
const secrets = [process.env.MARKETING_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean) as string[];

async function cron(job: string, secret?: string): Promise<Response> {
  return fetch(`${env.base}/api/cron/${job}`, {
    headers: { 'x-staging-key': env.stagingKey, ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
  });
}

describe('who can reach what', () => {
  let owner: Browser;
  let otherLeadId = '';

  beforeAll(async () => {
    await ensureFlowVenue();
    owner = await signedInOwner();
    const { data } = await db.from('leads').select('id').eq('venue_id', DEMO_VENUE_ID).limit(1).single();
    otherLeadId = data!.id;
  });

  it('nothing without signing in', async () => {
    const anon = new Browser();
    for (const path of ['/api/leads', '/api/proposals', `/api/leads/${otherLeadId}`]) {
      expect((await anon.fetch(path)).status, path).toBe(401);
    }
  });

  it('a venue cannot read or change another venue’s lead', async () => {
    expect([403, 404]).toContain((await owner.fetch(`/api/leads/${otherLeadId}`)).status);
    const patch = await owner.fetch(`/api/leads/${otherLeadId}`, { method: 'PATCH', json: { notes: 'not yours' } });
    expect([403, 404]).toContain(patch.status);
    const { data } = await db.from('leads').select('notes').eq('id', otherLeadId).single();
    expect(data?.notes).not.toBe('not yours');
    const list = (await (await owner.fetch('/api/leads')).json()) as unknown;
    expect(JSON.stringify(list)).not.toContain(otherLeadId);
  });

  it('admin areas need an admin', async () => {
    expect([401, 403]).toContain((await owner.fetch('/api/admin/venues')).status);
  });

  it('the AI agents’ endpoint needs its key', async () => {
    const res = await fetch(`${env.base}/api/mcp`, {
      method: 'POST',
      headers: { 'x-staging-key': env.stagingKey, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect([401, 403]).toContain(res.status);
  });
});

describe('timed jobs', () => {
  it.each(CRON_JOBS)('%s refuses a request without its secret', async (job) => {
    expect((await cron(job)).status).toBe(401);
    expect((await cron(job, 'wrong-secret')).status).toBe(401);
  });

  it.each(CRON_JOBS.filter((j) => !EMAILS_OWNERS.has(j)))('%s runs cleanly', async (job) => {
    let res = await cron(job, secrets[0]);
    if (res.status === 401 && secrets[1]) res = await cron(job, secrets[1]);
    const body = await res.text();
    expect(res.status, body.slice(0, 300)).toBe(200);
    expect(body).not.toMatch(/"ok"\s*:\s*false/);
  });
});
