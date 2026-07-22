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
  | 'ai';

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
Email: {{lead_email}}
Source: {{lead_source}}

Reach out while they are hot — open their contact to start the conversation.`,
      button_text: 'View Lead',
    },
  },
  {
    key: 'ai_handoff',
    label: 'AI Concierge Handoff',
    description:
      'Sent to the venue owner when the AI Concierge escalates a conversation and needs a human to take over.',
    trigger: 'Fires from `/api/ai/escalate` when the AI triggers a handoff.',
    category: 'ai',
    editable: false,
    defaults: {
      subject: 'Action needed: AI Concierge handed off {{customer_name}} — {{venue_name}}',
      heading: 'AI Concierge Handoff',
      body: `The AI Concierge handed the conversation with {{customer_name}} off to you.

Reason: {{reason}}

Open the conversation to take over and reply.`,
      button_text: 'View Conversation',
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
    lead_source: 'Public listing',
    action_url: `${APP_URL}/dashboard/leads`,
  },
  ai_handoff: {
    customer_name: 'Emily Richardson',
    venue_name: 'Meadowbrook Estate',
    reason: 'Bride expressed strong interest and requested a callback',
    action_url: `${APP_URL}/dashboard/conversations`,
  },
  booking_report: {
    owner_first_name: 'Sarah',
    venue_name: 'Meadowbrook Estate',
    action_url: `${APP_URL}/dashboard/listing`,
  },
};
