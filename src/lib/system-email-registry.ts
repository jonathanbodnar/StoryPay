/**
 * Registry of every system email StoryVenue sends automatically.
 *
 * Each entry describes:
 *   - what the email does (description)
 *   - when/how it fires (trigger + schedule)
 *   - whether a super admin can edit the copy (editable)
 *   - default subject / heading / body / button_text
 *
 * Editable templates are persisted in `system_email_templates` and fall back
 * to these defaults when no override is saved.  Read-only templates are
 * preview-only — copy lives in the individual route files.
 */

export type SystemEmailCategory =
  | 'onboarding'
  | 'reengagement'
  | 'leads'
  | 'auth'
  | 'reporting'
  | 'ai'
  | 'billing';

export interface SystemEmailDef {
  key: string;
  label: string;
  description: string;
  /** Plain-English explanation of when this fires. */
  trigger: string;
  /** Schedule detail (e.g. "11 sends over 90 days"). Only set for drip emails. */
  schedule?: string;
  category: SystemEmailCategory;
  /** True = super admin can edit copy; stored in system_email_templates. */
  editable: boolean;
  defaults: {
    subject: string;
    heading: string;
    body: string;
    button_text?: string;
  };
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com';

export const SYSTEM_EMAIL_REGISTRY: SystemEmailDef[] = [
  // ── Re-engagement drip ──────────────────────────────────────────────────
  {
    key: 'reengagement_drip',
    label: 'Re-engagement Drip',
    description:
      'Sent to venue owners who completed their listing setup (sent a test lead) but never added a credit card. The goal is to bring them back to activate their Bride Booking System.',
    trigger:
      'Fires automatically when a venue sends their test lead without adding a CC. Sends 2× in week 1, then weekly through week 4, then every 10 days until 90 days.',
    schedule:
      'Day 2, Day 5, Day 12, Day 19, Day 26, Day 36, Day 46, Day 56, Day 66, Day 76, Day 86 (11 total). Stops early on login, CC add, or cancellation.',
    category: 'reengagement',
    editable: true,
    defaults: {
      subject: 'Your {{venue_name}} listing is live — brides are searching',
      heading: 'Your listing is live on StoryVenue',
      body: `Hi {{owner_first_name}},

Your {{venue_name}} listing is live and visible to brides searching for venues in your area.

When a bride inquires, you'll get an email — but to reply and start the conversation you'll need to log in and unlock your Bride Booking System.

It only takes a couple of minutes, and your first month is free.`,
      button_text: 'Log in and unlock your system',
    },
  },

  // ── Lead alert (dormant venue) ──────────────────────────────────────────
  {
    key: 'dormant_lead_alert',
    label: 'New Lead Alert (Inactive Listing)',
    description:
      'Sent immediately to a venue owner when a real bride submits an inquiry on their listing, but the venue has not yet unlocked their account. Contact info is intentionally hidden to incentivize login.',
    trigger:
      'Fires every time a new lead is submitted on a listing where the venue has completed setup but not added a CC. One email per lead, sent instantly.',
    category: 'leads',
    editable: true,
    defaults: {
      subject: '{{lead_first_name}} {{lead_last_initial}}. is interested in {{venue_name}}',
      heading: 'You have a new lead',
      body: `Hi {{owner_first_name}},

{{lead_first_name}} {{lead_last_initial}}. just submitted an inquiry on your {{venue_name}} listing on StoryVenue.

To see their full contact information and respond, log in to your account. Responding quickly is the single biggest factor in booking the wedding.

Contact details are waiting for you — log in to unlock them.`,
      button_text: 'Log in to see this lead',
    },
  },

  // ── Onboarding / auth (read-only preview) ──────────────────────────────
  {
    key: 'welcome',
    label: 'Welcome Email',
    description: 'Sent to the venue owner immediately after they create their account.',
    trigger: 'Fires once on signup — `/api/auth/signup`.',
    category: 'onboarding',
    editable: false,
    defaults: {
      subject: 'Welcome to StoryVenue — your account for {{venue_name}} is ready',
      heading: 'Welcome to StoryVenue',
      body: `Hi {{owner_first_name}},

Your StoryVenue account for {{venue_name}} is ready. Finish setting up your listing to start capturing bride inquiries automatically.`,
      button_text: 'Finish your listing setup',
    },
  },
  {
    key: 'login_link',
    label: 'Magic Login Link',
    description: 'Sent whenever a venue owner requests a passwordless login link.',
    trigger: 'Fires on `/api/auth/request-login` when the venue requests a magic link.',
    category: 'auth',
    editable: false,
    defaults: {
      subject: 'Your StoryVenue login link for {{venue_name}}',
      heading: 'Here is your login link',
      body: `Hi,

Click below to log in to your StoryVenue account. This link expires in 15 minutes and can only be used once.`,
      button_text: 'Log in to StoryVenue',
    },
  },
  {
    key: 'password_reset',
    label: 'Password Reset',
    description: 'Sent when a venue owner requests a password reset.',
    trigger: 'Fires on `/api/auth/venue/forgot`.',
    category: 'auth',
    editable: false,
    defaults: {
      subject: 'Reset your StoryVenue password',
      heading: 'Reset your password',
      body: `Hi,

We received a request to reset your StoryVenue password. Click below to choose a new one. The link expires in 1 hour.

If you did not request this, you can safely ignore this email.`,
      button_text: 'Reset my password',
    },
  },
  {
    key: 'team_invite',
    label: 'Team Member Invite',
    description: 'Sent when a venue owner invites a new team member to their account.',
    trigger: 'Fires on `/api/team` when a team invite is created.',
    category: 'onboarding',
    editable: false,
    defaults: {
      subject: 'You have been invited to join {{venue_name}} on StoryVenue',
      heading: 'You are invited',
      body: `Hi,

You have been invited to join {{venue_name}} on StoryVenue. Click below to accept the invitation and set up your access.`,
      button_text: 'Accept invitation',
    },
  },
  {
    key: 'new_lead_notification',
    label: 'New Lead Notification (Active)',
    description:
      'Sent to the venue owner when a new lead is captured on their active listing. This template is also editable per venue in their Settings → Email Templates page.',
    trigger:
      'Fires on every new lead submission via the public listing form, embed form, or API — for venues that have an active subscription.',
    category: 'leads',
    editable: false,
    defaults: {
      subject: 'New lead: {{lead_first_name}} {{lead_last_name}} — {{venue_name}}',
      heading: 'New Lead',
      body: `You have a new lead for {{venue_name}}.

Name: {{lead_first_name}} {{lead_last_name}}
Phone: {{lead_phone}}
Email: {{lead_email}}
Source: {{lead_source}}
Created: {{lead_created_at}}

Reach out while they are hot — open their contact to start the conversation.`,
      button_text: 'View Lead',
    },
  },
  // Entry removed 2026-08-22: `ai_handoff` (generic, non-editable) duplicated
  // the two scenarios directly below on every single handoff — the owner and
  // team were getting emailed + texted twice for the same event. Its trigger
  // note ("fires from /api/ai/escalate") was also stale; that route doesn't
  // exist. The underlying code (owner-notifications.ts's notifyOwnerAiHandoff)
  // is now push-only, so it no longer sends an email to audit here.
  // ── AI Concierge notifications (all editable) ───────────────────────────
  // These fire from the AI Concierge inbound handler / send cron. Variables:
  // {{bride_first_name}}, {{bride_full_name}}, {{venue_name}}. Subject lines
  // always use the full name (never just first name) and never contain
  // emoji/icons. The CTA button always deep-links to the conversation or
  // contact record — button_text only changes its label.
  {
    key: 'ai_handoff_urgent',
    label: 'AI: Urgent Handoff',
    description:
      'Sent to the venue owner + team when a bride replies with something that needs a human immediately (distress, complaint, or an urgent keyword). The AI stops and waits.',
    trigger: 'Fires from the AI inbound handler when an urgent handoff rule matches a reply.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: 'Urgent: {{bride_full_name}} needs human attention — {{venue_name}}',
      heading: '{{bride_first_name}} just sent a message that needs you NOW',
      body: `{{bride_first_name}} replied to one of your AI follow-up messages with something that needs a human in the loop right away. The AI has stopped and is waiting for you to take over.`,
      button_text: 'Open the conversation →',
    },
  },
  {
    key: 'ai_handoff_pricing',
    label: 'AI: Pricing Question Handoff',
    description:
      'Sent when a bride asks the AI about pricing, packages, or rates. The AI never quotes prices, so it hands the conversation to a human.',
    trigger: 'Fires from the AI inbound handler when a pricing keyword or intent matches a reply.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: '{{bride_full_name}} is asking about pricing — {{venue_name}}',
      heading: '{{bride_first_name}} asked about pricing — your concierge should reply',
      body: `{{bride_first_name}} replied to one of your AI follow-up messages asking about pricing, packages, or rates. The AI is intentionally never quoting prices, so it has handed the conversation off so a real person can give her real answers.`,
      button_text: 'Reply to her now →',
    },
  },
  {
    key: 'ai_reply_received',
    label: 'AI: Bride Replied',
    description:
      'Sent when a bride replies to an AI follow-up message. The AI pauses so a human can take over the warm conversation.',
    trigger: 'Fires from the AI inbound handler on any neutral reply while the AI is active.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: '{{bride_full_name}} just replied — {{venue_name}}',
      heading: '{{bride_first_name}} replied to your AI follow-up',
      body: `Great news — {{bride_first_name}} just replied to one of your AI follow-up messages. The AI has paused so a human (you or your team) can take over the conversation. The sooner you respond, the warmer she'll feel.`,
      button_text: 'Reply to her now →',
    },
  },
  {
    key: 'ai_not_interested',
    label: 'AI: Bride Not Interested',
    description:
      'Sent when a bride replies indicating she is no longer interested or has chosen another venue. She is moved to the Not Interested stage and AI stops.',
    trigger: 'Fires from the AI inbound handler when a not-interested keyword or intent matches.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: '{{bride_full_name}} marked herself as not interested — {{venue_name}}',
      heading: '{{bride_first_name}} is no longer interested',
      body: `{{bride_first_name}} replied to your AI follow-up indicating she's no longer interested or has chosen another venue. We've moved her to your "Not Interested" pipeline and stopped all future AI follow-ups for her.`,
      button_text: 'View her contact record →',
    },
  },
  {
    key: 'ai_tcpa_opt_out',
    label: 'AI: SMS Opt-Out (STOP)',
    description:
      'Sent when a bride replies with a TCPA opt-out keyword (STOP, UNSUBSCRIBE). SMS is permanently disabled for her — a legal compliance requirement.',
    trigger: 'Fires from the inbound webhook whenever an opt-out keyword is detected.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: '{{bride_full_name}} opted out of SMS — {{venue_name}}',
      heading: '{{bride_first_name}} replied STOP / UNSUBSCRIBE — SMS disabled',
      body: `{{bride_first_name}} replied with a TCPA opt-out keyword (STOP, UNSUBSCRIBE, etc.). She will not receive any more SMS messages from your account — this is a legal compliance requirement and cannot be undone from the AI side. You can still reach out via email or other channels.`,
      button_text: 'View her contact record →',
    },
  },
  {
    key: 'ai_daily_cap_warning',
    label: 'AI: Daily Cap Warning (80% default)',
    description:
      'Sent to StoryVenue super admins (NOT the venue owner/team) when a venue\'s AI has used 80% of its day\'s outbound SMS budget (80% is the platform default — venues can set their own alert threshold). This is an internal spend-cap guardrail, not something venues need to see.',
    trigger: 'Fires from the AI send cron when the daily spend crosses 80% of the cap.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: "Heads up: AI Concierge is at 80% of today's send cap — {{venue_name}}",
      heading: 'AI Concierge daily cap warning — {{venue_name}}',
      body: `{{venue_name}}'s AI Concierge has used most of today's outbound SMS budget. It'll keep sending until the cap is reached, then pause new sends until tomorrow morning (venue-local time). Raise the venue's cap from the AI Concierge admin panel if they need today's outreach to continue uninterrupted.`,
      button_text: 'Open AI Concierge admin →',
    },
  },
  {
    key: 'ai_daily_cap_reached',
    label: 'AI: Daily Cap Reached',
    description:
      'Sent to StoryVenue super admins (NOT the venue owner/team) when a venue\'s AI hits its day\'s outbound SMS cap. Sends pause until the next morning. Internal spend-cap guardrail, not venue-facing.',
    trigger: 'Fires from the AI send cron when the daily cap is reached.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: "AI Concierge has hit today's send cap — {{venue_name}}",
      heading: 'AI Concierge daily cap reached — {{venue_name}}',
      body: `{{venue_name}}'s AI Concierge has hit today's outbound SMS cap. New sends are paused until tomorrow morning (venue-local time). Inbound replies are unaffected. Raise the venue's cap from the AI Concierge admin panel if needed.`,
      button_text: 'Open AI Concierge admin →',
    },
  },
  {
    key: 'sequence_reply_received',
    label: 'AI: Reply During 14-Day Sequence',
    description:
      'Sent when a bride replies while the 14-day nurture sequence is still running (before the AI activates). A human needs to respond.',
    trigger: 'Fires from the AI inbound handler for leads still in the dormant state.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: '{{bride_full_name}} replied to your follow-up — {{venue_name}}',
      heading: '{{bride_first_name}} replied — time to step in',
      body: `{{bride_first_name}} replied to one of your automated follow-up messages. The AI Concierge hasn't activated yet, so this conversation needs a real person right now. The faster you respond, the warmer she'll feel — don't let this one go cold.`,
      button_text: 'Reply to her now →',
    },
  },
  {
    key: 'ai_exhausted_no_reply',
    label: 'AI: 60-Day Window Complete (No Reply)',
    description:
      'Sent to the venue owner + team when the AI finishes its full 60-day follow-up window without ever getting a reply. The lead is moved to Not Interested.',
    trigger: 'Fires from the AI send cron when a lead passes its 60-day expiry with zero replies.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: '{{bride_full_name}} finished the 60-day follow-up window — {{venue_name}}',
      heading: '{{bride_first_name}} never replied — moved to Not Interested',
      body: `The AI Concierge completed its full 60-day follow-up sequence for {{bride_first_name}} without ever getting a reply. She has been moved to your "Not Interested" pipeline stage and is no longer considered a warm lead. No further automated messages will be sent. If she ever replies in the future, she'll automatically move back to "Conversation Started" and you'll be notified.`,
      button_text: 'View her contact record →',
    },
  },
  {
    key: 'ai_lead_revived',
    label: 'AI: Lead Revived After 60 Days',
    description:
      'Sent when a bride replies after her 60-day window already ended and she had been moved to Not Interested. She is moved back to Conversation Started — a human must take over.',
    trigger: 'Fires from the AI inbound handler when an exhausted lead replies.',
    category: 'ai',
    editable: true,
    defaults: {
      subject: '{{bride_full_name}} came back — she replied after going quiet — {{venue_name}}',
      heading: '{{bride_first_name}} is a warm lead again',
      body: `Great news — {{bride_first_name}} just replied, even though her follow-up window had already ended and she'd been moved to Not Interested. We've moved her back to "Conversation Started" in your pipeline. This is a warm lead — a real person should take over the conversation right now.`,
      button_text: 'Reply to her now →',
    },
  },

  // ── SaaS billing (read-only preview) ────────────────────────────────────
  {
    key: 'billing_trial_ending',
    label: 'Trial Ending Soon',
    description: 'Sent to the venue owner shortly before their free trial converts to a paid subscription.',
    trigger: 'Fires from the billing webhook/cron a few days before trial end.',
    category: 'billing',
    editable: false,
    defaults: {
      subject: 'Your free trial ends {{trial_end_date}} — {{plan_price}}/mo after',
      heading: 'Your free trial is ending soon',
      body: `Hi {{owner_first_name}},

Your Bride Booking System free trial ends {{trial_end_date}}. After that, your card on file will be charged {{plan_price}}/mo. Nothing to do if you want to keep everything running — your leads, sequences, and listing stay live.`,
      button_text: 'Manage billing',
    },
  },
  {
    key: 'billing_payment_received',
    label: 'Payment Received',
    description: 'Receipt email sent to the venue owner when a subscription payment is charged successfully.',
    trigger: 'Fires from the payment webhook on each successful subscription charge.',
    category: 'billing',
    editable: false,
    defaults: {
      subject: 'Payment received — {{amount}} for your Bride Booking System™',
      heading: 'Thanks — your payment went through',
      body: `Hi {{owner_first_name}},

We received your payment of {{amount}} for your Bride Booking System subscription. Your account is in good standing.`,
      button_text: 'View billing',
    },
  },
  {
    key: 'billing_card_declined',
    label: 'Card Declined',
    description: 'Sent to the venue owner when their subscription payment fails so they can update the card before service is affected.',
    trigger: 'Fires from the payment webhook on a failed charge.',
    category: 'billing',
    editable: false,
    defaults: {
      subject: 'Your card was declined — update it to keep your Bride Booking System™',
      heading: 'Action needed: payment failed',
      body: `Hi {{owner_first_name}},

Your latest subscription payment didn't go through. Update your card on file to keep your Bride Booking System active — leads keep coming in either way, but follow-up automations pause if the account lapses.`,
      button_text: 'Update my card',
    },
  },
  {
    key: 'billing_downgraded_free',
    label: 'Downgraded to Free Plan',
    description: 'Sent to the venue owner when their account moves to the Free plan (cancellation or downgrade).',
    trigger: 'Fires when a subscription is cancelled or downgraded to Free.',
    category: 'billing',
    editable: false,
    defaults: {
      subject: "You're on the Free plan",
      heading: 'Your account is now on the Free plan',
      body: `Hi {{owner_first_name}},

Your account has moved to the Free plan. Your listing stays live and you'll still receive lead alerts, but automated follow-up and premium features are paused. You can re-activate anytime from your billing page.`,
      button_text: 'View plans',
    },
  },

  // ── Miscellaneous (read-only preview) ───────────────────────────────────
  {
    key: 'couple_password_reset',
    label: 'Couple Password Reset',
    description: 'Sent when a couple (bride/groom portal user) requests a password reset.',
    trigger: 'Fires on `/api/auth/couple/forgot`.',
    category: 'auth',
    editable: false,
    defaults: {
      subject: 'Reset your password',
      heading: 'Reset your password',
      body: `Hi,

We received a request to reset your password. Click below to choose a new one. If you did not request this, you can safely ignore this email.`,
      button_text: 'Reset my password',
    },
  },
  {
    key: 'admin_login_link',
    label: 'Admin-Sent Login Link',
    description: 'Magic login link sent to a venue owner by a super admin from the Venue Management page ("Send invite").',
    trigger: 'Fires when a super admin clicks "Send invite" on a venue card.',
    category: 'auth',
    editable: false,
    defaults: {
      subject: 'Your StoryVenue login link for {{venue_name}}',
      heading: 'Log in to your StoryVenue account',
      body: `Hi,

Here's your one-click login link for {{venue_name}} on StoryVenue. It expires after use — request a new one anytime from the login page.`,
      button_text: 'Log in now',
    },
  },
  {
    key: 'admin_otp',
    label: 'Admin Login Code (OTP)',
    description: 'Sent to the super admin when they log in to the StoryVenue admin area. Contains a 6-digit one-time code valid for 10 minutes.',
    trigger: 'Fires on every successful super admin password entry at /api/admin/login.',
    category: 'auth',
    editable: true,
    defaults: {
      subject: 'Your StoryVenue admin login code',
      heading: 'Your admin login code',
      body: `Use the code below to complete your StoryVenue admin sign-in. It expires in 10 minutes.

{{otp_code}}

If you didn't request this, you can safely ignore this email.`,
      button_text: undefined,
    },
  },
  {
    key: 'admin_created_venue_welcome',
    label: 'Admin-Created Venue Welcome',
    description: 'Welcome email sent when a super admin creates a venue account on someone\'s behalf.',
    trigger: 'Fires when a super admin creates a new venue from the admin panel.',
    category: 'onboarding',
    editable: false,
    defaults: {
      subject: 'Your {{venue_name}} account on StoryVenue is ready',
      heading: 'Welcome to StoryVenue',
      body: `Hi {{owner_first_name}},

We've set up a StoryVenue account for {{venue_name}}. Use the button below to log in and take a look around — your listing, leads, and follow-up tools are all in one place.`,
      button_text: 'Log in to my account',
    },
  },
  {
    key: 'booking_report',
    label: 'Monthly Booking Report',
    description:
      'A monthly email sent to the venue owner (or scheduled recipient list) with a summary of their Bride Booking System analytics as a PDF attachment.',
    trigger:
      'Fires on a monthly schedule via the booking report cron, or immediately when the venue clicks "Export Report" in their dashboard.',
    schedule: 'Monthly on the day the venue enables it, or on demand.',
    category: 'reporting',
    editable: false,
    defaults: {
      subject: 'Your monthly Bride Booking System report — {{venue_name}}',
      heading: 'Your monthly report is attached',
      body: `Hi {{owner_first_name}},

Your Bride Booking System report for {{venue_name}} is attached as a PDF.

It covers your lead funnel, booking analytics, and engagement metrics for the last 30 days.`,
      button_text: 'Open your dashboard',
    },
  },
];

export const SYSTEM_EMAIL_BY_KEY: Record<string, SystemEmailDef> = Object.fromEntries(
  SYSTEM_EMAIL_REGISTRY.map((e) => [e.key, e]),
);

export const CATEGORY_LABELS: Record<SystemEmailCategory, string> = {
  onboarding: 'Onboarding & Auth',
  reengagement: 'Re-engagement',
  leads: 'Lead Alerts',
  auth: 'Authentication',
  reporting: 'Reporting',
  ai: 'AI Concierge',
  billing: 'Billing',
};

/** Sample variables for test sends and browser previews. */
export const SYSTEM_EMAIL_SAMPLE_VARS: Record<string, Record<string, string>> = {
  reengagement_drip: {
    owner_first_name: 'Sarah',
    venue_name: 'Meadowbrook Estate',
    action_url: `${APP_URL}/dashboard`,
  },
  dormant_lead_alert: {
    owner_first_name: 'Sarah',
    venue_name: 'Meadowbrook Estate',
    lead_first_name: 'Emily',
    lead_last_initial: 'R',
    action_url: `${APP_URL}/dashboard`,
  },
  welcome: {
    owner_first_name: 'Sarah',
    venue_name: 'Meadowbrook Estate',
    action_url: `${APP_URL}/dashboard`,
  },
  login_link: {
    owner_first_name: 'Sarah',
    action_url: `${APP_URL}/login`,
  },
  password_reset: {
    action_url: `${APP_URL}/reset-password/venue`,
  },
  team_invite: {
    venue_name: 'Meadowbrook Estate',
    action_url: `${APP_URL}/invite/example`,
  },
  new_lead_notification: {
    venue_name: 'Meadowbrook Estate',
    lead_first_name: 'Emily',
    lead_last_name: 'Richardson',
    lead_email: 'emily@example.com',
    lead_phone: '(555) 123-4567',
    lead_source: 'Public listing',
    lead_created_at: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' at ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    action_url: `${APP_URL}/dashboard/leads`,
  },
  booking_report: {
    owner_first_name: 'Sarah',
    venue_name: 'Meadowbrook Estate',
    action_url: `${APP_URL}/dashboard/listing`,
  },
  // AI Concierge scenarios all share the same variable set.
  ...Object.fromEntries(
    [
      'ai_handoff_urgent', 'ai_handoff_pricing', 'ai_reply_received',
      'ai_not_interested', 'ai_tcpa_opt_out', 'ai_daily_cap_warning',
      'ai_daily_cap_reached', 'sequence_reply_received',
      'ai_exhausted_no_reply', 'ai_lead_revived',
    ].map((key) => [key, {
      bride_first_name: 'Emily',
      bride_full_name: 'Emily Carter',
      venue_name: 'Meadowbrook Estate',
      action_url: `${APP_URL}/dashboard/conversations`,
    }]),
  ),
  billing_trial_ending: {
    owner_first_name: 'Sarah',
    trial_end_date: 'August 5',
    plan_price: '$97',
    action_url: `${APP_URL}/dashboard/directory-billing`,
  },
  billing_payment_received: {
    owner_first_name: 'Sarah',
    amount: '$97.00',
    action_url: `${APP_URL}/dashboard/directory-billing`,
  },
  billing_card_declined: {
    owner_first_name: 'Sarah',
    action_url: `${APP_URL}/dashboard/directory-billing`,
  },
  billing_downgraded_free: {
    owner_first_name: 'Sarah',
    action_url: `${APP_URL}/dashboard/directory-billing`,
  },
  couple_password_reset: {
    action_url: `${APP_URL}/reset-password/couple`,
  },
  admin_login_link: {
    venue_name: 'Meadowbrook Estate',
    action_url: `${APP_URL}/login`,
  },
  admin_otp: {
    otp_code: '847291',
  },
  admin_created_venue_welcome: {
    owner_first_name: 'Sarah',
    venue_name: 'Meadowbrook Estate',
    action_url: `${APP_URL}/dashboard`,
  },
};
