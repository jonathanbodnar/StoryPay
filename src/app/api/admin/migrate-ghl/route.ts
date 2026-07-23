/**
 * GET  /api/admin/migrate-ghl?venueId=…
 *   Returns the venue's default pipeline stages so the UI can build
 *   the GHL-stage → StoryVenue-stage mapping dropdowns.
 *   Response: { stages: { id, name, position }[] }
 *
 * POST /api/admin/migrate-ghl
 *   Imports GHL contacts using a stage-first mapping with tag fallback.
 *
 *   Body:
 *     {
 *       venueId: string,
 *       contacts: GhlContact[],
 *       stageMapping: Record<string, string | null>,  // GHL stage name → SV stage name (null = contact only)
 *       mode: 'preview' | 'commit'
 *     }
 *
 * Stage resolution order for each contact:
 *   1. stageMapping[contact.ghlStage]  — direct GHL pipeline stage match
 *   2. Tag-based fallback              — highest-priority recognised tag
 *   3. Contact only (no pipeline)
 *
 * All imported contacts are permanently flagged is_ghl_migration = true
 * so no automated sequences ever fire for them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAdminIdentity } from '@/lib/admin-identity';

// ---------------------------------------------------------------------------
// Shared types (exported so the panel can import them)
// ---------------------------------------------------------------------------

export interface GhlContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Current GHL pipeline stage name, e.g. "New Lead" */
  ghlStage?: string | null;
  /** Raw tag strings from GHL */
  tags: string[];
  weddingDate?: string | null;
  guestCount?: number | null;
  notes?: string | null;
}

export interface MappedContact extends GhlContact {
  /** Resolved StoryVenue stage name (null = contact-only) */
  stageName: string | null;
  /** How the stage was resolved */
  resolvedBy: 'stage' | 'tag' | 'none';
  /** Which tag drove the tag-fallback assignment */
  matchedTag: string | null;
  /** A lead with this email already exists for this venue */
  isDuplicate: boolean;
}

export interface CommitResult {
  imported: number;
  skipped: number;
  errors: { email: string; reason: string }[];
}

export interface PipelineStage {
  id: string;
  name: string;
  position: number;
}

// ---------------------------------------------------------------------------
// Tag-fallback mapping (priority order)
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
  cold_lead:       null,
};

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

function generateTrackToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function legacyStatusForStageName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('inquiry'))       return 'new';
  if (n.includes('conversation'))  return 'contacted';
  if (n.includes('booked tour') || n.includes('tour')) return 'tour_booked';
  if (n.includes('wedding'))       return 'booked_wedding';
  return 'new';
}

// ---------------------------------------------------------------------------
// GET — return venue's default pipeline stages
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.isMasterSuperAdmin && !identity.member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const venueId = searchParams.get('venueId');
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  // Get default pipeline
  const { data: pipeline } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id, name')
    .eq('venue_id', venueId)
    .eq('is_default', true)
    .maybeSingle();

  if (!pipeline) {
    return NextResponse.json({ stages: [], pipelineName: null });
  }

  const { data: stages } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('id, name, position')
    .eq('pipeline_id', pipeline.id)
    .eq('venue_id', venueId)
    .order('position', { ascending: true });

  return NextResponse.json({
    pipelineId: pipeline.id,
    pipelineName: pipeline.name as string,
    stages: (stages ?? []) as PipelineStage[],
  });
}

// ---------------------------------------------------------------------------
// POST — preview or commit migration
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const identity = await getAdminIdentity();
  if (!identity.isMasterSuperAdmin && !identity.member) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    venueId?: string;
    contacts?: GhlContact[];
    stageMapping?: Record<string, string | null>;
    mode?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { venueId, contacts, stageMapping = {}, mode } = body;
  if (!venueId)                 return NextResponse.json({ error: 'venueId is required' }, { status: 400 });
  if (!Array.isArray(contacts)) return NextResponse.json({ error: 'contacts must be an array' }, { status: 400 });
  if (!contacts.length)         return NextResponse.json({ error: 'No contacts provided' }, { status: 400 });
  if (mode !== 'preview' && mode !== 'commit') {
    return NextResponse.json({ error: "mode must be 'preview' or 'commit'" }, { status: 400 });
  }

  // Verify venue
  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('id, name')
    .eq('id', venueId)
    .maybeSingle();
  if (venueErr || !venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  // Load default pipeline + all stages (keyed by lowercase name → id)
  const { data: pipeline } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_default', true)
    .maybeSingle();

  const defaultPipelineId: string | null = pipeline?.id ?? null;
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

  // Existing emails for duplicate detection
  const { data: existingLeads } = await supabaseAdmin
    .from('leads')
    .select('email')
    .eq('venue_id', venueId);
  const existingEmails = new Set(
    (existingLeads ?? []).map((l: { email: string }) => l.email.toLowerCase().trim()),
  );

  // ---------------------------------------------------------------------------
  // Map each contact: stage → tag fallback → none
  // ---------------------------------------------------------------------------
  const mapped: MappedContact[] = contacts.map((c) => {
    let stageName: string | null = null;
    let resolvedBy: MappedContact['resolvedBy'] = 'none';
    let matchedTag: string | null = null;

    // 1. GHL stage column → stageMapping lookup
    const ghlStageKey = (c.ghlStage ?? '').trim();
    if (ghlStageKey && Object.prototype.hasOwnProperty.call(stageMapping, ghlStageKey)) {
      stageName = stageMapping[ghlStageKey] ?? null;
      resolvedBy = 'stage';
    }

    // 2. Tag fallback
    if (resolvedBy === 'none' && c.tags?.length) {
      const fromTags = resolveStageFromTags(c.tags);
      if (fromTags.matchedTag) {
        stageName = fromTags.stageName;
        matchedTag = fromTags.matchedTag;
        resolvedBy = 'tag';
      }
    }

    return {
      ...c,
      email: c.email?.trim() ?? '',
      stageName,
      resolvedBy,
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

    // Resolve stage ID from mapped stage name
    let stageId: string | null = null;
    let pipelineId: string | null = defaultPipelineId;
    let initialStatus = 'new';
    const excludeFromPipeline = c.stageName === null;

    if (!excludeFromPipeline && c.stageName) {
      stageId = stagesByName.get(c.stageName.toLowerCase().trim()) ?? null;
      if (stageId) {
        initialStatus = legacyStatusForStageName(c.stageName);
      } else {
        // Stage name not found in venue pipeline → contact only
        pipelineId = null;
      }
    } else {
      pipelineId = null;
    }

    const leadPayload: Record<string, unknown> = {
      venue_id:               venueId,
      name:                   `${c.firstName} ${c.lastName}`.trim(),
      first_name:             c.firstName,
      last_name:              c.lastName,
      email,
      phone:                  c.phone ?? '',
      source:                 'ghl_migration',
      status:                 excludeFromPipeline ? 'new' : initialStatus,
      pipeline_id:            excludeFromPipeline ? null : pipelineId,
      stage_id:               excludeFromPipeline ? null : stageId,
      position:               0,
      excluded_from_pipeline: excludeFromPipeline,
      marketing_email_opt_in: false,
      is_ghl_migration:       true,
      track_token:            generateTrackToken(),
      wedding_date:           c.weddingDate || null,
      guest_count:            c.guestCount ?? null,
      notes:                  c.notes || null,
    };

    const { error: leadErr } = await supabaseAdmin.from('leads').insert(leadPayload);
    if (leadErr) {
      console.error('[migrate-ghl] lead insert failed:', email, leadErr.message);
      errors.push({ email, reason: leadErr.message });
      skipped++;
      continue;
    }

    // Upsert venue_customers
    const { data: existingVc } = await supabaseAdmin
      .from('venue_customers')
      .select('tags')
      .eq('venue_id', venueId)
      .ilike('customer_email', email)
      .maybeSingle();

    const mergedTags = Array.from(new Set([...((existingVc?.tags as string[] | null) ?? []), 'ghl-migration']));

    const vcPayload: Record<string, unknown> = {
      venue_id:         venueId,
      customer_email:   email,
      first_name:       c.firstName,
      last_name:        c.lastName,
      phone:            c.phone ?? null,
      pipeline_id:      excludeFromPipeline ? null : pipelineId,
      stage_id:         excludeFromPipeline ? null : stageId,
      pipeline_stage:   excludeFromPipeline ? null : initialStatus,
      tags:             mergedTags,
      is_ghl_migration: true,
      wedding_date:     c.weddingDate || null,
      guest_count:      c.guestCount ?? null,
      updated_at:       new Date().toISOString(),
    };

    const { error: vcErr } = await supabaseAdmin
      .from('venue_customers')
      .upsert(vcPayload, { onConflict: 'venue_id,customer_email' });

    if (vcErr) {
      console.warn('[migrate-ghl] venue_customers upsert failed:', email, vcErr.message);
    }

    imported++;
    existingEmails.add(email);
  }

  return NextResponse.json({
    imported,
    skipped,
    errors,
    venue: { id: venue.id, name: venue.name },
  } satisfies CommitResult & { venue: { id: string; name: string } });
}
