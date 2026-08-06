/**
 * Per-location GHL Workflow webhook — instant inbound SMS for PIT-connected venues.
 *
 * WHY THIS EXISTS: venues connected via a pasted Private Integration Token
 * never receive GHL marketplace webhooks (`/api/webhooks/ghl` stays silent for
 * them), so their inbound SMS previously arrived only via polling (thread-open
 * sync + the 5-minute cron). GHL sub-accounts CAN push instantly through a
 * Workflow ("Customer Replied" trigger → "Webhook" action → this URL), but
 * workflows cannot be created via the public API (read-only) — each venue
 * needs a one-time manual workflow setup in their sub-account.
 *
 * SETUP (one-time per sub-account):
 *   Automation → Workflows → Create Workflow → trigger "Customer Replied"
 *   (filter: Reply Channel = SMS) → action "Webhook" (Custom Webhook, POST) →
 *   URL:  https://<app-host>/api/webhooks/ghl-workflow-inbound?secret=<SECRET>
 *   Custom Data (key/value):
 *     locationId  → {{location.id}}
 *     contactId   → {{contact.id}}
 *     messageId   → {{message.id}}
 *     body        → {{message.body}}
 *   Publish the workflow.
 *
 * AUTH: GHL workflow webhooks don't sign payloads, so the URL carries a shared
 * secret (?secret=... or x-webhook-secret header), checked against
 * GHL_WORKFLOW_WEBHOOK_SECRET (falls back to MARKETING_CRON_SECRET so no new
 * env var is required).
 *
 * DEDUPE / PIPELINE: instead of trusting the workflow payload's message id to
 * match the conversations-API ids, the handler runs a targeted API sync for
 * just this contact's thread (`syncInboundSmsFromGhlForThread`). Every message
 * therefore enters through the exact same code path and id source as the cron,
 * so webhook + cron can never double-insert. Recovered messages get the full
 * pipeline: dedupe, thread insert, realtime broadcast, Slack notification,
 * owner email — plus TCPA keywords, reply attribution, and the AI Concierge
 * via the shared side-effects helper.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import {
  ensureSmsThread,
  syncInboundSmsFromGhlForThread,
  upsertVenueCustomerFromGhl,
} from '@/lib/ghl-sms-conversations';
import { runInboundGhlSmsSideEffects } from '@/lib/ghl-inbound-sms-side-effects';
import { logError } from '@/lib/error-log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function expectedSecret(): string {
  return (
    process.env.GHL_WORKFLOW_WEBHOOK_SECRET ||
    process.env.MARKETING_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ''
  );
}

function secretMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorize(request: NextRequest): boolean {
  const expected = expectedSecret();
  if (!expected) return process.env.NODE_ENV !== 'production';
  const candidates = [
    request.nextUrl.searchParams.get('secret'),
    request.headers.get('x-webhook-secret'),
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim(),
  ];
  return candidates.some((c) => secretMatches(c, expected));
}

function str(v: unknown): string {
  if (v == null) return '';
  const s = String(v).trim();
  // GHL leaves unresolved template variables verbatim in test-sample sends.
  if (/^\{\{.*\}\}$/.test(s)) return '';
  return s;
}

/**
 * Extract the fields we need from a GHL workflow-webhook POST. The default
 * payload nests custom key/values under `customData` and carries the contact
 * at the top level (`contact_id`, `full_name`, `location: { id }`); a raw-body
 * Custom Webhook can also put our keys at the top level. Accept both.
 */
function parseWorkflowPayload(payload: Record<string, unknown>): {
  locationId: string;
  contactId: string;
  body: string;
  messageId: string;
  contactName: string;
} {
  const custom =
    payload.customData && typeof payload.customData === 'object' && !Array.isArray(payload.customData)
      ? (payload.customData as Record<string, unknown>)
      : {};
  const location =
    payload.location && typeof payload.location === 'object' && !Array.isArray(payload.location)
      ? (payload.location as Record<string, unknown>)
      : {};
  const message =
    payload.message && typeof payload.message === 'object' && !Array.isArray(payload.message)
      ? (payload.message as Record<string, unknown>)
      : {};

  const locationId =
    str(custom.locationId) || str(payload.locationId) || str(payload.location_id) || str(location.id);
  const contactId =
    str(custom.contactId) || str(payload.contactId) || str(payload.contact_id);
  const body = str(custom.body) || str(payload.body) || str(message.body);
  const messageId = str(custom.messageId) || str(payload.messageId) || str(message.id);
  const contactName =
    str(custom.contactName) ||
    str(payload.full_name) ||
    [str(payload.first_name), str(payload.last_name)].filter(Boolean).join(' ');

  return { locationId, contactId, body, messageId, contactName };
}

/** The thread that most recently carried an SMS for this customer (a thread
 *  can mix email + SMS, so `ensureSmsThread` alone could split conversations). */
async function findLatestSmsThread(venueId: string, venueCustomerId: string): Promise<string | null> {
  const { data: threads } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', venueCustomerId);
  const ids = (threads ?? []).map((t) => (t as { id: string }).id);
  if (ids.length === 0) return null;

  const { data: msg } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id')
    .in('thread_id', ids)
    .eq('channel', 'sms')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((msg as { thread_id?: string } | null)?.thread_id as string | undefined) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ received: true, ignored: 'non-object body' });
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ received: true, ignored: 'invalid JSON' });
  }

  const { locationId, contactId, body, messageId, contactName } = parseWorkflowPayload(payload);
  console.log('[ghl-workflow-inbound] received', {
    locationId,
    contactId,
    hasBody: !!body,
    messageId: messageId || null,
  });

  if (!locationId || !contactId) {
    // Likely a GHL "test sample" send (template variables unresolved) — ack it
    // so the setup flow in the GHL UI shows success.
    return NextResponse.json({ received: true, ignored: 'missing locationId/contactId' });
  }

  try {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('id')
      .eq('ghl_location_id', locationId)
      .maybeSingle();
    if (!venue?.id) {
      console.warn('[ghl-workflow-inbound] no venue for locationId', locationId);
      void logError({
        level: 'warning',
        source: 'webhook',
        category: 'ghl_workflow_inbound_no_venue',
        message: `GHL workflow webhook fired for locationId ${locationId}, but no venue has that ghl_location_id. The inbound SMS was dropped.`,
        route: '/api/webhooks/ghl-workflow-inbound',
        context: { locationId, contactId },
      });
      return NextResponse.json({ received: true, ignored: 'unknown location' });
    }
    const venueId = venue.id as string;

    const venueCustomerId = await upsertVenueCustomerFromGhl({ venueId, locationId, contactId });
    if (!venueCustomerId) {
      return NextResponse.json({ received: true, ok: false, error: 'no_customer' });
    }

    const threadId =
      (await findLatestSmsThread(venueId, venueCustomerId)) ||
      (await ensureSmsThread(venueId, venueCustomerId));
    if (!threadId) {
      return NextResponse.json({ received: true, ok: false, error: 'no_thread' });
    }

    // Targeted API sync — pulls the new message(s) with their canonical GHL
    // ids so dedupe against the cron / thread-open sync is guaranteed.
    let { imported, insertedMessages } = await syncInboundSmsFromGhlForThread({
      venueId,
      threadId,
      venueCustomerId,
      contactName: contactName || null,
    });

    // Rare race: the workflow can fire before the message is queryable via the
    // conversations API. One short retry when we know a message body exists.
    if (imported === 0 && body) {
      await sleep(2500);
      const retry = await syncInboundSmsFromGhlForThread({
        venueId,
        threadId,
        venueCustomerId,
        contactName: contactName || null,
      });
      imported = retry.imported;
      insertedMessages = retry.insertedMessages;
    }

    // Same follow-ups as the marketplace webhook path: TCPA keywords, reply
    // attribution, AI Concierge. Only for messages created in the last few
    // minutes — a first-time sync can also backfill old history, and the AI
    // must not "reply" to stale messages.
    const freshCutoff = Date.now() - 10 * 60 * 1000;
    for (const m of insertedMessages) {
      const ts = m.createdAt ? Date.parse(m.createdAt) : Date.now();
      if (Number.isFinite(ts) && ts < freshCutoff) continue;
      await runInboundGhlSmsSideEffects({
        venueId,
        venueCustomerId: m.venueCustomerId,
        messageBody: m.body,
        ghlMessageId: m.ghlMessageId,
        inserted: true,
        logPrefix: '[ghl-workflow-inbound]',
      });
    }
    // Keyword handling must still run when the sync deduped (message already
    // stored by another path) but the payload carried an explicit body.
    if (insertedMessages.length === 0 && body) {
      await runInboundGhlSmsSideEffects({
        venueId,
        venueCustomerId,
        messageBody: body,
        ghlMessageId: messageId || null,
        inserted: false,
        logPrefix: '[ghl-workflow-inbound]',
      });
    }

    console.log('[ghl-workflow-inbound] done', { venueId, threadId, imported });
    return NextResponse.json({ received: true, ok: true, imported });
  } catch (err) {
    console.error('[ghl-workflow-inbound] failed:', err);
    void logError({
      level: 'error',
      source: 'webhook',
      category: 'ghl_workflow_inbound_failed',
      message: 'GHL workflow inbound webhook crashed while ingesting an SMS reply.',
      route: '/api/webhooks/ghl-workflow-inbound',
      error: err,
      context: { locationId, contactId },
    });
    // 200 so GHL doesn't disable the workflow action; cron will recover the message.
    return NextResponse.json({ received: true, ok: false });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
