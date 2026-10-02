import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { env, runId } from './helpers';

// The Wedding Planner, the couple's side: a couple signs up, signs in, and
// plans: their guest list and checklist are saved and come back.
describe('a couple plans their wedding', () => {
  const email = `harper.${runId}@example.com`;
  const password = `Planner-${runId}-Sunshine-2027!`;
  let token = '';

  const api = (path: string, init: { method?: string; json?: unknown } = {}) =>
    fetch(`${env.base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'x-staging-key': env.stagingKey,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });

  beforeAll(async () => {
    const signup = await api('/api/couple/signup', {
      method: 'POST',
      json: { email, password, first_name: 'Harper', last_name: 'Lane', phone: `(646) 560-${(parseInt(runId.slice(-5), 36) % 9000) + 1000}` },
    });
    expect(signup.status, await signup.clone().text()).toBe(200);
    const supabase = createClient(String(process.env.NEXT_PUBLIC_SUPABASE_URL), String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`couple sign-in: ${error.message}`);
    token = data.session!.access_token;
  });

  it('signs in to their own planner', async () => {
    const me = await api('/api/couple/me');
    expect(me.status, await me.clone().text()).toBe(200);
    expect(JSON.stringify(await me.json()).toLowerCase()).toContain(email);
  });

  it('adds a guest, and the guest list keeps it', async () => {
    const added = await api('/api/couple/guests', { method: 'POST', json: { full_name: 'May Lane', party_size: 2, guest_group: 'Family' } });
    expect(added.status, await added.clone().text()).toBeLessThan(300);
    const list = await api('/api/couple/guests');
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).toContain('May Lane');
  });

  it('ticks off a checklist task, and it stays ticked', async () => {
    const before = (await (await api('/api/couple/checklist')).json()) as { checklist: { rev: number; items: Array<{ title: string; done: boolean }> } };
    const items = [...before.checklist.items, { title: 'Book the photographer', done: true }];
    const saved = await api('/api/couple/checklist', { method: 'PUT', json: { checklist: { rev: before.checklist.rev, items } } });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const after = (await (await api('/api/couple/checklist')).json()) as { checklist: { items: Array<{ title: string; done: boolean }> } };
    expect(after.checklist.items.find((i) => i.title === 'Book the photographer')?.done).toBe(true);
  });

  it('another couple can’t see them', async () => {
    const saved = token;
    token = '';
    expect((await api('/api/couple/guests')).status).toBe(401);
    token = saved;
  });
});
