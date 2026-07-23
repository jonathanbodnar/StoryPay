/**
 * POST /api/admin/migrate-ghl
 *
 * Imports GHL contacts into a StoryVenue sub-account using a tag-based
 * stage mapping. Contacts are permanently flagged `is_ghl_migration = true`
 * so that no automated Speed-to-Lead / drip sequences ever fire for them.
 *
 * Body:
 *   {
 *     venueId: string,
 *     contacts: GhlContact[],
 *     mode: 'preview' | 'commit'
 *   }
 *
 * Tag → Stage priority (highest first):
 *   booked_wedding        → Wedding Day
 *   booked_tour           → Booked Tour
 *   scheduled_tour        → Booked Tour
 *   tour_requested        → Booked Tour
 *   bride_replied         → Conversation Started
 *   pricing_guide         → Inquiry
 *   cold_lead             → (contact-only, no pipeline stage)
 *   (no recognized tag)   → (contact-only, no pipeline stage)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhlContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Raw tag strings from GHL — normalized to lowercase + underscores internally. */
  tags: string[];
  weddingDate?: string | null;
  guestCount?: number | null;
  notes?: string | null;
}

export interface MappedContact extends GhlContact {
  /** Resolved stage name (null = contact-only). */
  stageName: string | null;
  /** Which tag drove the stage assignment. */
  matchedTag: string | null;
  /** Duplicate: a lead with this email already exists for this venue. */
  isDuplicate: boolean;
}

export interface CommitResult {
  imported: number;
  skipped: number;
  errors: { email: string; reason: string }[];
}

// ---------------------------------------------------------------------------
// Tag → Stage name mapping (priority order)
// ---------------------------------------------------------------------------

const GHL_TAG_PRIORITY: string[] = [
  'booked_wedding',
  'booked_tour',
  'scheduled_tour',
  'tour_requested',
  'bride_replied',
  'pricing_guide',
  'cold_lead',
];

const GHL_TAG_TO_STAGE_NAME: Record<string, string | null> = {
  booked_wedding:  'Wedding Day',
  booked_tour:     'Booked Tour',
  scheduled_tour:  'Booked Tour',
  tour_requested:  'Booked Tour',
  bride_replied:   'Conversation Started',
  pricing_guide:   'Inquiry',
  cold_lead:       null, // contact-only
};

/** Normalise a GHL tag to the lowercase_underscore form used in the mapping. */
function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function resolveStageFromTags(tags: string[]): { stageName: string | null; matchedTag: string | null } {
  const normalized = tags.map(normalizeTag);
  for (const candidate of GHL_TAG_PRIORITY) {
    if (normalized.includes(candidate)) {
      return {
        stageName: GHL_TAG_TO_STAGE_NAME[candidate] ?? null,
        matchedTag: candidate,
      };
    }
  }
  return { stageName: null, matchedTag: null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up an existing track token (or generate a simple unique one). */
function generateTrackToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Derived legacy `status` string from stage name (mirrors leads route logic). */
function legacyStatusForStageName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('inquiry'))       return 'new';
  if (n.includes('conversation'))  return 'contacted';
  if (n.includes('tour'))          return 'tour_booked';
  if (n.includes('wedding'))       return 'booked_wedding';
  return 'new';
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Auth
  const identity = await getAdminIdentity();
  if (!identity.isMasterSuperAdmin && !identity.member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { venueId?: string; contacts?: GhlContact[]; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { venueId, contacts, mode } = body;
  if (!venueId)                   return NextResponse.json({ error: 'venueId is required' },   { status: 400 });
  if (!Array.isArray(contacts))   return NextResponse.json({ error: 'contacts must be an array' }, { status: 400 });
  if (!contacts.length)           return NextResponse.json({ error: 'No contacts provided' },  { status: 400 });
  if (mode !== 'preview' && mode !== 'commit') {
    return NextResponse.json({ error: "mode must be 'preview' or 'commit'" }, { status: 400 });
  }

  // Verify venue exists
  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('id, name')
    .eq('id', venueId)
    .maybeSingle();
  if (venueErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  // Load the venue's default pipeline + stages (keyed by normalized name)
  const { data: pipeline } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_default', true)
    .maybeSingle();

  const defaultPipelineId: string | null = pipeline?.id ?? null;

  // Fetch all stages for this pipeline
  const stagesByName = new Map<string, string>(); // normalizedName → stage_id
  if (defaultPipelineId) {
    const { data: stages } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name')
      .eq('pipeline_id', defaultPipelineId)
      .eq('venue_id', venueId)
      .order('position', { ascending: true });
    for (const s of stages ?? []) {
      stagesByName.set((s.name as string).toLowerCase().trim(), s.id as string);
    }
  }

  // Collect existing emails for this venue (to detect duplicates)
  const { data: existingLeads } = await supabaseAdmin
    .from('leads')
    .select('email')
    .eq('venue_id', venueId);
  const existingEmails = new Set((existingLeads ?? []).map((l: { email: string }) => l.email.toLowerCase().trim()));

  // Map each contact
  const mapped: MappedContact[] = contacts.map((c) => {
    const { stageName, matchedTag } = resolveStageFromTags(c.tags ?? []);
    return {
      ...c,
      email: c.email?.trim() ?? '',
      stageName,
      matchedTag,
      isDuplicate: existingEmails.has((c.email ?? '').toLowerCase().trim()),
    };
  });

  // ---------- PREVIEW ----------
  if (mode === 'preview') {
    return NextResponse.json({ contacts: mapped, venue: { id: venue.id, name: venue.name } });
  }

  // ---------- COMMIT ----------
  const errors: CommitResult['errors'] = [];
  let imported = 0;
  let skipped = 0;

  for (const c of mapped) {
    const email = c.email.toLowerCase().trim();
    if (!email || !c.firstName || !c.lastName) {
      errors.push({ email: email || '(missing)', reason: 'Missing required fields (firstName, lastName, email)' });
      skipped++;
      continue;
    }

    // Resolve stage ID from the mapped stage name
    let stageId: string | null = null;
    let pipelineId: string | null = defaultPipelineId;
    let initialStatus = 'new';
    const excludeFromPipeline = c.stageName === null;

    if (!excludeFromPipeline && c.stageName) {
      const lookupName = c.stageName.toLowerCase().trim();
      stageId = stagesByName.get(lookupName) ?? null;
      if (stageId) {
        initialStatus = legacyStatusForStageName(c.stageName);
      } else {
        // Stage name not found in this venue's pipeline — still import as contact-only
        pipelineId = null;
      }
    } else {
      pipelineId = null;
    }

    // Insert into leads
    const leadPayload: Record<string, unknown> = {
      venue_id:              venueId,
      name:                  `${c.firstName} ${c.lastName}`.trim(),
      first_name:            c.firstName,
      last_name:             c.lastName,
      email,
      phone:                 c.phone ?? '',
      source:                'ghl_migration',
      status:                excludeFromPipeline ? 'new' : initialStatus,
      pipeline_id:           excludeFromPipeline ? null : pipelineId,
      stage_id:              excludeFromPipeline ? null : stageId,
      position:              0,
      excluded_from_pipeline: excludeFromPipeline,
      marketing_email_opt_in: false,   // suppress all email sequences
      is_ghl_migration:       true,
      track_token:            generateTrackToken(),
      wedding_date:           c.weddingDate || null,
      guest_count:            c.guestCount ?? null,
      notes:                  c.notes || null,
    };

    const { error: leadErr } = await supabaseAdmin
      .from('leads')
      .insert(leadPayload);

    if (leadErr) {
      console.error('[migrate-ghl] lead insert failed:', email, leadErr.message);
      errors.push({ email, reason: leadErr.message });
      skipped++;
      continue;
    }

    // Upsert venue_customers — preserves any existing record, adds migration flag + tag
    const { data: existingVc } = await supabaseAdmin
      .from('venue_customers')
      .select('tags')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .maybeSingle();

    const existingTags: string[] = (existingVc?.tags as string[] | null) ?? [];
    const mergedTags = Array.from(new Set([...existingTags, 'ghl-migration']));

    const vcPayload: Record<string, unknown> = {
      venue_id:       venueId,
      customer_email: email,
      first_name:     c.firstName,
      last_name:      c.lastName,
      phone:          c.phone ?? null,
      pipeline_id:    excludeFromPipeline ? null : pipelineId,
      stage_id:       excludeFromPipeline ? null : stageId,
      pipeline_stage: excludeFromPipeline ? null : initialStatus,
      tags:           mergedTags,
      is_ghl_migration: true,
      wedding_date:   c.weddingDate || null,
      guest_count:    c.guestCount ?? null,
      updated_at:     new Date().toISOString(),
    };

    const { error: vcErr } = await supabaseAdmin
      .from('venue_customers')
      .upsert(vcPayload, { onConflict: 'venue_id,customer_email' });

    if (vcErr) {
      console.warn('[migrate-ghl] venue_customers upsert failed:', email, vcErr.message);
      // Not fatal — lead was already created
    }

    imported++;
    existingEmails.add(email); // prevent intra-batch duplicates
  }

  return NextResponse.json({
    imported,
    skipped,
    errors,
    venue: { id: venue.id, name: venue.name },
  } satisfies CommitResult & { venue: { id: string; name: string } });
}
