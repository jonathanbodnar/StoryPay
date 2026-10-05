import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Browser, db, env, runId, signedInSuperAdmin } from './helpers';

// Whose bride replies the support team sees (Support Inbox → Bride replies).
// Oct 5 2026: the owner set up Retreat at Evans Farms as a Private Client with
// Venue Concierge checked, texted back as a bride, and nothing showed there.
// The inbox only looked at the AI Concierge add-on (or the plan, or legacy);
// the Venue Concierge box, whose own label promises this, was never read.
// Owner's rule: a Private Client with Venue Concierge checked ALWAYS sends its
// bride replies to the support inbox, because our concierges handle them.
describe('bride replies reach the Support Inbox', () => {
  const venueId = randomUUID();
  const customerId = randomUUID();
  const threadId = randomUUID();
  const brideEmail = `bride.${runId}@example.com`;
  const reply = `Thank you! We are thinking June 2027. (${runId})`;
  let admin: Browser;

  type Row = { thread_id: string; venue_id: string; venue_name: string; contact_email: string | null; last_inbound_channel: string; last_inbound_body: string };
  const inbox = async (): Promise<Row[]> => {
    const res = await admin.fetch(`/api/admin/support/bride-inbox?venue_id=${venueId}`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { threads: Row[] }).threads;
  };
  const badge = async (): Promise<number> => {
    const res = await admin.fetch('/api/admin/support/inbox-count');
    expect(res.status).toBe(200);
    return ((await res.json()) as { brideReplies: number }).brideReplies;
  };
  // The boxes, ticked the way support ticks them on Venue Management.
  const tick = async (boxes: { is_private_client?: boolean; venue_concierge?: boolean }) => {
    const res = await admin.fetch(`/api/admin/venues/${venueId}`, { method: 'PATCH', json: boxes });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
  };

  beforeAll(async () => {
    admin = await signedInSuperAdmin();
    // A venue on the $97 plan: no AI Concierge add-on, not legacy.
    const { data: plan } = await db.from('directory_plans').select('id, feature_flags').eq('slug', 'bride-booking-system').single();
    expect((plan!.feature_flags as Record<string, unknown> | null)?.addon_concierge_included ?? false).toBe(false);
    const email = `evans.${runId}@example.com`;
    const made = await db.from('venues').insert({
      id: venueId, name: `Retreat Test Farms ${runId}`, slug: `retreat-test-farms-${runId}`, email,
      notification_email: email, brand_email: email, password_hash: await bcrypt.hash(env.password, 10),
      setup_completed: true, onboarding_status: 'registered', onboarding_completed_at: new Date().toISOString(),
      directory_plan_id: plan!.id, directory_subscription_status: 'active', email_verified_at: new Date().toISOString(),
      owner_first_name: 'Eve', owner_last_name: 'Evans', timezone: 'America/New_York', is_published: true, is_demo: false,
      is_private_client: false, venue_concierge: false, directory_addon_concierge: false,
    });
    if (made.error) throw new Error(`venue: ${made.error.message}`);

    // A bride got the venue's guide, and texted back. Stored the way the reply sync stores one.
    const sent = new Date(Date.now() - 5 * 60_000).toISOString();
    const replied = new Date().toISOString();
    const customer = await db.from('venue_customers').insert({
      id: customerId, venue_id: venueId, customer_email: brideEmail, first_name: 'Bree', last_name: 'Bride', phone: '+12125550188',
    });
    if (customer.error) throw new Error(`customer: ${customer.error.message}`);
    const thread = await db.from('conversation_threads').insert({
      id: threadId, venue_id: venueId, venue_customer_id: customerId, subject: 'Your pricing guide', external_reply_channel: 'sms',
      last_message_at: replied, last_message_preview: reply.slice(0, 140), last_message_visibility: 'external',
    });
    if (thread.error) throw new Error(`thread: ${thread.error.message}`);
    const messages = await db.from('conversation_messages').insert([
      { thread_id: threadId, visibility: 'external', channel: 'sms', body: 'Here is your pricing guide!', sender_kind: 'owner', created_at: sent },
      { thread_id: threadId, visibility: 'external', channel: 'sms', body: reply, sender_kind: 'contact', contact_from_name: 'Bree Bride', created_at: replied },
    ]);
    if (messages.error) throw new Error(`messages: ${messages.error.message}`);
  });

  it('a venue that handles its own couples is left out', async () => {
    expect(await inbox()).toEqual([]);
    // Either box alone changes nothing: it takes both.
    await tick({ is_private_client: true });
    expect(await inbox()).toEqual([]);
    await tick({ is_private_client: false, venue_concierge: true });
    expect(await inbox()).toEqual([]);
    await tick({ venue_concierge: false });
  });

  it('a Private Client with Venue Concierge checked: the reply is there, and counted on the badge', async () => {
    const before = await badge();
    await tick({ is_private_client: true, venue_concierge: true });

    const rows = await inbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      thread_id: threadId, venue_id: venueId, venue_name: `Retreat Test Farms ${runId}`,
      contact_email: brideEmail, last_inbound_channel: 'sms', last_inbound_body: reply,
    });
    expect(await badge()).toBe(before + 1);
    // It's in the unfiltered inbox too, the one support actually opens.
    const all = await admin.fetch(`/api/admin/support/bride-inbox?search=${encodeURIComponent(runId)}`);
    expect(((await all.json()) as { threads: Row[] }).threads.map((t) => t.thread_id)).toContain(threadId);
  });

  it('always: even with the AI Concierge switched off for that venue', async () => {
    expect((await db.from('venues').update({ ai_concierge_admin_disabled: true }).eq('id', venueId)).error).toBeNull();
    try {
      expect((await inbox()).map((t) => t.thread_id)).toEqual([threadId]);
    } finally {
      await db.from('venues').update({ ai_concierge_admin_disabled: false }).eq('id', venueId);
    }
  });

  it('unticking Venue Concierge hands the couples back to the venue', async () => {
    const before = await badge();
    await tick({ venue_concierge: false });
    expect(await inbox()).toEqual([]);
    expect(await badge()).toBe(before - 1);
  });

  it('a venue with the AI Concierge add-on is in the inbox as before, Private Client or not', async () => {
    await tick({ is_private_client: false });
    expect((await db.from('venues').update({ directory_addon_concierge: true }).eq('id', venueId)).error).toBeNull();
    expect((await inbox()).map((t) => t.thread_id)).toEqual([threadId]);
  });

  // Texts the venue side sends from its own CRM are brought into the thread
  // (Oct 5 2026). An automated one answers nobody, so it must not take a
  // bride's reply out of this inbox: before they were brought in, it couldn't.
  // A text a person sent from the CRM's app is the venue answering her.
  const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
  const brought = async (row: Record<string, unknown>) => {
    const { error } = await db.from('conversation_messages').insert({ thread_id: threadId, visibility: 'external', channel: 'sms', ...row });
    expect(error?.message ?? null).toBeNull();
  };
  const answered = async (): Promise<string[]> => {
    const res = await admin.fetch(`/api/admin/support/bride-inbox?venue_id=${venueId}&filter=closed`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { threads: Row[] }).threads.map((t) => t.thread_id);
  };

  it('an automated text from the venue’s own CRM after her reply: she is still waiting, and still counted', async () => {
    const before = await badge();
    await brought({ body: 'Thanks for your message! We will be in touch soon.', sender_kind: 'system', sent_via: 'crm_workflow', created_at: later(1) });
    await brought({ body: 'Reminder: tours run Saturdays at 2.', sender_kind: 'system', sent_via: 'crm_api', created_at: later(2) });
    expect((await inbox()).map((t) => t.thread_id)).toEqual([threadId]);
    expect(await answered()).toEqual([]);
    expect(await badge()).toBe(before);
  });

  it('the owner answering from her phone is an answer: the thread moves to Replied and off the badge', async () => {
    const before = await badge();
    await brought({ body: 'Hi Bree! June 2027 is open. Want to come see it?', sender_kind: 'owner', sent_via: 'crm_user', sent_by_name: 'Eve Evans', created_at: later(3) });
    expect(await inbox()).toEqual([]);
    expect(await answered()).toEqual([threadId]);
    expect(await badge()).toBe(before - 1);
  });
});
