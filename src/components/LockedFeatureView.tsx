'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, X, ArrowRight, Sparkles } from 'lucide-react';

/**
 * Visual + copy primitives for "this feature isn't included in your current
 * plan" UX. Used in three places:
 *
 *   1. Sidebar — clicking a locked menu item opens `<LockedFeatureModal>`.
 *   2. Direct URL access — `<DirectoryRouteGuard>` renders
 *      `<LockedFeatureOverlay>` on top of blurred page content so the
 *      user can see what they're missing and is motivated to upgrade.
 *   3. Legacy fallback — `<LockedFeatureScreen>` kept for any edge cases.
 */

// ─── Per-feature outcome copy ─────────────────────────────────────────────

interface FeatureOutcome {
  /** Short benefit headline shown above the outcome paragraph. */
  headline: string;
  /** 1–2 sentence outcome written in benefit-first marketing language. */
  outcome: string;
  /** Optional note about which plan or add-on unlocks this feature. */
  upgradeNote?: string;
}

const FEATURE_OUTCOMES: Record<string, FeatureOutcome> = {
  nav_main_ai: {
    headline: 'Instant answers, zero wait time',
    outcome:
      'Ask AI reads your live account data — revenue, leads, proposals — and gives you exact answers in seconds. No ticket, no waiting, no hunting.',
  },
  nav_main_contacts: {
    headline: 'Every couple in one place',
    outcome:
      'Stop hunting across apps. Every note, payment, task, document, and conversation for every couple lives on one profile your whole team can access.',
  },
  nav_main_conversations: {
    headline: 'One inbox for every conversation',
    outcome:
      'Two-way SMS and email in a single iMessage-style thread per couple. Replies land in real time — no more missed messages buried in your phone.',
  },
  nav_main_calendar: {
    headline: 'Zero double-bookings, forever',
    outcome:
      'See every wedding, tour, tasting, and hold across all your spaces at a glance. Syncs with Google Calendar, Calendly, and iCal automatically.',
  },
  nav_main_leads: {
    headline: 'See every deal in your pipeline',
    outcome:
      'Drag-and-drop Kanban shows exactly where every couple is — Lead, Tour Booked, Proposal Sent, Booked. Know your pipeline value in dollars, not just stages.',
  },
  nav_main_media: {
    headline: 'One library for all your assets',
    outcome:
      'Brand logo, listing photos, email images, proposal attachments — all in one place. Upload once, use everywhere. No re-uploading, no broken links.',
  },
  nav_main_reports: {
    headline: 'Tax season in a day, not a week',
    outcome:
      'Revenue, AR Aging, Refunds, Bank Reconciliation, and 3 more reports — download as CSV, Excel, or PDF. Hand your accountant a clean file.',
  },
  nav_listing_pricing_guide: {
    headline: 'Always-current pricing couples can share',
    outcome:
      'Auto-generated branded PDF of your pricing, availability, and policies. One link always serves the latest version — no more outdated PDFs floating around.',
  },
  nav_listing_booking_system: {
    headline: 'Your follow-up fires before you wake up',
    outcome:
      'New inquiry at 2am? A welcome email, follow-up SMS, and AI cadence launch automatically. Build the sequence once — it runs for every couple, forever.',
  },
  nav_listing_analytics: {
    headline: 'See who\'s looking at your venue right now',
    outcome:
      'Live map of visitors on your listing, plus 30/60/90-day view and impression charts. Know which cities couples are traveling from and when your listing peaks.',
  },
  nav_listing_reviews: {
    headline: 'Social proof that fills your calendar',
    outcome:
      'Collect, approve, and display star ratings and testimonials on your listing. Reviews build trust with couples before they ever contact you.',
  },
  nav_listing_directory: {
    headline: 'Stand out in every search result',
    outcome:
      'Verified and Sponsored badges put your venue at the top of couples\' searches on storyvenue.com. More visibility means more inquiries without more ad spend.',
  },
  nav_payments_new: {
    headline: 'Get paid before the tour is over',
    outcome:
      'Create a proposal or invoice and collect a deposit in under two minutes. Stop chasing checks — couples pay online the moment they decide.',
  },
  nav_offerings: {
    headline: 'Build proposals in minutes, not hours',
    outcome:
      'Save your services and packages as reusable line items. Add them to any proposal with one click — no retyping the same items every single time.',
  },
  nav_payments_coupons: {
    headline: 'Run promotions without manual work',
    outcome:
      'Create discount codes with expiry dates and usage limits. Couples apply them at checkout — you just watch bookings come in.',
  },
  nav_payments_proposals: {
    headline: 'Proposals couples sign in one click',
    outcome:
      'Send a branded proposal, get it e-signed, and collect payment — all without a separate DocuSign account or PDF. Close bookings 10x faster.',
  },
  nav_proposals_hub: {
    headline: 'Your best proposal, reused every time',
    outcome:
      'Build a proposal template once with your standard packages, terms, and branding. Every new client starts from a polished, consistent foundation.',
  },
  nav_payments_installments: {
    headline: 'Remove price objections forever',
    outcome:
      'Split any booking into automatic scheduled payments. The couple\'s card charges on your schedule — no manual follow-up, no awkward reminders.',
  },
  nav_payments_subscriptions: {
    headline: 'Predictable recurring revenue',
    outcome:
      'Set up weekly, monthly, or annual recurring billing that runs without any manual action. Turn one-time clients into dependable revenue.',
  },
  nav_transactions: {
    headline: 'Know your number in real time',
    outcome:
      'Every payment, refund, and fee in one ledger. Filter by date, search by client — always know exactly what\'s cleared and what\'s pending.',
  },
  nav_payments_settings: {
    headline: 'Total control over how you get paid',
    outcome:
      'Enable ACH, set processing fee pass-through, and manage your StoryPay merchant account. Keep more of every booking.',
  },
  nav_marketing_analytics: {
    headline: 'Know what\'s actually filling your calendar',
    outcome:
      'Track campaign opens, clicks, and pipeline value per source. See which referral channels drive booked revenue — and double down on what works.',
  },
  nav_marketing_email_campaigns: {
    headline: 'Reach your whole list in minutes',
    outcome:
      'Drag-and-drop email builder, mobile-responsive, fully branded. Send to any segment with merge variables that make every email feel personal.',
  },
  nav_marketing_email_segments: {
    headline: 'Send the right message to the right couple',
    outcome:
      'Build reusable audience segments by tag, pipeline stage, or wedding date. Stop blasting everyone — target couples who are actually in-market.',
  },
  nav_settings_notifications: {
    headline: 'Every automated email, perfectly on-brand',
    outcome:
      'Customize every transactional email — proposals, invoices, payment confirmations, reminders. Your venue\'s voice, not a generic template.',
  },
  nav_marketing_form_builder: {
    headline: 'Capture inquiries from anywhere',
    outcome:
      'Build a branded inquiry form that embeds in any website with one line of code. New submissions create contacts and fire your follow-up sequence instantly.',
  },
  nav_marketing_email_automations: {
    headline: 'Sequences that run themselves',
    outcome:
      'Visual drag-and-drop workflow builder. A new inquiry triggers emails, SMS, waits, and AI follow-up automatically — no manual work required ever.',
  },
  nav_marketing_trigger_links: {
    headline: 'Turn every link click into a workflow',
    outcome:
      'Trackable links that fire automations the moment a couple clicks. Pricing guide downloaded? Tour confirmed? Trigger the right follow-up automatically.',
  },
  nav_marketing_ai_concierge: {
    headline: 'AI follows up so you don\'t have to',
    outcome:
      'Personalized SMS messages sent on your behalf, on a 1–2 day randomized cadence, for up to 60 days. AI stops the moment a couple replies — then you take over.',
    upgradeNote:
      'Included in All-Inclusive.',
  },
  nav_marketing_email_settings: {
    headline: 'Send email from your own domain',
    outcome:
      'Configure your verified sending domain so every outbound email comes from your venue address — not a generic SaaS domain. Couples see your brand.',
  },
  nav_settings_push: {
    headline: 'Know the moment anything happens',
    outcome:
      'Browser push alerts for new payments, signed proposals, new leads, and messages — even when the dashboard is closed. No more refreshing your inbox.',
  },
  nav_settings_branding: {
    headline: 'Your brand on every touchpoint',
    outcome:
      'Upload your logo, set your brand colors, and configure social links. They flow automatically into every proposal, email, and client-facing page.',
  },
  nav_settings_integrations: {
    headline: 'Connect the tools you already use',
    outcome:
      'Sync with QuickBooks, FreshBooks, Google Calendar, Calendly, and GoHighLevel. One platform that talks to everything — no manual data entry.',
  },
  nav_settings_team: {
    headline: 'Bring your team in without losing control',
    outcome:
      'Invite staff as Owner, Admin, or Member. Each role sees exactly what they need. Hide revenue data from anyone who shouldn\'t see it.',
  },
  nav_listing_dashboard: {
    headline: 'Get found by couples searching right now',
    outcome:
      'Your public profile on storyvenue.com — photos, description, capacity, availability, and map. Publishable with one toggle. No developer needed.',
  },
};

const DEFAULT_OUTCOME: FeatureOutcome = {
  headline: 'Unlock more with your plan',
  outcome:
    'This feature is part of a higher-tier plan. Upgrade to unlock it and get more out of StoryVenue.',
};

function getOutcome(navId?: string): FeatureOutcome {
  return (navId && FEATURE_OUTCOMES[navId]) || DEFAULT_OUTCOME;
}

// ─── Shared body ─────────────────────────────────────────────────────────

export interface LockedFeatureBodyProps {
  featureName?: string;
  featureDescription?: string;
  requiredTier?: string;
  /** Nav id used to look up feature-specific outcome copy. */
  navId?: string;
  /** Called when the upgrade button is clicked — use to close a parent modal. */
  onNavigate?: () => void;
}

function LockedFeatureBody({ featureName, navId, onNavigate }: LockedFeatureBodyProps) {
  const copy = getOutcome(navId);

  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg">
        <Lock size={22} />
      </div>

      <p className="text-xs font-semibold uppercase tracking-widest text-violet-500 mb-1">
        {featureName ?? 'Locked feature'}
      </p>

      <h2 className="font-heading text-2xl text-gray-900">
        {copy.headline}
      </h2>

      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-gray-600">
        {copy.outcome}
      </p>

      {copy.upgradeNote && (
        <p className="mx-auto mt-2 max-w-sm text-sm text-violet-600 font-medium">
          {copy.upgradeNote}
        </p>
      )}

      <div className="mt-6 flex flex-col items-center justify-center gap-3">
        <Link
          href="/dashboard/directory-billing"
          onClick={onNavigate}
          className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          <Sparkles size={14} />
          View plans &amp; upgrade
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

// ─── Modal (sidebar click) ────────────────────────────────────────────────

export function LockedFeatureModal({
  open,
  onClose,
  ...body
}: Omit<LockedFeatureBodyProps, 'onNavigate'> & {
  open: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <LockedFeatureBody {...body} onNavigate={onClose} />
      </div>
    </div>,
    document.body,
  );
}

// ─── Blurred overlay (direct URL access) ─────────────────────────────────
// Renders page content blurred behind the upgrade card so users can see
// what they're missing and feel motivated to upgrade.

export function LockedFeatureOverlay({
  children,
  ...body
}: LockedFeatureBodyProps & { children: React.ReactNode }) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Blurred page preview — aria-hidden so screen readers skip it */}
      <div
        aria-hidden
        className="pointer-events-none select-none"
        style={{ filter: 'blur(7px)', opacity: 0.55 }}
      >
        {children}
      </div>

      {/* Upgrade card — centered over the blurred content */}
      <div className="absolute inset-0 flex items-start justify-center pt-20 px-4">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white/95 p-10 shadow-2xl backdrop-blur-sm">
          <LockedFeatureBody {...body} />
        </div>
      </div>
    </div>
  );
}

// ─── Inline page replacement (legacy / edge-case fallback) ───────────────

export function LockedFeatureScreen(props: LockedFeatureBodyProps) {
  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-10 sm:p-12">
        <LockedFeatureBody {...props} />
      </div>
    </div>
  );
}
