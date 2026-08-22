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
import { buildSystemEmail } from '@/lib/email-templates';

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
  | 'sequence_reply_received'
  /** 60-day window elapsed with zero replies — lead moved to Not Interested. */
  | 'ai_exhausted_no_reply'
  /** Exhausted lead replied after the 60-day window — moved back to
   *  Conversation Started, humans must take over. */
  | 'ai_lead_revived';

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
  owner_id:                    string | null;
  ai_concierge_notify_emails:  string[] | null;
  brand_color:                 string | null;
  brand_logo_url:              string | null;
}

// ── Scenario meta ──────────────────────────────────────────────────────────

/** First + full name context passed into scenario copy functions. Subjects
 *  always use `fullName` (never just first name, per compliance/clarity —
 *  a venue owner managing many leads needs the last name to tell them
 *  apart); the in-body heading/intro keep the friendlier first-name-only
 *  tone. Subject lines never contain emoji or icons. */
export interface AiNameContext {
  firstName: string;
  fullName:  string;
}

interface ScenarioMeta {
  emailSubject: (name: AiNameContext, venueName: string) => string;
  heading:      (name: AiNameContext) => string;
  intro:        (name: AiNameContext) => string;
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
    emailSubject: (n, v) => `Urgent: ${n.fullName} needs human attention — ${v}`,
    heading:      (n) => `${n.firstName} just sent a message that needs you NOW`,
    intro:        (n) => `${n.firstName} replied to one of your AI follow-up messages with something that needs a human in the loop right away. The AI has stopped and is waiting for you to take over.`,
    urgent:       true,
    ctaLabel:     'Open the conversation →',
    notifyTeam:   true,
  },
  ai_handoff_pricing: {
    emailSubject: (n, v) => `${n.fullName} is asking about pricing — ${v}`,
    heading:      (n) => `${n.firstName} asked about pricing — your concierge should reply`,
    intro:        (n) => `${n.firstName} replied to one of your AI follow-up messages asking about pricing, packages, or rates. The AI is intentionally never quoting prices, so it has handed the conversation off so a real person can give her real answers.`,
    urgent:       false,
    ctaLabel:     'Reply to her now →',
    notifyTeam:   true,
  },
  ai_reply_received: {
    emailSubject: (n, v) => `${n.fullName} just replied — ${v}`,
    heading:      (n) => `${n.firstName} replied to your AI follow-up`,
    intro:        (n) => `Great news — ${n.firstName} just replied to one of your AI follow-up messages. The AI has paused so a human (you or your team) can take over the conversation. The sooner you respond, the warmer she'll feel.`,
    urgent:       false,
    ctaLabel:     'Reply to her now →',
    notifyTeam:   true,
  },
  ai_not_interested: {
    emailSubject: (n, v) => `${n.fullName} marked herself as not interested — ${v}`,
    heading:      (n) => `${n.firstName} is no longer interested`,
    intro:        (n) => `${n.firstName} replied to your AI follow-up indicating she's no longer interested or has chosen another venue. We've moved her to your "Not Interested" pipeline and stopped all future AI follow-ups for her.`,
    urgent:       false,
    ctaLabel:     'View her contact record →',
    notifyTeam:   true,
  },
  ai_tcpa_opt_out: {
    emailSubject: (n, v) => `${n.fullName} opted out of SMS — ${v}`,
    heading:      (n) => `${n.firstName} replied STOP / UNSUBSCRIBE — SMS disabled`,
    intro:        (n) => `${n.firstName} replied with a TCPA opt-out keyword (STOP, UNSUBSCRIBE, etc.). She will not receive any more SMS messages from your account — this is a legal compliance requirement and cannot be undone from the AI side. You can still reach out via email or other channels.`,
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
    emailSubject: (n, v) => `${n.fullName} replied to your follow-up — ${v}`,
    heading:      (n) => `${n.firstName} replied — time to step in`,
    intro:        (n) => `${n.firstName} replied to one of your automated follow-up messages. The AI Concierge hasn't activated yet, so this conversation needs a real person right now. The faster you respond, the warmer she'll feel — don't let this one go cold.`,
    urgent:       false,
    ctaLabel:     'Reply to her now →',
    notifyTeam:   true,
  },
  ai_exhausted_no_reply: {
    emailSubject: (n, v) => `${n.fullName} finished the 60-day follow-up window — ${v}`,
    heading:      (n) => `${n.firstName} never replied — moved to Not Interested`,
    intro:        (n) => `The AI Concierge completed its full 60-day follow-up sequence for ${n.firstName} without ever getting a reply. She has been moved to your "Not Interested" pipeline stage and is no longer considered a warm lead. No further automated messages will be sent. If she ever replies in the future, she'll automatically move back to "Conversation Started" and you'll be notified.`,
    urgent:       false,
    ctaLabel:     'View her contact record →',
    notifyTeam:   true,
  },
  ai_lead_revived: {
    emailSubject: (n, v) => `${n.fullName} came back — she replied after going quiet — ${v}`,
    heading:      (n) => `${n.firstName} is a warm lead again`,
    intro:        (n) => `Great news — ${n.firstName} just replied, even though her follow-up window had already ended and she'd been moved to Not Interested. We've moved her back to "Conversation Started" in your pipeline. This is a warm lead — a real person should take over the conversation right now.`,
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
    const defaultMeta = SCENARIOS[input.scenario];
    if (!defaultMeta) return;

    // Super-admin copy overrides (System Email Templates page). Any saved
    // override for this scenario key replaces the hardcoded default copy.
    // Variables: {{bride_first_name}}, {{bride_full_name}}, {{venue_name}}.
    const meta = await applyTemplateOverride(input.scenario, defaultMeta, venueName);
    const nameCtx: AiNameContext = { firstName: input.brideName, fullName: input.brideFullName };

    const ownerEmail = await resolveOwnerEmail(venue);
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

    const subject = meta.emailSubject(nameCtx, venueName);
    const html = renderHtml({ meta, input, venueName, nameCtx });

    // Brand from "StoryVenue Concierge team" so the venue owner immediately
    // recognises this as a managed-service alert (matches the Venue Direct
    // emails). Honour SUPPORT_FROM_EMAIL if configured.
    const fromEmail = process.env.SUPPORT_FROM_EMAIL?.trim() || 'support@storyvenue.com';
    await sendEmail({
      to,
      cc,
      subject,
      html,
      from: { email: fromEmail, name: 'StoryVenue Concierge team' },
    });
  } catch (e) {
    console.error('[ai-concierge] notifyAiOwner failed:', e);
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * Merge a saved System Email Template override (if any) over the hardcoded
 * scenario copy. Overrides are stored with {{bride_first_name}},
 * {{bride_full_name}}, and {{venue_name}} variables; we substitute them here
 * so the resulting meta is drop-in compatible with the function-based
 * defaults. Fail-open: any error falls back to the defaults so notifications
 * never break.
 */
async function applyTemplateOverride(
  scenario: AiOwnerScenario,
  defaults: ScenarioMeta,
  venueName: string,
): Promise<ScenarioMeta> {
  try {
    const { data } = await supabaseAdmin
      .from('system_email_templates')
      .select('subject, heading, body, button_text')
      .eq('key', scenario)
      .maybeSingle();
    if (!data) return defaults;

    const row = data as { subject?: string | null; heading?: string | null; body?: string | null; button_text?: string | null };
    const fill = (tpl: string, n: AiNameContext) =>
      tpl
        .replace(/\{\{\s*bride_first_name\s*\}\}/g, n.firstName)
        .replace(/\{\{\s*bride_full_name\s*\}\}/g, n.fullName)
        .replace(/\{\{\s*venue_name\s*\}\}/g, venueName);

    return {
      ...defaults,
      emailSubject: row.subject ? (n) => fill(row.subject as string, n) : defaults.emailSubject,
      heading:      row.heading ? (n) => fill(row.heading as string, n) : defaults.heading,
      intro:        row.body    ? (n) => fill(row.body as string, n)    : defaults.intro,
      ctaLabel:     row.button_text?.trim() || defaults.ctaLabel,
    };
  } catch {
    return defaults;
  }
}

async function loadVenue(venueId: string): Promise<VenueRow | null> {
  const { data } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, notification_email, owner_id, ai_concierge_notify_emails, brand_color, brand_logo_url')
    .eq('id', venueId)
    .maybeSingle();
  return (data as VenueRow | null) ?? null;
}

/**
 * Resolve the venue's account-owner email. Prefer the actual sign-in email
 * from auth.users (linked via venues.owner_id) — that's the address the owner
 * recognizes. Fall back to the legacy notification_email/email columns if the
 * auth lookup fails.
 */
async function resolveOwnerEmail(venue: VenueRow): Promise<string> {
  if (venue.owner_id) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(venue.owner_id);
      const authEmail = data?.user?.email?.trim();
      if (authEmail) return authEmail;
    } catch (e) {
      console.warn('[ai-concierge] owner auth lookup failed', e);
    }
  }
  return (venue.notification_email?.trim() || venue.email?.trim() || '');
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
  venueName: string;
  nameCtx:   AiNameContext;
}): string {
  const { meta, input, venueName, nameCtx } = opts;
  const ctaUrl = ctaUrlFor(input.scenario, input.leadId);

  // Urgent alerts get a subtle red pill in the body — the chassis itself stays
  // on-brand (black accent) so every StoryVenue email reads the same.
  const urgentBadge = meta.urgent
    ? `<div style="text-align:center;margin:0 0 16px;"><span style="display:inline-block;background:#fef2f2;color:#dc2626;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:5px 12px;border-radius:999px;">Urgent — needs you now</span></div>`
    : '';

  const triggerBlock = input.matchedTrigger
    ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px;">Trigger: <strong style="color:#1b1b1b;">${escapeHtml(input.matchedTrigger)}</strong>${input.extraDetail ? ` — ${escapeHtml(input.extraDetail)}` : ''}</p>`
    : (input.extraDetail
       ? `<p style="font-size:13px;color:#6b7280;margin:0 0 16px;">${escapeHtml(input.extraDetail)}</p>`
       : '');

  const introBlock = `<p style="color:#374151;font-size:15px;line-height:1.7;margin:0;">${escapeHtml(meta.intro(nameCtx))}</p>`;

  const replyBlock = input.brideReply?.trim()
    ? `<div style="margin:20px 0 0;padding:16px 20px;background:#f9f9f9;border:1px solid #e5e7eb;border-radius:8px;">
         <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:8px;">Her message</div>
         <div style="font-size:14px;color:#1b1b1b;line-height:1.7;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;">${escapeHtml(input.brideReply.slice(0, 500))}</div>
       </div>`
    : '';

  return buildSystemEmail({
    accentColor: '#1b1b1b',
    title:       meta.heading(nameCtx),
    heading:     meta.heading(nameCtx),
    bodyHtml:    `${urgentBadge}${triggerBlock}${introBlock}${replyBlock}`,
    cta:         { label: meta.ctaLabel.replace(/\s*→\s*$/, ''), url: ctaUrl },
    footerHtml:  `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;text-align:center;">AI Concierge alert from ${escapeHtml(venueName)} · sent via StoryVenue</p>`,
  });
}
