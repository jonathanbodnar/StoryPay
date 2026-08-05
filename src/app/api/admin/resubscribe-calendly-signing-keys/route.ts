/**
 * POST /api/admin/resubscribe-calendly-signing-keys
 *
 * One-shot backfill: Calendly webhook subscriptions created before the
 * signature-verification fix have no signing key on file (Calendly never
 * generates/returns one — it only signs deliveries with whatever key you
 * supply at creation time, and the original integration never supplied one).
 * For every venue that is `calendly_connected` but missing
 * `calendly_webhook_signing_key`, this deletes the old (unsigned) webhook
 * subscription and recreates it with a freshly generated signing key, then
 * stores that key so /api/webhooks/calendly can verify future deliveries.
 *
 * Safe to run multiple times — only touches venues missing a signing key.
 * Non-fatal per-venue: if a venue's stored access_token is stale/revoked,
 * that venue is skipped (reported in `errors`) and calendar sync falls back
 * to the manual sync button, same as today.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { createWebhook, deleteWebhook } from '@/lib/calendly';
import { getAdminIdentity } from '@/lib/admin-identity';

export const dynamic = 'force-dynamic';

async function isAdmin(): Promise<boolean> {
  const id = await getAdminIdentity();
  return id.isMasterSuperAdmin || !!id.member;
}

export async function POST(_request: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venues } = await supabaseAdmin
    .from('venues')
    .select('id, calendly_access_token, calendly_org_uri, calendly_webhook_id')
    .eq('calendly_connected', true)
    .is('calendly_webhook_signing_key', null);

  if (!venues || venues.length === 0) {
    return NextResponse.json({ message: 'No connected venues missing a signing key', resubscribed: 0 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://www.storypay.io';
  const callbackUrl = `${appUrl}/api/webhooks/calendly`;

  const resubscribed: string[] = [];
  const errors: Array<{ venueId: string; error: string }> = [];

  for (const venue of venues) {
    const token = venue.calendly_access_token as string | null;
    const orgUri = venue.calendly_org_uri as string | null;
    if (!token || !orgUri) {
      errors.push({ venueId: venue.id, error: 'missing access_token or org_uri' });
      continue;
    }

    try {
      if (venue.calendly_webhook_id) {
        try {
          await deleteWebhook(token, venue.calendly_webhook_id as string);
        } catch { /* old subscription may already be gone; proceed to recreate */ }
      }

      const signingKey = randomBytes(32).toString('hex');
      const webhookUri = await createWebhook(token, orgUri, callbackUrl, signingKey);

      await supabaseAdmin
        .from('venues')
        .update({ calendly_webhook_id: webhookUri, calendly_webhook_signing_key: signingKey })
        .eq('id', venue.id);

      resubscribed.push(venue.id);
    } catch (err) {
      errors.push({ venueId: venue.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    message: `Resubscribed ${resubscribed.length} venue(s). ${errors.length} failed.`,
    resubscribed: resubscribed.length,
    venueIds: resubscribed,
    errors,
  });
}
