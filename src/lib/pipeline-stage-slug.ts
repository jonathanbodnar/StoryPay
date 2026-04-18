/** Stable slug stored in venue_customers.pipeline_stage for legacy readers */
export function slugifyStageLabel(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'stage'
  );
}
