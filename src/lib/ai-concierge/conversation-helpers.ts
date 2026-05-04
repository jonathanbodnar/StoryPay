/**
 * Conversation thread helpers for the AI Concierge.
 *
 * Mirrors the same find-or-create-thread + insert-message pattern used by
 * `marketing-email-worker` so AI-sent SMS messages show up in the venue's
 * unified inbox alongside everything else. Specifically:
 *
 *   1. Look up the venue_customer matched by the lead's email (case-insensitive)
 *      Create one if missing.
 *   2. Look up the most recent conversation_thread for that venue_customer.
 *      Create one if missing, with `external_reply_channel = 'sms'`.
 *   3. Insert a conversation_messages row with sender_kind='ai', channel='sms',
 *      visibility='external'. The DB triggers handle the rest:
 *        - thread summary updated (preview, last_message_at)
 *        - leads.last_outbound_at touched (via 098 trigger)
 *
 * Never throws — failures are logged and a `null` thread id is returned, which
 * the send cron treats as a non-fatal "couldn't log to inbox" condition.
 */

import { supabaseAdmin } from '@/lib/supabase';

export interface LogAiOutboundMessageInput {
  venueId:           string;
  leadId:            string;
  body:              string;
  /** Provider-assigned id (e.g. GHL message id). Stored on conversation_messages.ghl_message_id. */
  providerMessageId?: string;
}

export interface LogAiOutboundMessageResult {
  threadId:  string | null;
  messageId: string | null;
}

/**
 * Find or create the conversation thread for a lead. SMS-channel threads.
 */
export async function findOrCreateAiThreadForLead(
  venueId: string,
  leadId: string,
): Promise<string | null> {
  try {
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('email, first_name, last_name, name, phone')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!lead) return null;

    const email = String(lead.email || '').trim().toLowerCase();
    if (!email) return null;

    // venue_customer (find or create)
    let { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('id')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .maybeSingle();

    if (!vc) {
      const fn = (lead.first_name as string | null)?.trim()
        || (lead.name as string | null)?.split(/\s+/)[0]
        || '';
      const ln = (lead.last_name as string | null)?.trim() || '';
      const { data: created } = await supabaseAdmin
        .from('venue_customers')
        .insert({
          venue_id:        venueId,
          customer_email:  email,
          first_name:      fn || null,
          last_name:       ln || null,
          phone:           (lead.phone as string | null) || null,
        })
        .select('id')
        .single();
      vc = created;
    }
    if (!vc) return null;

    const vcId = (vc as { id: string }).id;

    // Most recent thread, or create a new SMS thread
    const { data: existing } = await supabaseAdmin
      .from('conversation_threads')
      .select('id')
      .eq('venue_id',          venueId)
      .eq('venue_customer_id', vcId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) return (existing as { id: string }).id;

    const { data: thread } = await supabaseAdmin
      .from('conversation_threads')
      .insert({
        venue_id:               venueId,
        venue_customer_id:      vcId,
        subject:                'AI Follow-up',
        external_reply_channel: 'sms',
      })
      .select('id')
      .single();

    return thread ? (thread as { id: string }).id : null;
  } catch (e) {
    console.error('[ai-concierge] findOrCreateAiThreadForLead error:', e);
    return null;
  }
}

/**
 * Append an AI-sent SMS to the lead's conversation thread (visibility='external',
 * channel='sms', sender_kind='ai'). Best-effort.
 */
export async function logAiOutboundMessage(
  input: LogAiOutboundMessageInput,
): Promise<LogAiOutboundMessageResult> {
  const threadId = await findOrCreateAiThreadForLead(input.venueId, input.leadId);
  if (!threadId) {
    return { threadId: null, messageId: null };
  }

  try {
    const { data: msg, error } = await supabaseAdmin
      .from('conversation_messages')
      .insert({
        thread_id:           threadId,
        visibility:          'external',
        channel:             'sms',
        body:                input.body,
        sender_kind:         'ai',
        external_email_sent: false,
        ghl_message_id:      input.providerMessageId ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ai-concierge] logAiOutboundMessage insert error:', error.message);
      return { threadId, messageId: null };
    }
    return { threadId, messageId: (msg as { id: string }).id };
  } catch (e) {
    console.error('[ai-concierge] logAiOutboundMessage exception:', e);
    return { threadId, messageId: null };
  }
}

/**
 * Fetch the last N messages from a lead's most recent thread, oldest first,
 * for inclusion in the AI prompt context.
 */
export interface ConversationHistoryEntry {
  sender_kind: string;
  channel:     string;
  body:        string;
  created_at:  string;
}

export async function fetchLeadConversationHistory(
  venueId: string,
  leadId: string,
  limit = 10,
): Promise<ConversationHistoryEntry[]> {
  const threadId = await findOrCreateAiThreadForLead(venueId, leadId);
  if (!threadId) return [];

  const { data } = await supabaseAdmin
    .from('conversation_messages')
    .select('sender_kind, channel, body, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data) return [];

  // We selected DESC (most recent first); flip to chronological for the prompt
  return (data as ConversationHistoryEntry[]).reverse();
}
