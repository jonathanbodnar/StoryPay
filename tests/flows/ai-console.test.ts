import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, FLOW_VENUE, runId, signedInSuperAdmin, submitListingLead } from './helpers';

// The AI Concierge console: the prompt editor's versions (new versions are
// append-only; exactly one is active), the preview, the handoff rules that
// stop the AI when a couple says stop, and the runtime settings. Everything
// is put back exactly as found, so the AI other tests exercise is unchanged.
describe('the AI Concierge console', () => {
  let team: Browser;

  beforeAll(async () => {
    team = await signedInSuperAdmin();
  });

  it('a new prompt version is drafted, used, and everything is left as found', async () => {
    const versions = async () => {
      const res = await team.fetch('/api/admin/ai-concierge/configs');
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as { rows?: Array<{ id: string; is_active: boolean; notes?: string | null }> } | Array<{ id: string; is_active: boolean; notes?: string | null }>;
      return Array.isArray(body) ? body : body.rows ?? [];
    };
    const active0 = (await versions()).filter((c) => c.is_active).map((c) => c.id);

    const made = await team.fetch('/api/admin/ai-concierge/configs', {
      method: 'POST',
      json: active0.length
        ? { cloneFromVersionId: active0[0], notes: `Test draft ${runId}` }
        : { notes: `Test draft ${runId}`, personality: 'Warm and brief.', system_prompt_template: 'You help couples who wrote to {{venue_name}}.' },
    });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const mine = (await versions()).find((c) => c.notes === `Test draft ${runId}`)!;
    expect(mine).toBeTruthy();
    expect(mine.is_active).toBe(false); // drafting never changes what the AI sends

    if (active0.length === 1) {
      // Promote the draft, then roll back to exactly what was live before.
      try {
        const on = await team.fetch(`/api/admin/ai-concierge/configs/${mine.id}/activate`, { method: 'POST' });
        expect(on.status, await on.clone().text()).toBeLessThan(300);
        expect((await versions()).filter((c) => c.is_active).map((c) => c.id)).toEqual([mine.id]);
      } finally {
        await team.fetch(`/api/admin/ai-concierge/configs/${active0[0]}/activate`, { method: 'POST' });
        await team.fetch(`/api/admin/ai-concierge/configs/${mine.id}`, { method: 'DELETE' });
      }
    } else {
      // Nothing is active here (the AI runs on its built-in prompt): the
      // draft must preview without being activated, then it goes.
      const preview = await team.fetch('/api/admin/ai-concierge/configs/preview', {
        method: 'POST', json: { venueId: FLOW_VENUE.id, leadId: await previewLeadId(), configVersionId: mine.id },
      });
      expect(preview.status, await preview.clone().text()).toBe(200);
      await team.fetch(`/api/admin/ai-concierge/configs/${mine.id}`, { method: 'DELETE' });
    }
    expect((await versions()).filter((c) => c.is_active).map((c) => c.id)).toEqual(active0);
    expect((await versions()).some((c) => c.notes === `Test draft ${runId}`)).toBe(false);
  });

  let leadId = '';
  async function previewLeadId(): Promise<string> {
    if (leadId) return leadId;
    const n = (parseInt(runId.slice(-5), 36) % 9000) + 1000;
    const res = await submitListingLead({
      venue_id: FLOW_VENUE.id, first_name: 'Prue', last_name: 'Preview', email: `preview.${runId}@example.com`,
      phone: `(332) 583-${n}`, source: 'directory', client_ip: '198.51.100.99',
    });
    expect(res.status).toBe(201);
    leadId = ((await res.json()) as { lead_id: string }).lead_id;
    return leadId;
  }

  it('the preview builds the real prompt for a lead without texting anyone', async () => {
    const preview = await team.fetch('/api/admin/ai-concierge/configs/preview', { method: 'POST', json: { venueId: FLOW_VENUE.id, leadId: await previewLeadId() } });
    expect(preview.status, await preview.clone().text()).toBe(200);
    const body = JSON.stringify(await preview.json());
    expect(body).toContain(FLOW_VENUE.name);
  });

  it('a handoff rule catches its phrase while on, not after it is switched off', async () => {
    const phrase = `redword${runId}`;
    const made = await team.fetch('/api/admin/ai-concierge/handoff-rules', {
      method: 'POST', json: { rule_type: 'keyword', trigger_value: phrase, action: 'stop_and_handoff', description: `Test rule ${runId}` },
    });
    expect(made.status, await made.clone().text()).toBeLessThan(300);
    const { data: rule } = await db.from('handoff_rules').select('id').eq('trigger_value', phrase).single();
    const matches = async () => {
      const res = await team.fetch('/api/admin/ai-concierge/handoff-rules/test', { method: 'POST', json: { body: `Please ${phrase}, we picked another venue.` } });
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as { matched: boolean };
    };
    try {
      expect((await matches()).matched).toBe(true);
      expect((await team.fetch(`/api/admin/ai-concierge/handoff-rules/${rule!.id}`, { method: 'PATCH', json: { is_active: false } })).status).toBeLessThan(300);
      expect((await matches()).matched).toBe(false);
    } finally {
      await team.fetch(`/api/admin/ai-concierge/handoff-rules/${rule!.id}`, { method: 'DELETE' });
    }
    expect((await db.from('handoff_rules').select('id').eq('id', rule!.id).maybeSingle()).data).toBeNull();
  });

  it('the runtime settings read and save', async () => {
    const res = await team.fetch('/api/admin/ai-concierge/runtime-settings');
    expect(res.status).toBe(200);
    const settings = (await res.json()) as { defaultDailySendCap?: number; default_daily_send_cap?: number };
    const cap = settings.defaultDailySendCap ?? settings.default_daily_send_cap;
    const saved = await team.fetch('/api/admin/ai-concierge/runtime-settings', { method: 'PATCH', json: { default_daily_send_cap: cap } });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const again = (await (await team.fetch('/api/admin/ai-concierge/runtime-settings')).json()) as typeof settings;
    expect(again.defaultDailySendCap ?? again.default_daily_send_cap).toBe(cap);
  });
});
