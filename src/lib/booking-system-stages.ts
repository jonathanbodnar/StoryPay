/**
 * Shared stage-name constants + resolver for the Booking System's automated
 * pipeline stages. Extracted from `src/app/api/listing/booking-system/route.ts`
 * into a lib module so other lib files (e.g. `marketing-email-worker.ts`) can
 * import them without creating a route → lib → route circular import. The
 * route file re-exports these same names for backwards compatibility with
 * existing importers.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline } from '@/lib/pipelines';

// Stage names in the venue's default/locked pipeline that fire Phase 4/5.
export const PHASE4_STAGE_NAME = 'Tour Booked';
export const PHASE5_STAGE_NAME = 'Wedding Booked';

/**
 * Resolves the per-venue stage UUID for a named stage in the venue's
 * default/locked pipeline (see src/lib/pipelines.ts — that pipeline's stage
 * names are fixed, so looking up by name is stable). Returns null if the
 * stage can't be found (should not normally happen once the pipeline is
 * provisioned).
 */
export async function resolveDefaultStageIdByName(venueId: string, stageName: string): Promise<string | null> {
  try {
    const pipelineId = await ensureDefaultPipeline(venueId);
    const { data: stage } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipelineId)
      .eq('venue_id', venueId)
      .eq('name', stageName)
      .maybeSingle();
    return (stage as { id?: string } | null)?.id ?? null;
  } catch (e) {
    console.error(`[booking-system] failed to resolve stage "${stageName}" for venue ${venueId}:`, e);
    return null;
  }
}
