/**
 * A new lead goes on to the venue's connected systems, however it came in:
 * Tripleseat and Event Temple when they're connected, and the "lead created"
 * event that Zapier (and any other webhook a venue sets up) listens for.
 *
 * Owner's call, Oct 2: every lead, whether from the website, the directory, a
 * form, a forwarded email, Zapier or the API, a Calendly booking, StoryVenue
 * support or added by hand. Not test inquiries, bulk imports or migrations.
 *
 * Fire-and-forget: never throws and never holds up the caller.
 */
import { dispatchIntegrationEvent } from '@/lib/integration-events';

export interface NewLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  created_at?: string | null;
  wedding_date?: string | null;
  guest_count?: number | null;
  message?: string | null;
  booking_timeline?: string | null;
  venue_matters?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
}

export function handOffNewLead(
  venueId: string,
  lead: NewLead,
  opts: {
    /** false when the caller already pushed it to Tripleseat / Event Temple. */
    crms?: boolean;
    /** false when the caller already sent its own "lead created" event. */
    webhook?: boolean;
  } = {},
): void {
  const crmLead = {
    first_name: lead.first_name,
    last_name: lead.last_name,
    email: lead.email,
    phone: lead.phone,
    wedding_date: lead.wedding_date ?? null,
    guest_count: lead.guest_count ?? null,
    message: lead.message ?? null,
    booking_timeline: lead.booking_timeline ?? null,
    venue_matters: lead.venue_matters ?? null,
    utm_source: lead.utm_source ?? null,
    utm_medium: lead.utm_medium ?? null,
    utm_campaign: lead.utm_campaign ?? null,
    utm_term: lead.utm_term ?? null,
    utm_content: lead.utm_content ?? null,
  };

  if (opts.crms !== false) {
    void import('@/lib/tripleseat')
      .then(({ maybePushLeadToTripleseat }) => maybePushLeadToTripleseat(venueId, crmLead))
      .catch((e) => console.warn('[new-lead] Tripleseat hand-off failed:', e instanceof Error ? e.message : e));
    void import('@/lib/eventtemple')
      .then(({ maybePushLeadToEventTemple }) => maybePushLeadToEventTemple(venueId, crmLead))
      .catch((e) => console.warn('[new-lead] Event Temple hand-off failed:', e instanceof Error ? e.message : e));
  }

  if (opts.webhook !== false) {
    const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
    void dispatchIntegrationEvent(venueId, 'lead.created', {
      lead: {
        id: lead.id,
        first_name: lead.first_name ?? '',
        last_name: lead.last_name ?? '',
        full_name: fullName || lead.email || lead.phone || '',
        email: lead.email ?? '',
        phone: lead.phone ?? '',
        wedding_date: lead.wedding_date ?? null,
        guest_count: lead.guest_count ?? null,
        message: lead.message ?? null,
        source: lead.source,
        created_at: lead.created_at ?? new Date().toISOString(),
      },
    }).catch((e) => console.warn('[new-lead] lead.created event failed:', e instanceof Error ? e.message : e));
  }
}
