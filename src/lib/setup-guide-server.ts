/**
 * The database side of the Setup Guide (rules in setup-guide.ts): what exists
 * for a venue, which steps that makes done, and the video links the admin set.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { loadDirectoryNavAccess } from '@/lib/directory-plans-venue';
import { leadFinderEnabledForSlug } from '@/lib/leadfinder/address';
import {
  setupGuideIsGuided, setupGuideVideos, setupLessonsFor,
  type SetupLessonId,
} from '@/lib/setup-guide';

/** Where Admin → Setup guide keeps its video links ({ lessonId: url }). */
export const SETUP_GUIDE_VIDEOS_KEY = 'setup-guide:videos';

/** Lead sources that mean the venue's own website form produced the lead. */
const WEB_FORM_SOURCES = ['embed', 'webform', 'web_form', 'form'];

const DIRECTORY_URL = (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');

export interface SetupGuideState {
  /** Wizard finished and the viewer runs the venue: the guide is theirs to use. */
  eligible: boolean;
  /** Being walked through it: the card shows on the dashboard home. */
  guided: boolean;
  /** Open by itself after this sign-in (the dashboard still waits a few seconds). */
  autoOpen: boolean;
  complete: boolean;
  done: number;
  total: number;
  lessons: Array<{ id: SetupLessonId; done: boolean }>;
  /** Player addresses by lesson, for the lessons that have a video. */
  videos: Partial<Record<SetupLessonId, string>>;
  listingUrl: string | null;
}

export async function loadSetupGuideVideoLinks(): Promise<Record<string, unknown>> {
  const { data } = await supabaseAdmin
    .from('admin_kv_cache')
    .select('value')
    .eq('key', SETUP_GUIDE_VIDEOS_KEY)
    .maybeSingle();
  const value = (data as { value?: unknown } | null)?.value;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export async function loadSetupGuide(
  venueId: string,
  viewer: { canManage: boolean; impersonating: boolean },
): Promise<SetupGuideState | null> {
  const { data: row } = await supabaseAdmin
    .from('venues')
    .select(
      'slug, created_at, is_published, onboarding_completed_at, onboarding_steps_completed, onboarding_checklist_dismissed, ' +
      'is_private_client, lead_link_links, lead_link_slug, stripe_charges_enabled, directory_plan_id',
    )
    .eq('id', venueId)
    .maybeSingle();
  if (!row) return null;
  const venue = row as unknown as {
    slug: string | null;
    created_at: string | null;
    is_published: boolean | null;
    onboarding_completed_at: string | null;
    onboarding_steps_completed: unknown;
    onboarding_checklist_dismissed: boolean | null;
    is_private_client: boolean | null;
    lead_link_links: unknown;
    lead_link_slug: string | null;
    stripe_charges_enabled: boolean | null;
    directory_plan_id: string | null;
  };

  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const [guide, webLeads, forms, leadFinderMail, nav, videoLinks] = await Promise.all([
    supabaseAdmin.from('venue_pricing_guides').select('enabled').eq('venue_id', venueId).maybeSingle(),
    count(supabaseAdmin.from('leads').select('id', { count: 'exact', head: true }).eq('venue_id', venueId).in('source', WEB_FORM_SOURCES)),
    count(supabaseAdmin.from('marketing_forms').select('id', { count: 'exact', head: true }).eq('venue_id', venueId)),
    count(supabaseAdmin.from('leadfinder_imports').select('id', { count: 'exact', head: true }).eq('venue_id', venueId)),
    loadDirectoryNavAccess(venueId, venue.directory_plan_id),
    loadSetupGuideVideoLinks(),
  ]);

  const privateClient = venue.is_private_client === true;
  const lessons = setupLessonsFor({
    facts: {
      published: venue.is_published === true,
      guideEnabled: (guide.data as { enabled?: boolean | null } | null)?.enabled === true,
      leadLinkSet:
        Boolean(venue.lead_link_slug?.trim()) ||
        (Array.isArray(venue.lead_link_links) && venue.lead_link_links.length > 0),
      webFormLive: webLeads > 0 || forms > 0,
      leadFinderMail: leadFinderMail > 0,
      stripeReady: venue.stripe_charges_enabled === true,
    },
    stepsCompleted: venue.onboarding_steps_completed,
    allowedNavIds: nav.allowedNavIds,
    leadFinderAvailable: leadFinderEnabledForSlug(venue.slug),
    privateClient,
  });

  const done = lessons.filter((l) => l.done).length;
  const complete = lessons.length > 0 && done === lessons.length;
  // The wizard still owns the dashboard until the listing is published.
  const wizardDone = Boolean(venue.onboarding_completed_at) || venue.is_published === true;

  const guided = setupGuideIsGuided({
    complete,
    wizardDone,
    createdAt: venue.created_at,
    popupOff: venue.onboarding_checklist_dismissed === true,
    privateClient,
    canManage: viewer.canManage,
  });

  return {
    eligible: viewer.canManage && wizardDone,
    guided,
    // An admin viewing as the venue sees its dashboard, not its pop-up.
    autoOpen: guided && !viewer.impersonating,
    complete,
    done,
    total: lessons.length,
    lessons,
    videos: setupGuideVideos(videoLinks),
    listingUrl: venue.slug ? `${DIRECTORY_URL}/venue/${venue.slug}` : null,
  };
}
