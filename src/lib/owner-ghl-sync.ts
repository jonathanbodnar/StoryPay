/**
 * Platform-owner GHL sync + alerts.
 *
 * DISTINCT from `owner-notifications.ts` (which notifies each VENUE OWNER about
 * their own events using the venue's own GHL creds). This module is about the
 * PLATFORM owner — the person running StoryVenue — who wants:
 *
 *   1. Every SaaS venue (their customers) pushed as a contact into THEIR OWN
 *      GHL sub-account, one-way (SaaS → GHL), so they have one accurate list to
 *      build automations on.
 *   2. An SMS to themselves every time a new venue listing goes live.
 *
 * All sends use the owner's GHL sub-account, configured via env (never hardcode
 * the token):
 *
 *   OWNER_GHL_LOCATION_ID  — the owner's StoryVenue GHL sub-account/location id
 *   OWNER_GHL_PIT_TOKEN    — a Private Integration Token (pit-*) for that sub-account
 *   OWNER_ALERT_PHONE      — the owner's cell (E.164 or US 10-digit) that alerts text to
 *
 * Everything here is best-effort and never throws — the caller's primary flow
 * (e.g. onboarding publish) must never be blocked or failed by a sync issue.
 */

import { supabaseAdmin } from '@/lib/supabase';
import {
  addContactTags,
  createOpportunity,
  fetchPipelines,
  findOrCreateContact,
  normalizePhone,
  sendSms,
  updateOpportunityStage,
} from '@/lib/ghl';
import { choseFreePlan, choseProPlan, type VenueFunnelState } from '@/lib/funnel-stage';

const DIRECTORY_URL = (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');

/**
 * The owner's dedicated "SaaS Clients" pipeline. The pipeline id is NOT a
 * secret (unlike the PIT token), so it's a plain constant, overridable via
 * OWNER_GHL_PIPELINE_ID for other environments.
 */
const OWNER_GHL_PIPELINE_ID = (process.env.OWNER_GHL_PIPELINE_ID || 'aNF35LVcuD2AmV347ayK').trim();

/** Tag applied to every synced SaaS venue contact in the owner's GHL. */
const OWNER_GHL_TAG = 'saas-client';

/**
 * Lifecycle stages in the owner's "SaaS Clients" pipeline. Resolved to GHL
 * stage IDs by NAME at runtime (see resolveOwnerPipeline) so the owner can
 * reorder/rename with no code change as long as these display names match.
 *
 * NOTE: this MUST match the live GHL stage name exactly (case-insensitive).
 * The pipeline stage is named "Paid Listing" in GHL — it was originally
 * built against "Pro Listing" and silently broken (resolveOwnerPipeline
 * requires ALL names to match, so a mismatch on this stage was skipping
 * opportunity placement for every venue, not just paid ones) until this
 * name was corrected.
 *
 * "Payment Failed" is its own stage, distinct from "Paid Listing" — a venue
 * whose recurring charge failed (directory_subscription_status='past_due')
 * moves here instead of silently staying lumped in with paying customers.
 *
 * "Cancelled" is also its own stage (GHL has one) — a venue whose
 * subscription was cancelled moves here instead of falling through to
 * "New Listing" (which is what happened before, since cancelling clears
 * directory_subscription_external_id).
 */
const STAGE_NAMES = [
  'New Listing',
  'Trial Started',
  'Free Listing',
  'Paid Listing',
  'Payment Failed',
  'Cancelled',
] as const;
type StageName = (typeof STAGE_NAMES)[number];

interface OwnerGhlConfig {
  locationId: string;
  token: string;
  /** May be empty — owner-GHL push still works, only the self-SMS needs it. */
  alertPhone: string | null;
}

/**
 * Read the owner's GHL config from env. Returns null when the two required
 * values (location id + token) aren't set, so callers become clean no-ops in
 * environments where the integration isn't configured.
 */
export function getOwnerGhlConfig(): OwnerGhlConfig | null {
  const locationId = (process.env.OWNER_GHL_LOCATION_ID || '').trim();
  const token = (process.env.OWNER_GHL_PIT_TOKEN || '').trim();
  if (!locationId || !token) return null;
  const alertPhone = normalizePhone(process.env.OWNER_ALERT_PHONE || '') || null;
  return { locationId, token, alertPhone };
}

export function isOwnerGhlConfigured(): boolean {
  return getOwnerGhlConfig() !== null;
}

interface VenueSyncRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  slug: string | null;
  city: string | null;
  state: string | null;
  owner_ghl_contact_id: string | null;
  owner_ghl_opportunity_id: string | null;
  // Lifecycle columns for funnel-stage → pipeline-stage mapping (mirrors funnel-data.ts).
  directory_subscription_status: string | null;
  directory_subscription_external_id: string | null;
  directory_card_on_file: boolean | null;
  // Last-synced snapshot so the periodic reconciler can skip venues whose
  // target stage/status hasn't changed since the last successful sync
  // instead of round-tripping GHL for all 80+ venues on every run.
  owner_ghl_synced_stage: string | null;
  owner_ghl_synced_status: string | null;
}

const VENUE_SYNC_COLUMNS =
  'id, name, email, phone, owner_first_name, owner_last_name, slug, city, state, owner_ghl_contact_id, owner_ghl_opportunity_id, directory_subscription_status, directory_subscription_external_id, directory_card_on_file, owner_ghl_synced_stage, owner_ghl_synced_status';

async function loadVenueForSync(venueId: string): Promise<VenueSyncRow | null> {
  const { data, error } = await supabaseAdmin
    .from('venues')
    .select(VENUE_SYNC_COLUMNS)
    .eq('id', venueId)
    .maybeSingle();
  if (error) {
    console.warn('[owner-ghl-sync] loadVenueForSync failed:', error.message);
    return null;
  }
  return (data as VenueSyncRow | null) ?? null;
}

/**
 * Derive the contact name for a venue inside the owner's CRM. Prefer the
 * owner's real name; fall back to the venue name so the contact is never blank.
 */
function venueContactName(v: VenueSyncRow): { firstName: string; lastName: string } {
  const first = (v.owner_first_name ?? '').trim();
  const last = (v.owner_last_name ?? '').trim();
  if (first || last) return { firstName: first || (v.name ?? 'Venue'), lastName: last };
  // No owner name — use the venue name as the first name.
  return { firstName: (v.name ?? '').trim() || 'Venue', lastName: '' };
}

// ── Pipeline / stage resolution (cached per process run) ────────────────────

interface ResolvedOwnerPipeline {
  pipelineId: string;
  /** Stage display name → GHL pipelineStageId. */
  stageIds: Record<StageName, string>;
}

/** Successful resolution is cached for the life of the process. */
let resolvedOwnerPipeline: ResolvedOwnerPipeline | null = null;
/** In-flight resolution so concurrent syncs share one fetch (failures are NOT cached — next sync retries). */
let ownerPipelineInFlight: Promise<ResolvedOwnerPipeline | null> | null = null;

/**
 * Fetch the owner's "SaaS Clients" pipeline and resolve the four lifecycle
 * stage IDs by NAME (case-insensitive, trimmed). Returns null (and logs a
 * clear error) if the pipeline or any required stage can't be matched, so the
 * caller keeps doing the contact + tag sync and just skips opportunity work.
 */
async function resolveOwnerPipeline(cfg: OwnerGhlConfig): Promise<ResolvedOwnerPipeline | null> {
  if (resolvedOwnerPipeline) return resolvedOwnerPipeline;
  if (ownerPipelineInFlight) return ownerPipelineInFlight;

  ownerPipelineInFlight = (async () => {
    try {
      const pipelines = await fetchPipelines(cfg.token, cfg.locationId);
      const pipeline = pipelines.find((p) => p.id === OWNER_GHL_PIPELINE_ID);
      if (!pipeline) {
        console.error(
          `[owner-ghl-sync] pipeline ${OWNER_GHL_PIPELINE_ID} not found in owner GHL location ${cfg.locationId}. ` +
            `Available: [${pipelines.map((p) => `${p.name}=${p.id}`).join(', ')}]. Skipping opportunity placement.`,
        );
        return null;
      }

      const stageIds = {} as Record<StageName, string>;
      for (const name of STAGE_NAMES) {
        const target = name.trim().toLowerCase();
        const stage = pipeline.stages.find((s) => (s.name ?? '').trim().toLowerCase() === target);
        if (!stage) {
          console.error(
            `[owner-ghl-sync] stage "${name}" not found in pipeline "${pipeline.name}" (${pipeline.id}). ` +
              `Available stages: [${pipeline.stages.map((s) => s.name).join(', ')}]. Skipping opportunity placement.`,
          );
          return null;
        }
        stageIds[name] = stage.id;
      }

      resolvedOwnerPipeline = { pipelineId: pipeline.id, stageIds };
      console.log('[owner-ghl-sync] resolved owner pipeline stages:', JSON.stringify(resolvedOwnerPipeline));
      return resolvedOwnerPipeline;
    } catch (err) {
      console.error(
        '[owner-ghl-sync] resolveOwnerPipeline failed:',
        err instanceof Error ? err.message : err,
      );
      return null;
    } finally {
      ownerPipelineInFlight = null;
    }
  })();

  return ownerPipelineInFlight;
}

/** Monthly value in dollars for each pipeline stage. Free = $0, paid tiers = $97/mo. */
const STAGE_VALUE: Record<StageName, number> = {
  'New Listing':     0,
  'Free Listing':    0,
  'Trial Started':   97,
  'Paid Listing':    97,
  'Payment Failed':  97, // still the plan's value — it's at-risk revenue, not lost yet.
  'Cancelled':       0,
};

/**
 * Map a venue's lifecycle to its target stage in the owner's pipeline, reusing
 * the shared funnel-stage logic (single source of truth):
 *   - Cancelled       — subscription cancelled (directory_subscription_status
 *     is 'canceled'/'cancelled'). Checked first since cancelling clears
 *     directory_subscription_external_id, which would otherwise make this
 *     fall through to "New Listing".
 *   - Paid Listing    — active paid subscription, charging fine.
 *   - Payment Failed  — a paying venue whose recurring charge is failing
 *     (directory_subscription_status='past_due'). Distinct from Paid Listing
 *     so the owner can see who needs a nudge/retry at a glance instead of it
 *     being silently lumped in with healthy paying customers.
 *   - Trial Started   — Pro trial (card on file + subscription external id), not active-paid.
 *   - Free Listing    — Free plan (card vaulted, no subscription external id).
 *   - New Listing     — everything else (listing exists, no card yet).
 */
function targetStageName(v: VenueSyncRow): StageName {
  const funnelState: VenueFunnelState = {
    id: v.id,
    directory_subscription_status: v.directory_subscription_status,
    directory_subscription_external_id: v.directory_subscription_external_id,
    directory_card_on_file: v.directory_card_on_file,
  };
  const status = String(v.directory_subscription_status ?? '').toLowerCase();
  if (status === 'canceled' || status === 'cancelled') return 'Cancelled';
  if (status === 'past_due') return 'Payment Failed';
  if (status === 'active') return 'Paid Listing';
  if (choseProPlan(funnelState)) return 'Trial Started';
  if (choseFreePlan(funnelState)) return 'Free Listing';
  return 'New Listing';
}

/**
 * GHL opportunity `status` (separate from pipeline stage) — flips a canceled
 * venue's opportunity to "lost" so churn is visible in GHL's own win/loss
 * reporting, IN ADDITION to moving it into the dedicated "Cancelled" stage
 * (see targetStageName).
 */
function targetOpportunityStatus(v: VenueSyncRow): 'open' | 'lost' {
  const status = String(v.directory_subscription_status ?? '').toLowerCase();
  return status === 'canceled' || status === 'cancelled' ? 'lost' : 'open';
}

/**
 * Create-or-move the venue's opportunity in the owner's "SaaS Clients"
 * pipeline so its stage tracks the venue's lifecycle. Idempotent via
 * `owner_ghl_opportunity_id`. Best-effort — never throws.
 */
async function syncVenueOpportunity(
  cfg: OwnerGhlConfig,
  venue: VenueSyncRow,
  contactId: string,
): Promise<void> {
  const resolved = await resolveOwnerPipeline(cfg);
  if (!resolved) return; // error already logged; skip opportunity placement.

  const stageName = targetStageName(venue);
  const stageId = resolved.stageIds[stageName];
  const monetaryValue = STAGE_VALUE[stageName];
  const oppStatus = targetOpportunityStatus(venue);
  const oppName = (venue.name ?? '').trim() || 'StoryVenue Venue';

  try {
    if (venue.owner_ghl_opportunity_id) {
      await updateOpportunityStage(cfg.token, cfg.locationId, venue.owner_ghl_opportunity_id, stageId, monetaryValue, oppStatus);
      console.log(
        `[owner-ghl-sync] moved opportunity ${venue.owner_ghl_opportunity_id} → "${stageName}" ($${monetaryValue}/mo, status=${oppStatus}) for venue ${venue.id}`,
      );
    } else {
      let oppId: string | null = null;
      try {
        oppId = await createOpportunity(cfg.token, cfg.locationId, {
          pipelineId: resolved.pipelineId,
          pipelineStageId: stageId,
          name: oppName,
          contactId,
          monetaryValue,
          status: oppStatus,
        });
        if (oppId) {
          console.log(
            `[owner-ghl-sync] created opportunity ${oppId} in "${stageName}" (status=${oppStatus}) for venue ${venue.id}`,
          );
        }
      } catch (createErr) {
        // GHL allows ONE opportunity per contact per pipeline. When the
        // contact already has one, the 400 includes its id — either adopt it
        // (pre-existing/manually created) or, if another venue row already
        // claims it, this venue is a duplicate signup by the same owner and
        // there is nothing separate to place. Skip instead of failing forever.
        const msg = createErr instanceof Error ? createErr.message : String(createErr);
        const existingId =
          msg.includes('OPPORTUNITY_NO_DUPLICATE') ? /"existingId"\s*:\s*"([^"]+)"/.exec(msg)?.[1] ?? null : null;
        if (!existingId) throw createErr;

        const { data: claim } = await supabaseAdmin
          .from('venues')
          .select('id')
          .eq('owner_ghl_opportunity_id', existingId)
          .neq('id', venue.id)
          .maybeSingle();
        if (claim) {
          console.log(
            `[owner-ghl-sync] venue ${venue.id} is a duplicate signup — contact ${contactId} already has ` +
              `opportunity ${existingId} owned by venue ${(claim as { id: string }).id}; skipping placement`,
          );
          return;
        }
        console.log(`[owner-ghl-sync] adopting pre-existing opportunity ${existingId} for venue ${venue.id}`);
        await updateOpportunityStage(cfg.token, cfg.locationId, existingId, stageId, monetaryValue, oppStatus);
        oppId = existingId;
      }
      if (!oppId) return;
      await supabaseAdmin.from('venues').update({ owner_ghl_opportunity_id: oppId }).eq('id', venue.id);
      venue.owner_ghl_opportunity_id = oppId;
    }

    // Best-effort snapshot so the periodic reconciler can skip this venue
    // next run if nothing has changed (never blocks — a failed write here
    // just means the next run re-checks this venue against GHL again).
    await supabaseAdmin
      .from('venues')
      .update({ owner_ghl_synced_stage: stageName, owner_ghl_synced_status: oppStatus })
      .eq('id', venue.id);
    venue.owner_ghl_synced_stage = stageName;
    venue.owner_ghl_synced_status = oppStatus;
  } catch (err) {
    console.warn(
      '[owner-ghl-sync] syncVenueOpportunity failed for',
      venue.id,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Push a single venue into the owner's GHL sub-account as a contact (one-way).
 * Idempotent: reuses `owner_ghl_contact_id` when present, otherwise
 * find-or-creates by email/phone and persists the id back.
 *
 * Returns the owner-GHL contact id, or null when nothing could be synced
 * (not configured, no email/phone, or GHL rejected the write).
 */
export async function pushVenueToOwnerGhl(
  venueIdOrRow: string | VenueSyncRow,
): Promise<string | null> {
  const cfg = getOwnerGhlConfig();
  if (!cfg) return null;

  const venue = typeof venueIdOrRow === 'string' ? await loadVenueForSync(venueIdOrRow) : venueIdOrRow;
  if (!venue) return null;

  const email = (venue.email ?? '').trim() || undefined;
  const phone = normalizePhone(venue.phone) ?? undefined;
  if (!email && !phone) {
    console.log('[owner-ghl-sync] skip: venue has no email or phone', venue.id);
    return venue.owner_ghl_contact_id;
  }

  const { firstName, lastName } = venueContactName(venue);

  try {
    const contactId = await findOrCreateContact(cfg.token, cfg.locationId, {
      email,
      phone,
      firstName,
      lastName,
    });
    if (contactId && contactId !== venue.owner_ghl_contact_id) {
      await supabaseAdmin
        .from('venues')
        .update({ owner_ghl_contact_id: contactId })
        .eq('id', venue.id);
      venue.owner_ghl_contact_id = contactId;
    }
    if (contactId) {
      console.log('[owner-ghl-sync] synced venue', venue.id, '→ owner GHL contact', contactId);

      // Tag the contact (merge-only; never removes other tags) on create AND update.
      try {
        await addContactTags(cfg.token, cfg.locationId, contactId, [OWNER_GHL_TAG]);
      } catch (tagErr) {
        console.warn(
          '[owner-ghl-sync] addContactTags failed for',
          venue.id,
          tagErr instanceof Error ? tagErr.message : tagErr,
        );
      }

      // Create-or-move the opportunity to the stage matching the venue lifecycle.
      await syncVenueOpportunity(cfg, venue, contactId);
    }
    return contactId ?? venue.owner_ghl_contact_id;
  } catch (err) {
    console.warn('[owner-ghl-sync] pushVenueToOwnerGhl failed for', venue.id, err instanceof Error ? err.message : err);
    return venue.owner_ghl_contact_id;
  }
}

/**
 * Fire-and-forget wrapper for billing/lifecycle handlers (webhooks, retry,
 * update-payment, downgrade-to-free, etc). Immediately pushes the venue's
 * current stage/status to the owner's GHL pipeline instead of waiting for
 * the next 30-minute `owner-ghl-stage-sync` reconciler tick, so a failed
 * recurring payment, a fixed card, or a downgrade shows up in GHL right
 * away. Never throws — safe to call from any request path.
 */
export function scheduleOwnerGhlSync(venueId: string): void {
  void pushVenueToOwnerGhl(venueId).catch((err) => {
    console.error('[owner-ghl-sync] scheduleOwnerGhlSync threw for venue', venueId, err);
  });
}

// ── Periodic reconciliation (SaaS → GHL "SaaS Clients" pipeline) ───────────

interface ReconcileResult {
  totalEligible: number;
  alreadyInSync: number;
  synced: number;
  failed: number;
  skippedNoIdentifier: number;
  /** Duplicate signups: venue rows sharing an owner contact with another venue
   *  that already holds the opportunity (GHL: one opportunity per contact per
   *  pipeline). Skipped with zero GHL calls. */
  skippedDuplicates: number;
  byTargetStage: Record<StageName, number>;
  failedVenueIds: string[];
  duplicateVenueIds: string[];
}

async function fetchAllNonDemoVenues(): Promise<VenueSyncRow[]> {
  // Paginate past Supabase's 1,000-row cap (defensive — we're nowhere near it
  // today, but this mirrors every other full-table venue scan in the app).
  const rows: VenueSyncRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from('venues')
      .select(VENUE_SYNC_COLUMNS)
      .neq('is_demo', true)
      .order('created_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as VenueSyncRow[];
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

/** Does this venue's current lifecycle already match what's stored in GHL? */
function isAlreadyInSync(v: VenueSyncRow): boolean {
  if (!v.owner_ghl_contact_id || !v.owner_ghl_opportunity_id) return false;
  return (
    v.owner_ghl_synced_stage === targetStageName(v) &&
    v.owner_ghl_synced_status === targetOpportunityStatus(v)
  );
}

/**
 * Reconcile every non-demo venue's contact + opportunity stage/status against
 * its CURRENT lifecycle fields, so the owner's "SaaS Clients" pipeline in GHL
 * stays a 1:1 mirror of the SaaS venue list — new venues get pushed, and any
 * venue whose trial/paid/canceled status has changed since the last sync
 * gets moved to the correct stage automatically.
 *
 * Cheap to run often: venues already in sync (contact + opportunity exist and
 * match the last-synced stage/status) are skipped with ZERO GHL calls, so a
 * steady-state run only round-trips the handful of venues that actually
 * changed since the previous run.
 */
export async function reconcileOwnerGhlStages(opts?: { dryRun?: boolean }): Promise<ReconcileResult> {
  const dryRun = opts?.dryRun === true;
  const out: ReconcileResult = {
    totalEligible: 0,
    alreadyInSync: 0,
    synced: 0,
    failed: 0,
    skippedNoIdentifier: 0,
    skippedDuplicates: 0,
    byTargetStage: {
      'New Listing': 0,
      'Trial Started': 0,
      'Free Listing': 0,
      'Paid Listing': 0,
      'Payment Failed': 0,
      'Cancelled': 0,
    },
    failedVenueIds: [],
    duplicateVenueIds: [],
  };

  const cfg = getOwnerGhlConfig();
  if (!cfg) return out;

  const venues = await fetchAllNonDemoVenues();

  // Map owner contact → the venue that already holds its opportunity, so
  // duplicate signups (same owner registered twice) are skipped instead of
  // erroring against GHL's one-opportunity-per-contact rule on every run.
  const oppOwnerByContact = new Map<string, string>();
  for (const v of venues) {
    if (v.owner_ghl_contact_id && v.owner_ghl_opportunity_id) {
      oppOwnerByContact.set(v.owner_ghl_contact_id, v.id);
    }
  }

  for (const v of venues) {
    const hasIdentifier = Boolean((v.email ?? '').trim() || normalizePhone(v.phone));
    if (!hasIdentifier) {
      out.skippedNoIdentifier += 1;
      continue;
    }
    if (!v.owner_ghl_opportunity_id && v.owner_ghl_contact_id) {
      const ownerVenueId = oppOwnerByContact.get(v.owner_ghl_contact_id);
      if (ownerVenueId && ownerVenueId !== v.id) {
        out.skippedDuplicates += 1;
        out.duplicateVenueIds.push(v.id);
        continue;
      }
    }
    out.totalEligible += 1;
    out.byTargetStage[targetStageName(v)] += 1;

    if (isAlreadyInSync(v)) {
      out.alreadyInSync += 1;
      continue;
    }
    if (dryRun) continue; // report-only — don't touch GHL.

    const contactId = await pushVenueToOwnerGhl(v);
    if (contactId && v.owner_ghl_opportunity_id) {
      out.synced += 1;
    } else {
      out.failed += 1;
      out.failedVenueIds.push(v.id);
    }
    // Small pacing gap — this is a background reconciliation job, not a
    // user-facing action, so there's no reason to hammer GHL back-to-back.
    await new Promise((r) => setTimeout(r, 200));
  }

  return out;
}

/** Public listing URL for a venue slug (used in the owner alert). */
function venueLiveUrl(slug: string | null): string | null {
  return slug ? `${DIRECTORY_URL}/venue/${slug}` : null;
}

/**
 * Send the platform owner an SMS via their own GHL sub-account A2P number.
 * Best-effort. Requires OWNER_ALERT_PHONE to be set.
 */
export async function sendOwnerSms(message: string): Promise<boolean> {
  const cfg = getOwnerGhlConfig();
  if (!cfg) return false;
  if (!cfg.alertPhone) {
    console.warn('[owner-ghl-sync] sendOwnerSms skipped: OWNER_ALERT_PHONE not set');
    return false;
  }
  try {
    // The owner must exist as a contact in their own sub-account for GHL to
    // route an SMS to them. find-or-create is idempotent.
    const contactId = await findOrCreateContact(cfg.token, cfg.locationId, {
      phone: cfg.alertPhone,
      firstName: 'StoryVenue',
      lastName: 'Alerts',
    });
    if (!contactId) {
      console.warn('[owner-ghl-sync] sendOwnerSms: could not resolve owner contact');
      return false;
    }
    await sendSms(cfg.token, cfg.locationId, contactId, message, undefined, cfg.alertPhone);
    return true;
  } catch (err) {
    console.warn('[owner-ghl-sync] sendOwnerSms failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Fire when a venue listing goes live. Exactly-once via
 * `owner_listing_alert_sent_at`:
 *   - pushes the venue into the owner's GHL sub-account, AND
 *   - texts the owner that a new listing is live.
 *
 * Safe to call on every publish — subsequent calls are no-ops.
 */
export async function onNewListingLive(venueId: string): Promise<void> {
  const cfg = getOwnerGhlConfig();
  if (!cfg) return;

  const venue = await loadVenueForSync(venueId);
  if (!venue) return;

  // Idempotency gate — has the owner already been alerted for this venue?
  const { data: gate } = await supabaseAdmin
    .from('venues')
    .select('owner_listing_alert_sent_at')
    .eq('id', venueId)
    .maybeSingle();
  if ((gate as { owner_listing_alert_sent_at?: string | null } | null)?.owner_listing_alert_sent_at) {
    return; // already alerted
  }

  // Stamp FIRST to close the race — two near-simultaneous publishes shouldn't
  // both send. If the sends below fail, the venue is still captured by the
  // backfill route later.
  await supabaseAdmin
    .from('venues')
    .update({ owner_listing_alert_sent_at: new Date().toISOString() })
    .eq('id', venueId);

  // 1. One-way sync this venue into the owner's GHL list.
  await pushVenueToOwnerGhl(venue);

  // 2. Text the owner.
  const name = (venue.name ?? '').trim() || 'A new venue';
  const place = [venue.city, venue.state].filter(Boolean).join(', ');
  const url = venueLiveUrl(venue.slug);
  const body =
    `New StoryVenue listing live: ${name}` +
    (place ? ` — ${place}` : '') +
    (url ? `. ${url}` : '');
  await sendOwnerSms(body);
}

/** Fire-and-forget wrapper for request handlers. Never blocks the response. */
export function scheduleOnNewListingLive(venueId: string): void {
  void onNewListingLive(venueId).catch((err) => {
    console.error('[owner-ghl-sync] onNewListingLive threw', err);
  });
}

/**
 * Diagnostic: surface WHY the owner-GHL sync is failing. Unlike the best-effort
 * sync paths (which swallow errors so the primary flow is never blocked), this
 * deliberately captures and returns the concrete GHL error so an admin can see
 * a token/scope/pipeline problem instead of an opaque "failed: N".
 *
 * Runs three checks against the LIVE GHL API:
 *   1. Auth + pipeline read (fetchPipelines) — proves the PIT token works and
 *      shows which pipelines/stages GHL actually returns (to verify names).
 *   2. Target pipeline + stage-name resolution.
 *   3. A real contact write against the first eligible venue (the operation
 *      that's failing in the backfill), returning the raw error text.
 */
export async function diagnoseOwnerGhl(): Promise<Record<string, unknown>> {
  const cfg = getOwnerGhlConfig();
  if (!cfg) {
    return {
      configured: false,
      error: 'OWNER_GHL_LOCATION_ID and/or OWNER_GHL_PIT_TOKEN are not set.',
    };
  }

  const out: Record<string, unknown> = {
    configured: true,
    locationId: cfg.locationId,
    tokenPrefix: cfg.token.slice(0, 4), // expect "pit-"
    tokenLooksLikePit: cfg.token.startsWith('pit-'),
    alertPhoneSet: Boolean(cfg.alertPhone),
    pipelineId: OWNER_GHL_PIPELINE_ID,
  };

  // 1 + 2. Auth + pipeline/stage resolution.
  try {
    const pipelines = await fetchPipelines(cfg.token, cfg.locationId);
    out.authOk = true;
    out.pipelineCount = pipelines.length;
    const target = pipelines.find((p) => p.id === OWNER_GHL_PIPELINE_ID);
    if (target) {
      out.targetPipelineFound = true;
      out.targetPipelineName = target.name;
      out.stagesInGhl = target.stages.map((s) => s.name);
      out.stagesExpected = STAGE_NAMES;
      out.stagesAllMatch = STAGE_NAMES.every((n) =>
        target.stages.some((s) => (s.name ?? '').trim().toLowerCase() === n.trim().toLowerCase()),
      );
    } else {
      out.targetPipelineFound = false;
      out.availablePipelines = pipelines.map((p) => ({ id: p.id, name: p.name }));
    }
  } catch (err) {
    out.authOk = false;
    out.authError = err instanceof Error ? err.message : String(err);
  }

  // 3. Live contact-write test against the first eligible venue.
  try {
    const { data } = await supabaseAdmin
      .from('venues')
      .select(VENUE_SYNC_COLUMNS)
      .neq('is_demo', true)
      .not('email', 'is', null)
      .order('created_at', { ascending: true })
      .limit(1);
    const sample = ((data ?? []) as VenueSyncRow[])[0] ?? null;
    if (!sample) {
      out.contactWriteTest = 'skipped — no eligible venue with an email found';
    } else {
      const email = (sample.email ?? '').trim() || undefined;
      const phone = normalizePhone(sample.phone) ?? undefined;
      const { firstName, lastName } = venueContactName(sample);
      const contactId = await findOrCreateContact(cfg.token, cfg.locationId, {
        email,
        phone,
        firstName,
        lastName,
      });
      out.contactWriteOk = Boolean(contactId);
      out.contactWriteContactId = contactId;
      out.contactWriteSampleVenueId = sample.id;
    }
  } catch (err) {
    out.contactWriteOk = false;
    out.contactWriteError = err instanceof Error ? err.message : String(err);
  }

  return out;
}
