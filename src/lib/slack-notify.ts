/**
 * Posts silent notifications to a single Slack channel via Incoming Webhook.
 *
 * Configured via the SLACK_SUPPORT_WEBHOOK_URL env var (set in Railway, not
 * committed here). No-ops if unset so this never breaks message sending in
 * environments without Slack configured (e.g. local dev, preview envs).
 *
 * Messages are deliberately silent — plain `text`/`blocks` payloads, no
 * @here/@channel — since this fires on every reply/ticket and would be noisy
 * otherwise. Slack channel-level notification prefs control loudness.
 */

const WEBHOOK_URL = process.env.SLACK_SUPPORT_WEBHOOK_URL;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');

function truncate(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '(no message body)';
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

async function postToSlack(blocks: unknown[], fallbackText: string): Promise<void> {
  if (!WEBHOOK_URL) return;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fallbackText, blocks }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn('[slack-notify] non-OK response:', res.status, t);
    }
  } catch (err) {
    console.error('[slack-notify] failed to post:', err);
  }
}

/** Admin Support Inbox → Bride Replies tab, deep-linked to a specific thread. */
function brideThreadLink(threadId: string): string {
  return `${APP_URL}/admin/support?thread=${encodeURIComponent(threadId)}`;
}

/**
 * Admin Support Inbox → Tickets tab. `?tab=tickets` is read by
 * SupportInboxPanel on load; the `ticket` param is included for future-proofing
 * but is NOT currently read by the panel (there is no auto-select-ticket-from-URL
 * wiring yet), so this link opens the Tickets tab without pre-selecting the row.
 */
function ticketLink(ticketId: string): string {
  return `${APP_URL}/admin/support?tab=tickets&ticket=${encodeURIComponent(ticketId)}`;
}

/**
 * Admin Support Inbox → Private Clients tab. `?venue=` is included for
 * future-proofing (not yet auto-selected by the panel), matching the
 * ticketLink pattern above.
 */
function privateClientLink(venueId: string): string {
  return `${APP_URL}/admin/support?tab=private-clients&venue=${encodeURIComponent(venueId)}`;
}

export async function notifyPrivateClientReply(opts: {
  venueName: string;
  recipientLabel: string;
  messagePreview: string;
  venueId: string;
}): Promise<void> {
  const link = privateClientLink(opts.venueId);
  const text = `📱 Reply from ${opts.recipientLabel} — ${opts.venueName}`;
  await postToSlack(
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📱 *SMS reply from ${opts.recipientLabel}* — *${opts.venueName}*\n${truncate(opts.messagePreview)}\n<${link}|Open in Support Inbox>`,
        },
      },
    ],
    text,
  );
}

export async function notifyBrideReply(opts: {
  venueName: string;
  contactName: string;
  messagePreview: string;
  threadId: string;
}): Promise<void> {
  const link = brideThreadLink(opts.threadId);
  const text = `🔔 New bride reply — ${opts.venueName} — ${opts.contactName}`;
  await postToSlack(
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔔 *New bride reply* — *${opts.venueName}*\n*${opts.contactName}:* ${truncate(opts.messagePreview)}\n<${link}|Open in Support Inbox>`,
        },
      },
    ],
    text,
  );
}

export async function notifyVenueReply(opts: {
  venueName: string;
  senderName: string;
  messagePreview: string;
  threadId: string;
}): Promise<void> {
  const link = brideThreadLink(opts.threadId);
  const text = `💬 Venue reply — ${opts.venueName}`;
  await postToSlack(
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `💬 *Venue reply* — *${opts.venueName}*\n*${opts.senderName}:* ${truncate(opts.messagePreview)}\n<${link}|Open in Support Inbox>`,
        },
      },
    ],
    text,
  );
}

export async function notifySupportTicket(opts: {
  venueName: string;
  subject: string;
  messagePreview: string;
  ticketId: string;
}): Promise<void> {
  const link = ticketLink(opts.ticketId);
  const text = `🎫 New support request — ${opts.venueName}`;
  await postToSlack(
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🎫 *New support request* — *${opts.venueName}*\n*${opts.subject}:* ${truncate(opts.messagePreview)}\n<${link}|Open in Support Inbox>`,
        },
      },
    ],
    text,
  );
}

/**
 * Follow-up reply on an ALREADY-OPEN Venue Support ticket (venue/client
 * replied again, whether via the dashboard or by emailing support@ back).
 * Distinct from notifySupportTicket (brand-new ticket) so every inbound
 * message — new ticket or follow-up — pings the shared channel.
 */
export async function notifyTicketReply(opts: {
  venueName: string;
  subject: string;
  messagePreview: string;
  ticketId: string;
}): Promise<void> {
  const link = ticketLink(opts.ticketId);
  const text = `🎫 Ticket reply — ${opts.venueName}`;
  await postToSlack(
    [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🎫 *Ticket reply* — *${opts.venueName}*\n*${opts.subject}:* ${truncate(opts.messagePreview)}\n<${link}|Open in Support Inbox>`,
        },
      },
    ],
    text,
  );
}
