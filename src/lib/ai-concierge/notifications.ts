/**
 * AI Concierge — owner notifications (email-only for v1).
 *
 * Lead-driven scenarios:
 *   - ai_handoff_urgent   — lawyer / manager / refund keywords → owner + concierge
 *   - ai_handoff_pricing  — pricing question                  → concierge only
 *   - ai_reply_received   — bride replied (neutral)            → owner
 *   - ai_not_interested   — negative-intent reply              → owner
 *   - ai_tcpa_opt_out     — STOP / unsubscribe keyword         → owner (FYI)
 *
 * Spend-cap scenarios (no bride context — `brideName` is a friendly label
 * like "Today's AI usage", `brideReply` is unused, `extraDetail` carries
 * the count summary):
 *   - ai_daily_cap_warning — venue crossed the 80% threshold     → owner
 *   - ai_daily_cap_reached — venue hit its daily cap; sends paused → owner
 *
 * Recipients:
 *   - "owner"     → venues.notification_email if set, else venues.email
 *   - "concierge" → every address in venues.ai_concierge_notify_emails (text[])
 *
 * Best-effort: exceptions are caught and logged, never thrown. The inbound
 * handler treats missing recipients as a no-op — the rest of the state
 * machine still proceeds.
 *
 * Rendered as plain HTML inline (no email_templates table lookup) so a venue
 * that hasn't customized any email templates still gets the alert. Format
 * matches the rest of the app's transactional emails (logo + brand color +
 * CTA button to the contact page in the dashboard).
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

// ── Public types ───────────────────────────────────────────────────────────

export type AiOwnerScenario =
  | 'ai_handoff_urgent'
  | 'ai_handoff_pricing'
  | 'ai_reply_received'
  | 'ai_not_interested'
  | 'ai_tcpa_opt_out'
  | 'ai_daily_cap_warning'
  | 'ai_daily_cap_reached'
  /** Bride replied while still in the 14-day follow-up sequence (ai_state=dormant).
   *  AI is NOT active yet — a human needs to step in and respond. */
  | 'sequence_reply_received';

export type AiNotifyRole = 'venue_owner' | 'concierge';

export interface AiOwnerNotifyInput {
  venueId:       string;
  /** Lead UUID — used to build the dashboard CTA link. */
  leadId:        string;
  scenario:      AiOwnerScenario;
  /** Which audiences to notify, derived from the matching handoff rule's notify_roles. */
  notifyRoles:   AiNotifyRole[];
  /** Bride's first name for the email subject/body. */
  brideName:     string;
  /** Bride's full name (or first only if last unknown). */
  brideFullName: string;
  /** Bride's reply text (truncated to 500 chars in the email). */
  brideReply?:   string;
  /** Trigger keyword that fired the rule, or the classified intent. */
  matchedTrigger?: string;
  /** Free-form "additional context" for the email body. */
  extraDetail?:  string;
}

interface VenueRow {
  id:                          string;
  name:                        string | null;
  email:                       string | null;
  notification_email:          string | null;
  ai_concierge_notify_emails:  string[] | null;
  brand_color:                 string | null;
  brand_logo_url:              string | null;
}

// ── Scenario meta ──────────────────────────────────────────────────────────

interface ScenarioMeta {
  emailSubject: (brideName: string, venueName: string) => string;
  heading:      (brideName: string) => string;
  intro:        (brideName: string) => string;
  urgent:       boolean;
  ctaLabel:     string;
  /**
   * When true, all venue team members (venue_team_members rows) are
   * automatically CC'd alongside the owner and concierge emails.
   * Set to true for every scenario that a human needs to act on;
   * false for operational/admin-only alerts (spend caps, etc.).
   */
  notifyTeam:   boolean;
}

const SCENARIOS: Record<AiOwnerScenario, ScenarioMeta> = {
  ai_handoff_urgent: {
    emailSubject: (n, v) => `🚨 Urgent: ${n} needs human attention — ${v}`,
    heading:      (n) => `${n} just sent a message that needs you NOW`,
    intro:        (n) => `${n} replied to one of your AI follow-up messages with something that needs a human in the loop right away. The AI has stopped and is waiting for you to take over.`,
    urgent:       true,
    ctaLabel:     'Open the conversation →',
    notifyTeam:   true,
  },
  ai_handoff_pricing: {
    emailSubject: (n, v) => `${n} is asking about pricing — ${v}`,
    heading:      (n) => `${n} asked about pricing — your concierge should reply`,
    intro:        (n) => `${n} replied to one of your AI follow-up messages asking about pricing, packages, or rates. The AI is intentionally never quoting prices, so it has handed the conversation off so a real person can give her real answers.`,
    urgent:       false,
    ctaLabel:     'Reply to her now →',
    notifyTeam:   true,
  },
  ai_reply_received: {
    emailSubject: (n, v) => `🎉 ${n} just replied — ${v}`,
    heading:      (n) => `${n} replied to your AI follow-up`,
    intro:        (n) => `Great news — ${n} just replied to one of your AI follow-up messages. The AI has paused so a human (you or your team) can take over the conversation. The sooner you respond, the warmer she'll feel.`,
    urgent:       false,
    ctaLabel:     'Reply to her now →',
    notifyTeam:   true,
  },
  ai_not_interested: {
    emailSubject: (n, v) => `${n} marked herself as not interested — ${v}`,
    heading:      (n) => `${n} is no longer interested`,
    intro:        (n) => `${n} replied to your AI follow-up indicating she's no longer interested or has chosen another venue. We've moved her to your "Not Interested" pipeline and stopped all future AI follow-ups for her.`,
    urgent:       false,
    ctaLabel:     'View her contact record →',
    notifyTeam:   true,
  },
  ai_tcpa_opt_out: {
    emailSubject: (n, v) => `${n} opted out of SMS — ${v}`,
    heading:      (n) => `${n} replied STOP / UNSUBSCRIBE — SMS disabled`,
    intro:        (n) => `${n} replied with a TCPA opt-out keyword (STOP, UNSUBSCRIBE, etc.). She will not receive any more SMS messages from your account — this is a legal compliance requirement and cannot be undone from the AI side. You can still reach out via email or other channels.`,
    urgent:       false,
    ctaLabel:     'View her contact record →',
    notifyTeam:   true,
  },
  ai_daily_cap_warning: {
    emailSubject: (_n, v) => `Heads up: AI Concierge is at 80% of today's send cap — ${v}`,
    heading:      ()      => `AI Concierge daily cap warning`,
    intro:        ()      => `Your AI Concierge has used most of today's outbound SMS budget. We'll keep sending until the cap is reached, then pause new sends until tomorrow morning. Raise the cap from your AI Concierge admin if you want today's outreach to continue uninterrupted.`,
    urgent:       false,
    ctaLabel:     'Open AI Concierge admin →',
    notifyTeam:   false,
  },
  ai_daily_cap_reached: {
    emailSubject: (_n, v) => `AI Concierge has hit today's send cap — ${v}`,
    heading:      ()      => `AI Concierge daily cap reached`,
    intro:        ()      => `Your AI Concierge has hit today's outbound SMS cap. New sends are paused until tomorrow morning (in your venue's local timezone). Inbound replies are unaffected — you'll still receive every reply notification. To resume sends sooner, raise the cap from your AI Concierge admin.`,
    urgent:       false,
    ctaLabel:     'Open AI Concierge admin →',
    notifyTeam:   false,
  },
  sequence_reply_received: {
    emailSubject: (n, v) => `💬 ${n} replied to your follow-up — ${v}`,
    heading:      (n) => `${n} replied — time to step in`,
    intro:        (n) => `${n} replied to one of your automated follow-up messages. The AI Concierge hasn't activated yet, so this conversation needs a real person right now. The faster you respond, the warmer she'll feel — don't let this one go cold.`,
    urgent:       false,
    ctaLabel:     'Reply to her now →',
    notifyTeam:   true,
  },
};

// ── Public entry ───────────────────────────────────────────────────────────

export async function notifyAiOwner(input: AiOwnerNotifyInput): Promise<void> {
  try {
    const venue = await loadVenue(input.venueId);
    if (!venue) return;

    const venueName = venue.name?.trim() || 'Your venue';
    const meta = SCENARIOS[input.scenario];
    if (!meta) return;

    const ownerEmail = (venue.notification_email?.trim() || venue.email?.trim() || '');
    const conciergeEmails = (venue.ai_concierge_notify_emails ?? [])
      .map((e) => (e || '').trim())
      .filter((e) => e.includes('@'));

    const includesOwner     = input.notifyRoles.includes('venue_owner');
    const includesConcierge = input.notifyRoles.includes('concierge');

    // Resolve primary recipient
    let to: string | null = null;
    const cc: string[] = [];

    if (includesOwner && ownerEmail) {
      to = ownerEmail;
      if (includesConcierge) {
        cc.push(...conciergeEmails.filter((e) => e.toLowerCase() !== ownerEmail.toLowerCase()));
      }
    } else if (includesConcierge && conciergeEmails.length > 0) {
      to = conciergeEmails[0];
      if (conciergeEmails.length > 1) cc.push(...conciergeEmails.slice(1));
    } else if (ownerEmail) {
      to = ownerEmail;
    } else {
      return;
    }

    // For lead-action scenarios (replies, negative intent, handoffs) also CC
    // every venue team member so the whole team can act without waiting for
    // the owner to forward the email.
    if (meta.notifyTeam) {
      const teamEmails = await loadTeamMemberEmails(input.venueId, to);
      for (const e of teamEmails) {
        if (!cc.some((c) => c.toLowerCase() === e.toLowerCase())) {
          cc.push(e);
        }
      }
    }

    const subject = meta.emailSubject(input.brideName, venueName);
    const html = renderHtml({ meta, input, venue, venueName });

    await sendEmail({ to, cc, subject, html });
  } catch (e) {
    console.error('[ai-concierge] notifyAiOwner failed:', e);
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

async function loadVenue(venueId: string): Promise<VenueRow | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, notification_email, ai_concierge_notify_emails, brand_color, brand_logo_url')
    .eq('id', venueId)
    .maybeSingle();
  return (data as VenueRow | null) ?? null;
}

/**
 * Return the email addresses of all venue team members (both 'invited' and
 * 'active' statuses) so that even a newly-added team member who hasn't yet
 * accepted their invite still receives lead notifications.
 * Deduplicates against the provided ownerEmail so we never send twice.
 */
async function loadTeamMemberEmails(
  venueId: string,
  excludeEmail?: string,
): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from('venue_team_members')
      .select('email, status')
      .eq('venue_id', venueId)
      .in('status', ['invited', 'active']);

    if (!data) return [];

    const ownerLower = (excludeEmail || '').trim().toLowerCase();
    return (data as { email: string; status: string }[])
      .map((m) => (m.email || '').trim())
      .filter((e) => e.includes('@') && e.toLowerCase() !== ownerLower);
  } catch {
    return [];
  }
}

function dashboardContactUrl(leadId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');
  return `${base}/dashboard/contacts/${leadId}`;
}

function aiConciergeSettingsUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');
  return `${base}/dashboard/marketing/ai-concierge`;
}

/** Scenario-aware CTA URL. */
function ctaUrlFor(scenario: AiOwnerScenario, leadId: string): string {
  if (scenario === 'ai_daily_cap_warning' || scenario === 'ai_daily_cap_reached') {
    return aiConciergeSettingsUrl();
  }
  return dashboardContactUrl(leadId);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(opts: {
  meta:      ScenarioMeta;
  input:     AiOwnerNotifyInput;
  venue:     VenueRow;
  venueName: string;
}): string {
  const { meta, input, venue, venueName } = opts;
  const brandColor = (venue.brand_color || '#1b1b1b').trim() || '#1b1b1b';
  const accent     = meta.urgent ? '#dc2626' : brandColor;
  const logoHtml   = venue.brand_logo_url
    ? `<img src="${escapeHtml(venue.brand_logo_url)}" alt="${escapeHtml(venueName)}" style="height:36px;display:block;margin-bottom:8px">`
    : '';
  const ctaUrl = ctaUrlFor(input.scenario, input.leadId);

  const briderReplyBlock = input.brideReply?.trim()
    ? `
        <div style="margin:24px 0;padding:18px 20px;background:#f9fafb;border-left:4px solid ${accent};border-radius:6px">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Her message</div>
          <div style="font-size:15px;color:#111827;line-height:1.6;white-space:pre-wrap">${escapeHtml(input.brideReply.slice(0, 500))}</div>
        </div>`
    : '';

  const triggerBlock = input.matchedTrigger
    ? `
        <div style="font-size:13px;color:#6b7280;margin:0 0 16px">
          Trigger: <strong>${escapeHtml(input.matchedTrigger)}</strong>${input.extraDetail ? ` — ${escapeHtml(input.extraDetail)}` : ''}
        </div>`
    : (input.extraDetail
       ? `<div style="font-size:13px;color:#6b7280;margin:0 0 16px">${escapeHtml(input.extraDetail)}</div>`
       : '');

  return `
    <div style="font-family:'Open Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">
      <div style="background-color:${accent};padding:24px 28px;border-radius:12px 12px 0 0">
        ${logoHtml}
        <h1 style="color:white;font-size:20px;margin:0;font-weight:600">${escapeHtml(meta.heading(input.brideName))}</h1>
      </div>
      <div style="padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
        ${triggerBlock}
        <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 12px">
          ${escapeHtml(meta.intro(input.brideName))}
        </p>
        ${briderReplyBlock}
        <div style="text-align:center;margin:28px 0 8px">
          <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background-color:${accent};color:white;padding:13px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
            ${escapeHtml(meta.ctaLabel)}
          </a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px">
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0">
          AI Concierge alert from ${escapeHtml(venueName)} · sent via StoryVenue
        </p>
      </div>
    </div>
  `;
}
