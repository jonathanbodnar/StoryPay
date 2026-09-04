/**
 * Private Client monthly pipeline reminder.
 *
 * Once a month, every venue flagged as a Private Client (venues.is_private_client
 * = true — the single checkbox in Venue Management / Projects board) gets an email
 * to the owner + active team members asking them to log in and move contacts who
 * booked a tour or booked a wedding into the correct pipeline stage, so those
 * metrics stay accurate for their reporting and our monthly review calls.
 *
 * Cadence is driven by an advancing timestamp on the venue row
 * (private_client_monthly_reminder_next_at). The cron runs daily but only sends
 * when next_at <= now(), then advances next_at to the 1st of the following month.
 * Newly-flagged private clients (null next_at) are seeded to the next 1st without
 * sending, so turning the checkbox on never triggers an immediate blast.
 *
 * Gated ONLY by is_private_client — unchecking the box stops future sends.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { buildEmailHtml, fillTemplate, type EmailTemplateRow } from '@/lib/email-templates';
import { SYSTEM_EMAIL_BY_KEY } from '@/lib/system-email-registry';

const TEMPLATE_KEY = 'private_client_monthly_reminder';

export type PrivateClientReminderResult = {
  processed: number;
  sent: number;
  seeded: number;
  skipped: number;
  errors: number;
};

function escapeHtmlBasic(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 1st of the following month at 12:00 UTC (~7-8am ET), so a daily cron reliably picks it up. */
function firstOfNextMonthIso(from: Date = new Date()): string {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 12, 0, 0)).toISOString();
}

type VenueRow = {
  id: string;
  name: string | null;
  owner_id: string | null;
  email: string | null;
  notification_email: string | null;
  owner_first_name: string | null;
  private_client_monthly_reminder_next_at: string | null;
};

type TeamRow = { venue_id: string; email: string | null; status: string | null };

export async function processPrivateClientMonthlyReminder(): Promise<PrivateClientReminderResult> {
  const result: PrivateClientReminderResult = { processed: 0, sent: 0, seeded: 0, skipped: 0, errors: 0 };
  const nowIso = new Date().toISOString();

  // Due = Private Client, not a demo venue, and either never seeded (null) or past due.
  const { data: venuesRaw, error } = await supabaseAdmin
    .from('venues')
    .select('id, name, owner_id, email, notification_email, owner_first_name, private_client_monthly_reminder_next_at, is_demo')
    .eq('is_private_client', true)
    .or(`private_client_monthly_reminder_next_at.is.null,private_client_monthly_reminder_next_at.lte.${nowIso}`)
    .limit(500);

  if (error) {
    console.error('[private-client-monthly-reminder] query error:', error.message);
    result.errors += 1;
    return result;
  }

  const venues = ((venuesRaw ?? []) as (VenueRow & { is_demo?: boolean | null })[]).filter((v) => v.is_demo !== true);
  result.processed = venues.length;
  if (venues.length === 0) return result;

  const nextAtSeed = firstOfNextMonthIso();

  // Seed newly-flagged private clients (null next_at) to the next 1st WITHOUT
  // sending — this avoids an immediate blast when the checkbox is first ticked.
  const toSeed = venues.filter((v) => !v.private_client_monthly_reminder_next_at);
  const toSend = venues.filter((v) => !!v.private_client_monthly_reminder_next_at);

  if (toSeed.length > 0) {
    const { error: seedErr } = await supabaseAdmin
      .from('venues')
      .update({ private_client_monthly_reminder_next_at: nextAtSeed })
      .in('id', toSeed.map((v) => v.id));
    if (seedErr) {
      console.error('[private-client-monthly-reminder] seed error:', seedErr.message);
      result.errors += 1;
    } else {
      result.seeded += toSeed.length;
    }
  }

  if (toSend.length === 0) return result;

  // Load the editable template (registry defaults + any admin override), once.
  const def = SYSTEM_EMAIL_BY_KEY[TEMPLATE_KEY]!;
  let subject    = def.defaults.subject;
  let heading    = def.defaults.heading;
  let bodyText   = def.defaults.body;
  let buttonText = def.defaults.button_text ?? null;
  try {
    const { data: override } = await supabaseAdmin
      .from('system_email_templates')
      .select('subject, heading, body, button_text')
      .eq('key', TEMPLATE_KEY)
      .maybeSingle();
    if (override) {
      const o = override as { subject?: string | null; heading?: string | null; body?: string | null; button_text?: string | null };
      subject    = o.subject    || subject;
      heading    = o.heading    || heading;
      bodyText   = o.body       || bodyText;
      buttonText = o.button_text !== undefined ? o.button_text : buttonText;
    }
  } catch { /* fall back to registry defaults */ }

  // Resolve recipients: owner (auth email → notification_email → email) + active
  // team members. One auth lookup per unique owner (private clients are few).
  const ownerIds = Array.from(new Set(toSend.map((v) => v.owner_id).filter((x): x is string => Boolean(x))));
  const ownerAuthEmail = new Map<string, string | null>();
  for (const ownerId of ownerIds) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(ownerId);
      ownerAuthEmail.set(ownerId, data?.user?.email?.trim() || null);
    } catch {
      ownerAuthEmail.set(ownerId, null);
    }
  }

  const { data: teamRaw } = await supabaseAdmin
    .from('venue_team_members')
    .select('venue_id, email, status')
    .in('venue_id', toSend.map((v) => v.id))
    .neq('status', 'inactive');
  const teamByVenue = new Map<string, string[]>();
  for (const t of (teamRaw ?? []) as TeamRow[]) {
    const em = t.email?.trim();
    if (!em || !em.includes('@')) continue;
    const list = teamByVenue.get(t.venue_id) ?? [];
    list.push(em);
    teamByVenue.set(t.venue_id, list);
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
  const actionUrl = `${appUrl}/dashboard/leads`;
  const notifFromEmail = process.env.NOTIFICATION_FROM_EMAIL?.trim() || 'notifications@send.storyvenue.com';

  for (const venue of toSend) {
    const venueName = venue.name || 'your venue';
    const ownerEmail =
      (venue.owner_id ? ownerAuthEmail.get(venue.owner_id) : null) || venue.notification_email || venue.email || null;

    // De-duplicate across owner + team (case-insensitive).
    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const addr of [ownerEmail, ...(teamByVenue.get(venue.id) ?? [])]) {
      const a = addr?.trim();
      if (!a || !a.includes('@')) continue;
      const key = a.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push(a);
    }

    if (recipients.length === 0) {
      result.skipped += 1;
      continue;
    }

    try {
      const ownerFirst = venue.owner_first_name?.trim() || 'there';
      const resolvedSubject = fillTemplate(subject, { venue_name: venueName, owner_first_name: ownerFirst });
      const tplRow: EmailTemplateRow = {
        type: TEMPLATE_KEY,
        subject,
        heading,
        body: bodyText,
        button_text: buttonText,
        footer: null,
        enabled: true,
      };
      const html = buildEmailHtml({
        template: tplRow,
        vars: {
          owner_first_name: escapeHtmlBasic(ownerFirst),
          venue_name: escapeHtmlBasic(venueName),
          action_url: actionUrl,
        },
        actionUrl,
        brandColor: '#1b1b1b',
        venueName,
      });

      const results = await Promise.allSettled(
        recipients.map((to) =>
          sendEmail({
            to,
            subject: resolvedSubject,
            html,
            from: { email: notifFromEmail, name: 'StoryVenue' },
          }),
        ),
      );
      const anyOk = results.some((r) => r.status === 'fulfilled' && r.value.success);
      if (!anyOk) {
        result.errors += 1;
        console.warn(`[private-client-monthly-reminder] all sends failed for venue ${venue.id}`);
        continue;
      }

      await supabaseAdmin
        .from('venues')
        .update({
          private_client_monthly_reminder_next_at: nextAtSeed,
          private_client_monthly_reminder_last_sent_at: nowIso,
        })
        .eq('id', venue.id);
      result.sent += 1;
    } catch (e) {
      result.errors += 1;
      console.error(`[private-client-monthly-reminder] error for venue ${venue.id}:`, e instanceof Error ? e.message : e);
    }
  }

  return result;
}
