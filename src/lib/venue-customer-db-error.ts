/**
 * PostgREST / Supabase errors when `venue_customers.pipeline_id` (migration 016)
 * is missing from the live database.
 */
export function isMissingVenueCustomerPipelineColumns(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('pipeline_id') &&
    m.includes('venue_customers') &&
    (m.includes('schema cache') || m.includes('could not find') || m.includes('column'))
  );
}

export const VENUE_CUSTOMERS_PIPELINE_MIGRATION_HINT =
  'Database is missing venue_customers.pipeline_id / stage_id. In Supabase: SQL Editor → run migrations/016_venue_customers_pipeline_fk.sql, then execute NOTIFY pgrst, \'reload schema\';';
