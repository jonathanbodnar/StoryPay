import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, ensureFlowVenue, env, FLOW_VENUE, outbox, runId, waitForEmail } from './helpers';

const STORYVENUE_LOGO = 'storyvenue-logo-dark.png';

// The venue's own website form (the form builder), filing leads into a stage.
describe('a couple fills in the venue’s website form', () => {
  const email = `rowan.${runId}@example.com`;
  const blocks = [
    { id: 'fn', type: 'first_name', label: 'First name', required: true },
    { id: 'ln', type: 'last_name', label: 'Last name', required: true },
    { id: 'em', type: 'email', label: 'Email', required: true },
    { id: 'ph', type: 'phone', label: 'Phone', required: true },
    { id: 'msg', type: 'textarea', label: 'Message' },
    { id: 'go', type: 'submit', label: 'Send' },
  ];
  let formId = '';
  let token = '';
  let stageId = '';
  let since = '';

  async function submit(message: string) {
    const fd = new FormData();
    fd.set('bf_fn', 'Rowan');
    fd.set('bf_ln', 'Reyes');
    fd.set('bf_em', email);
    fd.set('bf_ph', '(212) 555-0199');
    fd.set('bf_msg', message);
    return fetch(`${env.base}/api/public/forms/${token}/submit`, { method: 'POST', headers: { 'x-staging-key': env.stagingKey }, body: fd });
  }
  const herLeads = async () => (await db.from('leads').select('id, stage_id').eq('venue_id', FLOW_VENUE.id).eq('email', email)).data ?? [];
  const ownerSubjects = async () => (await outbox({ to: FLOW_VENUE.email, since })).map((e) => e.subject);

  beforeAll(async () => {
    await ensureFlowVenue();
    const { data: stage } = await db.from('lead_pipeline_stages').select('id').eq('venue_id', FLOW_VENUE.id).limit(1).single();
    stageId = stage!.id as string;
    const { data: f, error } = await db.from('marketing_forms').insert({
      venue_id: FLOW_VENUE.id, name: `Website form ${runId}`, published: true,
      definition_json: { version: 1, blocks, settings: { pipelineStageId: stageId } },
    }).select('id, embed_token').single();
    if (error) throw new Error(error.message);
    formId = f!.id as string;
    token = f!.embed_token as string;
    since = new Date().toISOString();
  });

  afterAll(async () => {
    if (formId) await db.from('marketing_forms').update({ published: false }).eq('id', formId);
  });

  it('the first submission makes the lead in the form’s stage, and one "New lead" email with her message', async () => {
    expect((await submit('We love your barn!')).status).toBe(200);
    const leads = await herLeads();
    expect(leads).toHaveLength(1);
    expect(leads[0].stage_id).toBe(stageId);
    const e = await waitForEmail({ to: FLOW_VENUE.email, since }, (x) => x.subject === `New lead: Rowan Reyes — ${FLOW_VENUE.name}`);
    expect(e.html).toContain('We love your barn!');
  });

  it('a double submit makes no second lead and sends the owner nothing more', async () => {
    expect((await submit('We love your barn!')).status).toBe(200);
    expect(await herLeads()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 4000));
    const subjects = await ownerSubjects();
    expect(subjects.filter((s) => s.startsWith('New lead: Rowan Reyes'))).toHaveLength(1);
    expect(subjects.filter((s) => s.startsWith('Rowan Reyes asked again'))).toHaveLength(0);
  });

  it('asking again later sends one "asked again" email with the new message', async () => {
    const [lead] = await herLeads();
    await db.from('leads').update({ created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() }).eq('id', lead.id);
    const again = new Date().toISOString();
    expect((await submit('Is October 3 open?')).status).toBe(200);
    const e = await waitForEmail({ to: FLOW_VENUE.email, since: again }, (x) => x.subject === `Rowan Reyes asked again — ${FLOW_VENUE.name}`);
    expect(e.html).toContain('Is October 3 open?');
    expect(e.html).toContain(STORYVENUE_LOGO);
    expect(await herLeads()).toHaveLength(1);
    expect((await ownerSubjects()).filter((s) => s.startsWith('New lead: Rowan Reyes'))).toHaveLength(1);
  });
});
