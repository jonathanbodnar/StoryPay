import { supabaseAdmin } from '@/lib/supabase';

/**
 * Public bucket that stores generated Meta ad creatives (1080x1350 PNGs).
 * Public so the operator can right-click / download the image and paste the
 * URL straight into Ads Manager without a signed-URL dance.
 */
export const AD_CREATIVES_BUCKET = 'ad-creatives';

/** PNGs at 1080x1350 land around 300–900KB; 8MB is generous headroom. */
const AD_CREATIVE_MAX_BYTES = 8 * 1024 * 1024;

let bucketEnsured = false;

export async function ensureAdCreativesBucket(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bucketEnsured) return { ok: true };

  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) return { ok: false, error: `listBuckets: ${listErr.message}` };

  if ((buckets ?? []).some((b) => b.name === AD_CREATIVES_BUCKET)) {
    bucketEnsured = true;
    return { ok: true };
  }

  const { error: createErr } = await supabaseAdmin.storage.createBucket(AD_CREATIVES_BUCKET, {
    public: true,
    fileSizeLimit: AD_CREATIVE_MAX_BYTES,
    allowedMimeTypes: ['image/png', 'image/jpeg'],
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    return { ok: false, error: `createBucket: ${createErr.message}` };
  }

  bucketEnsured = true;
  return { ok: true };
}

/** Stable-ish key: one folder per venue, one file per generation batch/variant. */
export function adCreativeObjectKey(venueId: string, batchId: string, variant: number, templateKey: string): string {
  return `${venueId}/${batchId}/${variant}-${templateKey}.png`;
}
